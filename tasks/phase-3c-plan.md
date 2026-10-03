# 3c 後端實作計畫：代墊與分帳

spec：`docs/specs/phase-3c-split.md`（決策 82～107、SC-S1～SC-S19、§5.5 的補充）。一個 PR，與 3c 畫面（`tasks/phase-3c-web-plan.md`）平行開發。

> 核可：開發者 2026-10-03 指示「平行進行、等完成再叫我」，本 plan 由協調者依已核可的 spec 自行核可。偏離 spec 的方向或碰到新增相依、修改 CI 時仍停下來問。

## 1. 元件與相依

**已由協調者完成（契約，commit 於 `feature/split`）**

- `packages/shared`：`types/split.ts`（請求、回應、`TransactionSplitRef`）、`split-shares.ts`（`computeSplitShares`、`fillRemainingShares`、`SPLIT_RATIO_TOTAL`，80 個測試）、`types/debt.ts`（3 種新往來種類、`DebtEntry.splitId`、`DebtProposal.title`、接受提議的 `categoryId`／`title`、`CREATE_DEBT_ENTRY_KINDS` 移除 `PAID_FOR_ME`）、`types/transaction.ts`（`title`、`split`、`TransactionDebtRef.kind`）、8 個錯誤碼。
- `apps/api/test/splits-isolation.e2e-spec.ts`：SC-S15、SC-S16，8 個測試，目前紅燈。

**worker 實作（Codex `gpt-6-sol` xhigh）**

1. **schema + migration**（spec §4、§4.1）：`Split`、`SplitParticipant`、3 個 enum、`Transaction.title`／`splitId`、`DebtEntry.splitId`、`DebtProposal.title`、`DebtEntryKind` 加 3 個值。手寫 SQL：CHECK 約束、`SplitParticipant` 的部分唯一索引（`counterpartyId IS NULL`）。用 `prisma migrate diff` 產生基礎 SQL（`migrate dev` 在非互動環境跑不了，見 `docs/handoff.md`）。
2. **`apps/api/src/splits/`（新模組）**：controller、service、DTO。
   - 份額一律呼叫 `@ledger/shared` 的 `computeSplitShares`，錯誤碼直接對應成 400。
   - 寫入組合照 spec §3.5；往來紀錄與交易的寫入**重用** `debts/` 的既有函式（`lockCounterparty`、`recordDebtTransaction`、`proposeCreate`／`proposeAmend`／`proposeDelete`），不另寫一份。鎖對象依 id 排序。
   - 修改（決策 103）：算出新的「每個人的往來紀錄」組合，與舊的逐人比對（同一人同一種類＝改金額與日期，其他＝刪舊建新），再把我那份的交易調成新值。解散成一般交易（決策 105）、一般交易轉分帳（`fromTransactionId`）都在同一個資料庫交易裡。
3. **交易端點**（spec §5.2）：`title` 的 DTO、寫入與回應；回應帶 `split`（只給分帳擁有者）與 `debt.kind`；有 `splitId` 的交易 `PATCH`／`DELETE` → `409 SPLIT_TRANSACTION_READ_ONLY`；**列表合併**；帳本真刪的檢查把分帳的交易算進去。
4. **往來與提議**（spec §5.3）：`POST /debt-entries` 拒絕 `PAID_FOR_ME`；有 `splitId` 的往來紀錄 `PATCH`／`DELETE` → `409 SPLIT_ENTRY_READ_ONLY`；`mirrorKind` 加兩組鏡像；`SYNCED_ENTRY_KINDS` 加 4 種；接受提議依決策 102 檢查 `record`／`categoryId`／`title`；提議帶 `title`。
5. **對象的連帶規則**（spec §4.2）：刪除對象時把名單與付款人的引用算成「有紀錄」；合併時搬名單與付款人的引用，同一筆分帳重複的兩列合併、份額相加。
6. **e2e**：`apps/api/test/splits.e2e-spec.ts`（SC-S1～S4、S6～S14、S17、S18）。既有測試裡用 `POST /debt-entries` 建 `PAID_FOR_ME` 的改成走 `POST /splits`，或改成直接用 Prisma 建資料（測的是既有紀錄的顯示與修改時）。

## 2. 實作順序

1. schema + migration → `prisma generate`，型別錯誤先清到只剩新功能沒寫的部分。
2. 往來與提議的調整（第 4 項）、對象的連帶規則（第 5 項）——分帳要重用它們。
3. 分帳的建立與讀取 → 跑隔離測試的前半。
4. 交易端點（第 3 項），含列表合併 → 隔離測試全綠。
5. 分帳的修改、刪除、互轉。
6. `splits.e2e-spec.ts` 與既有測試的調整。

## 3. 風險與對策

| 風險                                                   | 對策                                                                                                                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 列表合併讓分頁算錯（同一筆分帳跨頁出現、`total` 不準） | 合併在資料庫做：擁有者的查詢以「代表交易」為單位（有我那份就是那筆，沒有就是建立最早的一筆），`total` 用同一個條件 count。SC-S14 驗 `total`；另加一個測試：21 筆分帳＋分頁 20，第 2 頁剛好 1 筆 |
| 修改的逐人比對寫錯，漏刪或重複建立往來紀錄             | 比對寫成純函式（輸入舊組合與新組合，輸出新增、修改、刪除三份清單），單元測試涵蓋 SC-S9、SC-S10 的情境與「付款人換人」                                                                           |
| 鎖的順序不一致導致死結                                 | 一律依對象 id 排序後逐一 `lockCounterparty`；SC-S17 用 `Promise.all` 驗                                                                                                                         |
| 共享帳本的其他成員從 `split`、`debt` 推回背後的往來    | 擁有者判斷用 `split.ownerId === 呼叫者`；隔離測試 SC-S16 已先寫好                                                                                                                               |
| 既有 `PAID_FOR_ME` 測試因端點拒絕而全紅                | 第 6 項：建既有紀錄改用 Prisma 直接寫入，保留「既有紀錄照常顯示、修改、刪除」的覆蓋                                                                                                             |
| migration 的 CHECK 與現有資料衝突                      | 新欄位都是 nullable 或新表；CHECK 只約束新種類，既有資料不受影響。在 e2e 資料庫與開發者 dev 資料庫都跑一次 `migrate deploy`                                                                     |

## 4. 驗證點

- worker：`pnpm --filter @ledger/shared test`、`pnpm --filter @ledger/api lint / typecheck / test / test:e2e`、`prisma migrate status`。
- 協調者（合併後）：逐行看 migration SQL、授權條件、交易邊界；自己重跑 `splits-isolation.e2e-spec.ts` 與兩套 e2e；`pnpm lint / typecheck / test / build / format:check`。

## 5. 派工

- **一個 Codex `gpt-6-sol` xhigh worker**，worktree `split-api`，從 `feature/split` 的契約 commit 開出。依 `CLAUDE.md` §11，schema、API、授權只能派這一層。
- 與畫面 worker（`split-web`）平行。分工：`apps/api/` 與 `apps/api/prisma/` 只有本 worker 改；`packages/shared` 誰都不改（要改先問協調者）。
- 同時只有一個 worktree 跑 e2e：本 worker 負責跑 API e2e；畫面 worker 不跑 e2e。

## 6. 實作紀錄

1. **派工**：Run `run_ebdf55427f50`；後端 `ctx_7903ea3712bc`（worktree `split-api`，Codex `gpt-6-sol` xhigh）、畫面 `ctx_17b7a5017559`（worktree `split-web`，Codex `gpt-6-luna` max）。
2. **後端 worker 回報**：commit `cddf1a2`、`1320242`；API 單元測試 326、API e2e 168（含 8 個隔離測試）全綠；migration `20261003010000_add_splits`。
3. **驗收時協調者修正**（commit 見 `feature/split`）：
   - **授權缺口**：`fromTransactionId` 只檢查「是我記的」，沒檢查原交易所在的帳本仍可寫入；被移出共享帳本的人能藉這條路軟刪除以前記的交易。補隔離測試（先看到 201 紅燈）再加 `assertLedgerWritable`。
   - `update` 用交易外讀的資料做逐人比對。改成交易內先 `SELECT … FOR UPDATE` 鎖住分帳再讀；`remove` 同樣先鎖。
   - 解散成一般交易時備註會消失。改成搬到交易上，SC-S11 的 e2e 補斷言。
