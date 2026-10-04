# 3e 後端實作計畫：共享帳本的分帳與結清

spec：`docs/specs/phase-3e-shared-split.md`（決策 111～140、SC-E1～SC-E20）。一個 PR。畫面另寫 `phase-3e-web.md`，等後端合併後再做。

> 核可：2026-10-04 開發者核可。同時改了派工：`backend`（sol）只給難或要求高準確的工作，其他給 `default`（luna）；多派 worker 平行。§5 依此改寫。spec 已補 §5.5 並改 SC-E3、E5、E17。

## 1. 元件與相依

**協調者自己做（契約，commit 在 `feature/ledger-split`）**

- `packages/shared/src/types/ledger-split.ts`：`LedgerPerson`（含 `status`）、`LedgerSplitInput`／`LedgerSplitView`、`SettlementSummary`、`CreateSettlementBody`／`UpdateSettlementBody`、`SetAccountBody`。`types/transaction.ts` 加 `payer`、`ledgerSplit`、`settlement`、`accountPending`，建立與修改的輸入加 `payerPersonId`、`ledgerSplit`；列表查詢加 `payerPersonId`。
- `packages/shared/src/ledger-settlement.ts`：`computeLedgerNets`（§3.2 的淨額，輸入每筆的付款人、總額、份額與結清）與 `suggestSettlements`（§3.3），含單元測試（SC-E16）。只能 `import type`。
- `packages/shared/src/split-shares.ts`：把核心改成以字串 key 表示人（`computeSharesByKey`），`computeSplitShares` 保留原簽名當包裝（`null`＝我換成內部 key），3c 與 Web 不必改。3c 的 80 個測試照跑全綠。
- 錯誤碼：spec §5.4 的 7 個。
- `apps/api/test/ledger-splits-isolation.e2e-spec.ts`：SC-E17、SC-E18，先看到紅燈。

**`backend` worker 實作**

1. **schema＋migration**（spec §4）：
   - 4 張新表、`Transaction.payerPersonId`。
   - 手寫 SQL：非成員名字的部分唯一索引（`WHERE "userId" IS NULL AND "deletedAt" IS NULL`）；CHECK `("userId" IS NULL) = ("name" IS NOT NULL)`；`LedgerShare.share > 0`；`LedgerSettlement` 的 `fromPersonId <> toPersonId`。
   - 回填：替每個 `SHARED` 帳本的**現任成員**，以及**在該帳本記過交易、但已離開的使用者**各建一筆 `LedgerPerson`（後者讓舊交易的 `payer` 也解析得到）。不回填 `payerPersonId`（null＝記帳的人）。
   - 用 `prisma migrate diff` 產生基礎 SQL，再手寫上面幾段。`migrate` 只能對 `.env.test` 的資料庫跑。
2. **帳本裡的人**（新模組 `apps/api/src/ledger-people/`）：§5.1 的 4 個端點；`LedgersService` 的 `createLedgerForUser`（`SHARED` 時）與 `addMember` 在同一個資料庫交易裡建立或**沿用**該使用者的 `LedgerPerson`（離開再加入不會多一筆）。
3. **交易端點**（§5.2）：
   - 付款人與名單的驗證、寫入與回應欄位；份額一律呼叫 `computeSharesByKey`。
   - 新的共享帳本 `EXPENSE`／`INCOME` 一律寫明 `payerPersonId`（記帳的人就寫他的那筆），null 只留給舊資料與借還產生的交易。
   - 帳戶規則改成「帳戶屬於付款人」（決策 123～126）。`assertAccountRules` 的「連動帳本必填」改成「付款人是呼叫者時必填；付款人是別的成員或非成員時不可填」。
   - 結清的交易在 `PATCH`／`DELETE` 回 `409 SETTLEMENT_TRANSACTION_READ_ONLY`。
   - 列表的 `payerPersonId` 篩選：`COALESCE(t."payerPersonId", 記帳的人在這本帳本的 LedgerPerson)`。
4. **補帳戶端點**（本 plan 對 spec §5 的補充，見 §3 第 1 點）：`PUT /ledgers/{ledgerId}/transactions/{id}/account` 與 `PUT /ledgers/{ledgerId}/settlements/{id}/account`，body 只有 `{ accountId }`，`VIEWER` 以上，服務層再檢查「呼叫者就是付款人（收錢的人）」。
5. **結清**（新模組 `apps/api/src/settlements/`）：§5.3 的 4 個端點；summary 用一條 SQL 彙總付款與份額、另一條彙總結清，再交給 `computeLedgerNets`／`suggestSettlements`。結清的轉帳略過一般轉帳的「兩個帳戶都屬於呼叫者」檢查，改用決策 129 的規則。
6. **e2e**：`apps/api/test/ledger-splits.e2e-spec.ts`（SC-E1～E16）。既有 e2e 若因回應多了欄位而失敗，只補欄位斷言，不改行為。Web 的測試 fixture 若因 `Transaction` 型別多了必填欄位而 typecheck 失敗，只補欄位（值給 `null`／`false`）。

## 2. 實作順序

1. 契約與隔離測試（協調者）→ 開 worktree 派工。
2. schema＋migration → `prisma generate`。
3. 帳本裡的人（第 2 項）→ 隔離測試的 people 部分轉綠。
4. 交易端點與補帳戶端點（第 3、4 項）。
5. 結清與 summary（第 5 項）→ 隔離測試全綠。
6. `ledger-splits.e2e-spec.ts` 與既有測試的調整。

## 3. 風險與對策

| 風險                                                                               | 對策                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **VIEWER 能補帳戶**要開一個寫入口，做錯就變成 VIEWER 能改交易                      | 不放寬既有 `PATCH` 的 `EDITOR` 守門，另開只收 `{ accountId }` 的補帳戶端點（第 4 項）。服務層檢查「呼叫者＝付款人（收錢的人）」、帳戶屬於呼叫者。這是對 spec §5 的補充：spec 寫「`PATCH` 帶自己的帳戶」，改成這兩個端點，plan 核可後同步改 spec 的 SC-E3、E5、E17              |
| 刪非成員與同時寫入名單的競態：刪除檢查「沒被用到」之後，另一個請求剛好把他寫進名單 | 刪除在資料庫交易裡先 `SELECT … FOR UPDATE` 鎖住那筆 `LedgerPerson` 再查使用量。寫入名單、付款人、結清的請求在任何寫入之前，依 id 排序 `SELECT … FOR KEY SHARE` 鎖住所有牽涉到的人並確認未刪除。照 3c 死結的教訓（`tasks/archive/phase-3c-plan.md` §6 第 4 點），一律先鎖、後寫 |
| 改付款人時帳戶沒清空，扣到舊付款人的錢                                             | 決策 125 寫成服務層的單一函式，單元測試涵蓋「別人→我（必帶帳戶）」「我→別人（清空）」「別人→非成員（清空）」；SC-E7 驗                                                                                                                                                         |
| summary 的淨額跟交易對不起來                                                       | 淨額只在 `computeLedgerNets` 算一次，SQL 只負責撈原始數字；SC-E4、E5、E6、E9 驗具體數字                                                                                                                                                                                        |
| 離開再加入的成員多出一筆 `LedgerPerson`，淨額被拆成兩個人                          | `@@unique([ledgerId, userId])`，`addMember` 用 upsert；e2e 加一條「離開→加入→summary 只有一列」                                                                                                                                                                                |
| 舊交易的記帳人已離開、沒有 `LedgerPerson`，`payer` 解析不到                        | migration 回填已離開但記過交易的使用者（第 1 項）；SC-E11 驗                                                                                                                                                                                                                   |
| migration 套到開發者的 `ledger_dev`                                                | worker 的 Task spec 寫明 `migrate` 只能對 `.env.test`；合併後由協調者替開發者跑 `migrate deploy`，先 `pg_dump` 備份                                                                                                                                                            |
| 回應多了欄位，Web 的 typecheck 紅掉                                                | 欄位在 shared 型別裡宣告為必填，worker 只補 fixture，不改 Web 行為；Web 的畫面留給 3e 畫面 PR                                                                                                                                                                                  |

## 4. 驗證點

- worker：`pnpm --filter @ledger/shared test`、`pnpm --filter @ledger/api lint / typecheck / test / test:e2e`、`pnpm --filter @ledger/web typecheck`、`prisma migrate status`。
- 協調者：逐行看 migration SQL、授權條件（尤其補帳戶端點與 `LedgerPerson` 的帳本歸屬）、交易邊界與鎖的順序；自己重跑 `ledger-splits-isolation.e2e-spec.ts` 與兩套 e2e；`pnpm lint / typecheck / test / build / format:check`。
- 合併後：替開發者的 dev 環境備份並 `migrate deploy`（`docs/handoff.md`「替開發者部署」）。

## 5. 派工（2026-10-04 依開發者指示改成多 worker 平行）

依開發者 2026-10-04 的指示：`backend`（sol）只派會動到錢、授權、鎖、migration 的部分，其餘派 `default`（luna）。能平行就平行。

每個 worker 一個 worktree、一個分支，從 `feature/ledger-split` 開出；協調者驗收後 merge 回 `feature/ledger-split`，最後整條一個 PR。API e2e 用 supertest 在行程內跑、不佔 port，所以每個 worktree 的 `apps/api/.env.test` 改指向自己的資料庫（`ledger_test_<名稱>`，協調者先建好），可以同時跑 API e2e。Web 的 Playwright 一律不跑。

| 波次 | worker         | 角色      | 範圍                                                                                                                                                                                                       |
| ---- | -------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `split-shared` | `default` | `packages/shared`：`computeSharesByKey` 與 3c 包裝、`computeLedgerNets`、`suggestSettlements`、單元測試（SC-E16）                                                                                          |
| 1    | `split-schema` | `backend` | §1 第 1 項 schema＋migration；`ledger-people` 模組的核心（建立／沿用成員的 `LedgerPerson`、鎖住並驗證人、狀態判斷）；帳戶規則純函式（決策 123～125、129）與單元測試；交易回應新欄位先回預設值；Web fixture |
| 1    | 協調者         | —         | `ledger-splits-isolation.e2e-spec.ts`（SC-E17、E18），先看到紅燈                                                                                                                                           |
| 2    | `split-people` | `default` | §1 第 2 項的 4 個端點＋`ledger-people.e2e-spec.ts`（SC-E1、E10、離開再加入）                                                                                                                               |
| 2    | `split-tx`     | `backend` | §1 第 3、4 項的交易部分（付款人、名單、帳戶規則、唯讀、篩選、交易補帳戶端點、`settlement` 回應欄位）＋`ledger-splits.e2e-spec.ts`（SC-E2、E3、E7、E8、E11～E13、E15）                                      |
| 2    | `split-settle` | `default` | §1 第 5 項的結清 4 個端點、summary、結清補帳戶端點＋`ledger-settlements.e2e-spec.ts`（以 Prisma 直接寫名單資料當前置）                                                                                     |
| 3    | `split-e2e`    | `default` | 跨模組情境 e2e（SC-E4、E5、E6、E9、E14）與既有 e2e 的回歸（SC-E19）                                                                                                                                        |

- 第 2 波的三個 worker 檔案不重疊：`transactions/` 只歸 `split-tx`，`settlements/` 只歸 `split-settle`，`ledger-people/` 的端點只歸 `split-people`。`app.module.ts` 的匯入由協調者 merge 時處理。
- worker 不改 `packages/shared`（要改先問協調者）。
- 協調者驗收 `backend` worker 的產出時逐行看 diff；`default` worker 的授權與金額部分同樣逐行看。

## 6. 實作紀錄

（實作時填寫）
