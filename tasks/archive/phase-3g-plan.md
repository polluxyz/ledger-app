# 3g 實作計畫：借還頁改成列內展開與四個子分頁

spec：`docs/specs/phase-3g-debts-inline.md`（決策 153～158、W149～W171、SC-G1～SC-G9）。後端、畫面、e2e 合成一個 PR（spec 開頭的執行順序）。

> 核可：**已核可**（2026-10-13）。

## 0. 起點

- 原型分支 `polluxyz/debts-inline`（worktree `C:/Users/Administrator/orca/workspaces/ledger-app/debts-inline`）已經以 `main`（`c801558`）為基底，與 `origin/main` 合併沒有衝突。版面與互動都在這條分支上，**不重寫**。
- 整合分支：從 `polluxyz/debts-inline` 的 HEAD 開 `feature/debts-inline`（分支前綴照 `CLAUDE.md` §10）。worker 從協調者的契約 commit 開分支，驗收後 merge 回來，最後一個 PR。舊的 `polluxyz/debts-inline` 在整合分支開出後刪除。
- 原型的已知捷徑都要在本步移掉（spec §2.3 決策 154、155）：
  - `apps/web/src/features/debts/debt-entry-history.ts`：前端用 `balanceAfter` 切已還清。
  - `CounterpartyList.tsx`：個人分頁在前端過濾 `balance !== 0`。
  - `CounterpartyDetail.tsx`、`DebtHistoryView.tsx`：往來紀錄一次抓 100 筆；歷史的共享段對每本帳本抓 `transactions?type=TRANSFER&limit=100` 再在前端挑結清。
- 原型的程式有一部分是 Antigravity 寫的。協調者驗收時要看完整 diff，不能只看 worker 的摘要。

## 1. 元件與相依

### 1.1 協調者自己做（契約與隔離測試）

- `packages/shared`：
  - `DebtEntry` 加 `settlesEntryId: string | null`（spec §4.1）。
  - `ListCounterpartiesQuery` 加 `personalNonZero?: boolean`、`hasHistory?: boolean`。
  - 往來紀錄的查詢參數另立型別 `ListDebtEntriesQuery { page?; limit?; section?: 'outstanding' | 'history' }`。現在 `GET /counterparties/{id}/entries` 借用 `ListCounterpartiesQuery`，`q`、`nonZero` 對它沒有意義。
  - `ListLedgerGroupsQuery` 加 `hasSettlements?: boolean`；`LedgerGroup` 加 `settlementCount?: number`（只有帶 `hasSettlements` 時回）。
  - `ListLedgerSettlementsQuery { page?; limit? }`，回應 `Paginated<Transaction>`。
  - 錯誤碼 `SETTLEMENT_BOUND_TO_REPAYMENT`；`apps/web/src/lib/error-messages.ts` 補中文訊息。
- `apps/api/test/debts-inline-isolation.e2e-spec.ts`：SC-G7，先看到紅燈。內容：
  - 別人的對象帶 `section`、`personalNonZero`、`hasHistory` 都讀不到（`404` 或不出現在清單）。
  - 我沒參與過的帳本 `GET …/settlements` → `404`；從沒加入過的人也是 `404`。
  - 退出後 `GET …/settlements` 只回我是任一方的結清；分頁參數不能放寬範圍。
  - 退出後 `PATCH`／`DELETE …/settlements/{id}` → `409 LEDGER_LEFT` 或 `404`（照 3f 現行行為，不放寬）。
  - `GET /ledger-groups?hasSettlements=true` 不帶出我沒參與過的帳本。

### 1.2 後端（worker）

1. **綁定差額**（決策 156～158，spec §3）：
   - migration：`DebtEntry.settlesEntryId String? @unique`，自我關聯 `onDelete: Restrict`。不回填。
   - `debt-recording.ts` 的 `writeSettlement` 寫入 `settlesEntryId = repayment.id`。新增（`DebtEntriesService.create`）與接受提議（`DebtProposalsService` 第 276 行附近）都走它，所以兩條路都會綁定。
   - 撤銷：`DebtEntriesService.remove` 刪還款時，同一個時間戳一起軟刪除綁定的差額。對綁定的差額呼叫 → `409 SETTLEMENT_BOUND_TO_REPAYMENT`。沒綁定的舊差額行為不變。
   - 修改：`DebtEntriesService.update` 改綁定的還款金額時，差額 `delta` 改成 `舊差額 − (新還款 delta − 舊還款 delta)`，兩筆合計不變，所以餘額不變。結果是 0 就軟刪除差額。不再檢查超過欠款（開發者 2026-10-13）。
   - 連動：接受對方的「刪除」與「修改」提議時，對自己那邊的還款套用同樣的撤銷與重算。把「撤銷還款＋差額」與「重算差額」寫成 `debt-recording.ts` 的共用函式，兩個 service 共用。
2. **已還清與過濾**（決策 153、154）：
   - `GET /counterparties/{id}/entries?section=`：現在已經取出全部未刪除紀錄、算完累計再切頁（`counterparties.service.ts` 的 `entries`）。在切頁前依 section 篩選：找新到舊第一筆 `balanceAfter === 0`，那一筆與之後是 history，之前是 outstanding。`total` 是篩選後的筆數。
   - `GET /counterparties?personalNonZero=true`：只回 `balance ≠ 0`。
   - `GET /counterparties?hasHistory=true`：只回至少有一筆紀錄的累計餘額為 0 的對象。用一次查詢取出我所有對象的未刪除紀錄的 `counterpartyId`、`delta`、`date`、`createdAt`，在記憶體算，不要每個對象查一次。
3. **結清清單**（spec §4.2）：
   - `GET /ledgers/{ledgerId}/settlements`：標 `@RequireLedgerRole('VIEWER')` 與 `@LeftMemberAccess('read')`。現任成員回全部結清；`ledgerAccess === 'LEFT'` 時只回我是任一方的結清。範圍條件重用 `TransactionsService` 的退出範圍，以 AND 加進同一條 SQL。新到舊、分頁。
   - `GET /ledger-groups?hasSettlements=true`：回有我看得到的結清的帳本（含已退出），每組帶 `settlementCount`。`people` 照現行規則。

### 1.3 畫面（worker）

前端只顯示，已還清的分界、過濾、分組都來自 API（spec §7 Never）。

| 區塊                 | 決策                        | 主要檔案                                                                                                                      |
| -------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 總覽、個人、往來紀錄 | W156、W157、W164～W171、155 | `features/debts/`（`CounterpartyList`、`CounterpartyDetail`、`DebtEntriesList`、`use-debts`）                                 |
| 共享、歷史           | W158～W163                  | `features/settlements/SharedSettlementsView.*`、`features/debts/DebtHistoryView.*`、`features/settlements/use-settlements.ts` |

- 個人分頁改用 `personalNonZero=true`，刪掉前端過濾。
- 展開區改用 `section=outstanding`，歷史改用 `section=history`；兩處都改成分頁＋「載入更多」。刪掉 `debt-entry-history.ts` 與它的測試。
- 綁定的差額（`settlesEntryId !== null`）沒有「⋯」。
- 共享分頁：已退出且還沒結清的帳本，從 `GET /ledger-groups` 取（`ledger.left === true` 且 `people` 不是空的），卡片標「已退出」，方塊照 `amount` 正負畫「對方 → 我」或「我 → 對方」，不能點。
- 歷史的共享段：帳本清單用 `GET /ledger-groups?hasSettlements=true`，點開用 `GET …/settlements`（載入更多）。每筆結清有「⋯」修改、撤銷：修改打開現有的結清表單（`SettlementForm` 的編輯模式），撤銷用 `ConfirmDialog`。已退出帳本的結清沒有「⋯」。

### 1.4 e2e（worker）

- API：`apps/api/test/debts-inline.e2e-spec.ts` 一條情境走完 SC-G1～G6，用 spec §1 的資料。
- Web：先 `grep -rn "結清\|switchLedger\|往來帳" apps/web/e2e` 找出受影響的檔案，至少有 `debts`、`debt-linking`、`ledger-split`、`unified-debts`、`layout` 與 `ui.ts`。改成新版面，另加 spec §6 的兩條主線。

## 2. 實作順序

1. 協調者：開 `feature/debts-inline`、契約、隔離測試（紅燈）→ commit → 開 worker worktree 與資料庫 → 派第 1 波。
2. 第 1 波：綁定差額、已還清與過濾、結清清單、兩塊畫面同時進行。畫面依 shared 型別寫 mock 的 API 回應。
3. 第 2 波：API 情境 e2e、Web e2e（依賴第 1 波全部 merge）。
4. 協調者整體驗收 → PR → CI → 合併 → 問開發者要不要部署到 dev。
5. 收尾：照 memory「做完的分支要關」清 worktree、分支、終端機、測試資料庫（刪除清單先給開發者看）。

## 3. 風險與對策

| 風險                                                 | 對策                                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 撤銷或修改還款時漏掉綁定的差額，或在連動對方那邊漏掉 | 撤銷與重算寫成共用函式，`DebtEntriesService` 與 `DebtProposalsService` 都呼叫它。SC-G3～G5 各有 API e2e；單元測試涵蓋少收、多收、剛好還清、沒綁定的舊資料                 |
| 重算差額的方向寫反，餘額不再歸零                     | 公式只用 delta 相減（兩筆合計不變），不重讀餘額。單元測試斷言「修改前後兩筆 delta 合計相同」                                                                              |
| 結清清單對已退出的人放寬範圍                         | 只標 `@LeftMemberAccess('read')`，範圍重用 3f 的退出範圍並以 AND 加進 SQL；隔離測試帶分頁打一次。協調者逐行看 guard 與查詢 diff                                           |
| `hasHistory` 要看每個對象的全部紀錄，對象多時變慢    | 一次查詢、記憶體計算。驗收時用 API e2e 量 100 個對象、每個 20 筆的回應時間，目標 < 500ms；超過就記進實作紀錄、另開最佳化任務                                              |
| 原型的前端捷徑沒移乾淨                               | 驗收時 `grep -rn "balanceAfter === 0\|limit: 100\|balance !== 0" apps/web/src/features/debts apps/web/src/features/settlements` 必須沒有結果（測試檔除外）                |
| 兩個畫面 worker 改到同一個檔案                       | §5 的 Ownership 依檔案分開；`TransactionsPage.tsx` 與路由不歸任何 worker（本步不需要改）                                                                                  |
| migration 套到開發者的 `ledger_dev`                  | 每個碰 Prisma 的 worktree，`.env` 與 `.env.test` 都指向 `ledger_di_<名稱>_test`（協調者先建）。合併後先 `pg_dump` 再替開發者 `migrate deploy`                             |
| shared 改了，Vite 預先打包快取沒失效                 | 每次 rebuild shared 後刪 `apps/web/node_modules/.vite`；dev 環境切 commit 後提醒開發者 `Ctrl + Shift + R`                                                                 |
| Codex 或 GLM 額度用完                                | 照 `docs/orca-multi-agent.md` §4 換層。GLM 週額度在 2026-10-12 已用完，`fallback-1` 可能還沒恢復，先用 `orca account list` 確認，不行就直接用 `fallback-2`（Antigravity） |

## 4. 驗證點

- 每個 worker：`pnpm lint / typecheck / test / format:check`；碰後端的再跑自己資料庫的 `test:e2e`；碰 schema 的跑 `prisma migrate status`。
- 協調者：
  - 逐行看 migration SQL（先列給開發者看再套用，spec §3）、撤銷與重算的共用函式、結清清單的範圍查詢。
  - 自己重跑 `debts-inline-isolation.e2e-spec.ts`（要從紅轉綠）與兩套 e2e。
  - 跑 §3 的 grep，確認前端捷徑已移除。
  - `pnpm lint / typecheck / test / build / format:check` 全綠。
- 合併後：問開發者要不要部署；要的話照 handoff 先備份 `ledger_dev`，再 `prisma generate`、`migrate deploy`、重建 API。

## 5. 派工

角色照 `docs/orca-multi-agent.md` §0：會碰錢、授權、migration 的給 `backend`，其餘給 `default`。開發者要求多用 worker。

每個 worker 一個 worktree、一個分支，從契約 commit 開出。碰 Prisma 的 worktree，`.env` 與 `.env.test` 都指向 `ledger_di_<名稱>_test`。Web 的 Playwright 只有 `di-web-e2e` 跑。

| 波次 | worker               | 角色      | 範圍                                                          | 驗收                                                                |
| ---- | -------------------- | --------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1    | 協調者               | —         | §1.1 契約、錯誤訊息、隔離測試                                 | 隔離測試紅燈；shared build 後 API／Web typecheck 只剩「未實作」錯誤 |
| 1    | `di-bind`            | `backend` | §1.2 第 1 項：migration、綁定、撤銷、重算、連動               | SC-G3、G4、G5 的 service 單元測試與 API e2e                         |
| 1    | `di-history-api`     | `default` | §1.2 第 2 項：`section`、`personalNonZero`、`hasHistory`      | SC-G1、G2；隔離測試的對象部分轉綠                                   |
| 1    | `di-settlements-api` | `backend` | §1.2 第 3 項：`GET …/settlements`、`hasSettlements`           | SC-G6；隔離測試的帳本部分轉綠                                       |
| 1    | `di-web-debts`       | `default` | §1.3 第一列：個人過濾、`section`、載入更多、綁定差額沒有「⋯」 | 元件測試涵蓋 SC-G8 的對應項；前端捷徑 grep 無結果                   |
| 1    | `di-web-history`     | `default` | §1.3 第二列：已退出卡片、歷史兩段改用 API、結清的修改與撤銷   | 元件測試涵蓋已退出唯讀卡片、歷史兩段、結清「⋯」、已退出沒有「⋯」    |
| 2    | `di-api-e2e`         | `default` | `debts-inline.e2e-spec.ts`；既有 API e2e 回歸                 | 新舊 API e2e 全綠                                                   |
| 2    | `di-web-e2e`         | `default` | 受影響的 Web e2e 改版面；spec §6 的兩條主線                   | 兩套 Web e2e 全綠                                                   |

- 檔案歸屬：`debt-recording.ts`、`debt-entry-rules.ts`（`toDebtEntry` 回應轉換，G0 先放 `settlesEntryId: null` 佔位）、`debt-entries.service.*`、`debt-proposals.service.*`、`prisma/` 只歸 `di-bind`；`counterparties.service.*` 與 `dto/` 歸 `di-history-api`；`settlements/`、`ledger-groups/`、`transactions/` 的範圍函式匯出歸 `di-settlements-api`。
- 畫面：`features/debts/` 歸 `di-web-debts`，但 `DebtHistoryView.*` 歸 `di-web-history`；`features/settlements/` 歸 `di-web-history`。`DebtEntriesList` 若 `di-web-history` 需要新屬性，先問協調者，由協調者在契約 commit 加。
- worker 不改 `packages/shared`（要改先問協調者）。

## 6. 實作紀錄

1. **G0 多做的契約**（2026-10-13）：兩個畫面 worker 都要「載入更多」，為了不讓兩人同時改 hook 檔，協調者先寫好 `useCounterpartyEntryPages`（`use-debts.ts`）、`useLedgerSettlementPages`（`use-settlements.ts`）與 `useLedgerGroups` 的 `hasSettlements`（`use-ledger-pointers.ts`），結清寫入時一併失效結清清單。`toDebtEntry` 先放 `settlesEntryId: null` 佔位，G1 改成讀欄位。
2. **檔案歸屬補一條**：`debt-entry-rules.ts`（`toDebtEntry`）原本沒寫歸屬，歸給 `di-bind`（開工前已向開發者說明）。
3. **換模型**：`backend`（`gpt-6-sol`）派工時被 Codex 拒絕（`The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account.`），模型清單也沒有 sol。開發者說 Codex 方案沒了、暫時不用，改成先用 `fallback-1`（Pi GLM 5.3），GLM 用完再用 Claude Haiku 5.5 xhigh。G1、G3 以 `--retry-of` 改派 GLM；G2、G4、G5 已在跑的 luna 讓它做完。第 2 波（G6、G7）派 GLM。
4. **前端捷徑 grep 的範圍**：§3 的 grep 會命中 `CounterpartyPicker`、`DebtEntryForm`、`MergeDialog`、`MergePrompt` 的 `limit: 100` 與 `balance !== 0`。這些是 3b 起就有的選單與表單判斷，不是 3g 原型的捷徑，不在本步範圍。驗收改成只檢查 `CounterpartyList`、`CounterpartyDetail`、`DebtHistoryView`、`features/settlements/`。`debt-entry-history.ts` 已刪除。
5. **`RESTRICT` 外鍵與刪除對象**：刪除對象時，已軟刪除的紀錄會連帶硬刪除。協調者在 `ledger_di_bind_test` 用 SQL 重現「已撤銷的還款＋綁定差額」再刪對象，兩種列順序都成功：PostgreSQL 在同一個陳述式的連帶刪除做完後才檢查，所以 `RESTRICT` 不會擋。schema 照 spec §3，不改。
6. **退出後的結清範圍比交易列表窄**：交易列表的退出範圍包含「我建立的、沒有付款人的交易」，結清清單刻意不套這一條，只看付錢或收錢的人是不是我（`TransactionsService.list` 的內部選項 `settlementsOnly`）。
7. **第 2 波換到 Haiku**：G6、G7 先派 GLM，跑到一半 GLM 回 `429 Usage limit reached for 5 hour`，照開發者指示以 `--retry-of` 改派 Claude Haiku 5.5 xhigh（`launch.effective` 相符）。G6 沿用 GLM 留下的未 commit 檔案。
8. **G6 結果**：`debts-inline.e2e-spec.ts` 走完 SC-G1～G6；`hasHistory` 在 100 個對象、每個 20 筆時中位數 **18.7ms**（5 次：24、19、17、19、17ms），遠低於 500ms 目標。情境在 SC-G5 前先讓明哥還清 500：「以此結清」會把整個餘額歸零，不先還清會吃掉前面的欠款。這是測試資料的安排，不是產品行為的偏離。
9. **G7 結果**：基準時 Web e2e 53 個有 13 個失敗（右側欄、交易頁「結清」分頁、淨額卡片拿掉了；版面測試沒算進 W152 預留的捲軸寬度）。逐一改成 3g 的流程、意圖不變；每筆「餘額」的斷言隨 D2 拿掉。新增 `debts-inline.spec.ts` 兩條主線。整套 55 個連續兩次全綠。
10. **撤銷試算漏算綁定差額**（G7 讀程式發現）：W171 的試算只減這筆的 `delta`，但撤銷綁定差額的還款時後端會連差額一起撤。房東的例子會顯示「欠我 $90」，實際是 $93。協調者改成連綁定差額一起減（`DebtEntriesList.tsx` 的 `undoDeltaOf`），補元件測試，spec W171 的公式同步補上。差額緊接在還款之後寫入，看得到還款時差額一定已載入。G7 另外回報「首頁還有帳本切換與新增交易」：它們在頁面標題那一排、不在最上排，是開發者 2026-10-07 定的做法，符合 W151，不改。
11. **驗證數字**（第 1 波合併後的整合分支）：隔離測試 8 個由紅轉綠；API e2e 257 個、API 單元測試 412 個、Web 745 個、shared 105 個全綠。
12. **G8 整體驗收**（全部合併後的整合分支）：lint、typecheck、build、format:check 全綠；單元測試 shared 105、API 412、Web 746；API e2e 259；Web e2e 55。前端捷徑 grep（`CounterpartyList`、`CounterpartyDetail`、`DebtHistoryView`、`features/settlements/`）沒有結果。
