# 3k 實作計畫：退出共享帳本，並把自己的帳合併到別的帳本

spec：`docs/specs/phase-3k-leave-and-merge.md`（決策 189～207、W188～W193、SC-K1～SC-K12）。後端、畫面、e2e 合成一個 PR。

> 核可：開發者 2026-10-18 核可（含 §1.3、§1.5 核可時補的說明）。

## 0. 起點

- 整合分支：`feature/ledger-leave-merge`，從 docs PR 合併後的 `main` 開。worker 從協調者的契約 commit 開分支，驗收後 merge 回整合分支，最後開一個 PR。
- 角色：migration、合併計畫、帳戶規則、授權派 `backend`；畫面與 e2e 派 `default`。模型看 `docs/orca-multi-agent.md` §0。
- 有 1 個 migration（spec §3：加表、加欄位、加 enum 值、加 CHECK，不動既有資料）。部署要先備份 `ledger_dev`。
- 不改餘額公式（`accounts.service.ts` 的 `directionOf`）。

## 1. 元件與相依

### 1.1 協調者自己做（K0：契約與隔離測試）

- `packages/shared`：
  - 型別 `LeaveRequest`、`LedgerLeavePreview`、`TransactionMerge`（spec §4.1、§4.3）；`Transaction` 回應加 `merge`。
  - 錯誤碼 `LEDGER_HAS_OTHER_MEMBERS`、`MEMBER_HAS_TRANSACTIONS`、`LEAVE_REQUIRES_MERGE`、`TRANSACTION_ALREADY_MERGED`。
  - `DebtEntryKind` 加 `LEDGER_CARRY_OVER`；`DEBT_TRANSACTION_TYPES` 的註解改寫例外（spec §3）。
- `apps/api/test/ledger-leave-merge-isolation.e2e-spec.ts`：SC-K10、SC-K4、SC-K9 的權限部分，先看到紅燈。

### 1.2 後端 A：migration（K1，worker）

- `schema.prisma`：`LedgerMerge`、`Transaction.mergeId`／`mergedFromId`、`DebtEntry.mergeId`、`DebtEntryKind.LEDGER_CARRY_OVER`（spec §3）。
- migration SQL：spec §3 的 2 條 CHECK。在自己的 `_test` 資料庫套用，用 SQL 驗證 CHECK 擋得住違反的資料。
- 只改 schema 與 migration，不改 service。

### 1.3 後端 B：退出後的規則（K2，worker）

不依賴 K1，可以跟 K1 平行。

| 決策     | 內容                                                                                 | 主要檔案                                                                                                      |
| -------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 191、192 | 已退出的人當付款人或結清方 → 不記帳戶                                                | `ledger-people/payer-account-rules.ts`、`transactions.service.ts`、`settlements.service.ts`                   |
| 189      | 已退出的帳本不算進借還頁、對象頁、統計；打不開（`LeftMemberAccess` 拿掉）            | `ledger-groups/ledger-debts.service.ts`、`debts/counterparties.service.ts`、`ledgers/guards`、三個 controller |
| 206、207 | 移除有帳的成員 409；舊的自己退出 409 `LEAVE_REQUIRES_MERGE`                          | `ledgers/ledgers.service.ts` 的 `removeMember`                                                                |
| 204      | 共享帳本只剩我一個時 `removal-preview` 回 `blockedBy: null`；拿掉 `creatorId` 那一條 | `ledgers/ledgers.service.ts` 的 `removalPlan`                                                                 |

- 「統計」目前沒有彙總端點（首頁統計卡仍是「即將推出」），只能從各帳本的交易列表看。所以決策 189 的「不算進統計」由「打不開」達成：退出後這本帳本的交易列表、`settlement-summary` 都回 404。
- 單元測試；API e2e：SC-K4、SC-K9，SC-K3 中「打不開」的部分。

### 1.4 後端 C：合併計畫、預覽、退出（K3，worker）

依賴 K1。

- 新檔 `ledgers/ledger-leave-plan.ts`：純函式，輸入這本帳本跟我有關的交易、我的帳戶、指向、目標帳本分類，輸出 spec §2.3 每一列的寫入計畫與預覽數字。單元測試逐列涵蓋 §2.3。
- 新檔 `ledgers/ledger-leave.service.ts`：
  - `preview`：查資料 → 計畫 → `LedgerLeavePreview`。帳戶的 `balanceAfter` 沿用 `AccountsService.calculateBalances`（3j 已可傳資料庫交易與範圍）。
  - `leave`：spec §4.2 的擋下順序；同一個資料庫交易裡照 §4.2 的執行順序寫入。撤銷沿用 `DebtEntriesService.removeInTransaction`、`SplitsService.removeInTransaction`；`deleteLedger` 時照 3j §3 的順序刪帳本（沿用 `LedgersService` 的刪除內部函式）。
  - 帳本轉入的金額沿用 3f 決策 142 的計算（`settlements/ledger-summary.ts`），不另寫一套。
- `ledgers.controller.ts`：`POST /ledgers/{id}/leave-preview`、`POST /ledgers/{id}/leave`，DTO 驗證 `LeaveRequest`。
- 單元測試；API e2e：SC-K1、SC-K2、SC-K3、SC-K6、SC-K7、SC-K8、SC-K11。

### 1.5 後端 D：合併來的交易（K4，worker）

依賴 K1。

- `transactions.service.ts`：
  - 回應加 `merge`（`sourceLedgerName`、`share`）；合併過的交易 `accountPending` 為 `false`。
  - **交易列表由後端把同一個 `mergedFromId` 的兩筆合成一列**（比照分帳只回一列，3c §5.2）：回份額那一筆的 id，`amount` 是兩筆合計 T，`merge.share` 是份額 m；代墊那一筆不另列，分頁筆數照合成後算。份額是 0 時只有代墊一筆，照常列出，`merge.share` 為 `null`。前端只排版（W191）。
  - 補帳戶時這筆我合併過 → 409 `TRANSACTION_ALREADY_MERGED`（決策 199）。
  - 合併來的交易只能改名稱、分類、帳戶與刪除，其他欄位 400；同一個 `mergedFromId` 的兩筆一起改、一起刪（決策 202）。
  - 借還型別的交易端點限制照舊，`mergeId` 有值的例外。
- 單元測試；API e2e：SC-K5，與決策 202 的改與刪。

### 1.6 畫面（K5，worker）

只依賴 K0 的契約，可以跟後端平行（元件測試照既有作法用 `vi.mock` 替換 API）。

| 區塊           | 決策       | 主要檔案                                                                                        |
| -------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| 退出對話框     | W188       | 新元件 `features/ledgers/LeaveLedgerDialog.tsx`、`pages/LedgerDetailPage.tsx`、`use-ledgers.ts` |
| 選擇交易畫面   | W189       | 新元件 `features/ledgers/LeaveItemPicker.tsx`                                                   |
| 刪除共享帳本   | W190       | `features/ledgers/DeleteLedgerDialog.tsx`（只剩我一個時改用退出對話框的合併內容）               |
| 目標帳本的顯示 | W191、W192 | `features/transactions/TransactionList.tsx`、借還頁的往來紀錄列                                 |
| 移除成員被擋   | W193       | `features/ledgers/MemberList.tsx`                                                               |
| 拿掉歷史頁     | 決策 189   | `pages/LedgerHistoryPage.tsx` 與它的路由、連結                                                  |

- 數字一律來自 `leave-preview`，前端只排版。選擇畫面每勾一次就帶新的 `excludedItemIds` 重新取預覽；query key 含勾選狀態，只採用最新一次的結果。
- `lib/error-messages.ts` 補 4 個新錯誤碼的文字。
- 元件測試涵蓋 W188～W193。

### 1.7 e2e（K6，worker）

- Web e2e `ledger-leave-merge.spec.ts`：spec §6 的主線。
- 既有 Web e2e 用到「退出後唯讀」或歷史頁的，照新規則改；意圖不變的只調整找元素的方式。

## 2. 實作順序

1. K0（協調者）→ push 契約 commit。
2. 第 1 波平行：K1、K2、K5。
3. K1 驗收合併後，第 2 波平行：K3、K4。
4. K2～K5 合併後派 K6。
5. 協調者整體驗收、spec §9 的文件影響、PR、部署（K7）。

## 3. 風險與對策

| 風險                                           | 對策                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| 合併後帳戶餘額跟退出前不一樣                   | 計畫函式逐列單元測試；SC-K1 直接比對退出前後每個帳戶的 `GET /accounts`                 |
| 預覽數字跟執行結果不一樣                       | 預覽與執行共用 `ledger-leave-plan.ts`；SC-K11 比對預覽的 `balanceAfter` 與執行後的餘額 |
| 帳本轉入金額跟借還頁不一樣                     | 沿用 `ledger-summary.ts` 的計算；e2e 比對退出前借還頁的金額                            |
| 寫到一半失敗，留下一半合併的帳                 | 全部在一個資料庫交易；單元測試讓中途一步失敗，斷言沒有新交易、成員還在、帳戶不變       |
| 退出時清錯帳戶，改到別人的餘額                 | 只清 `userId` 是呼叫者的帳戶；隔離測試斷言其他成員的帳戶與交易不變                     |
| 目標帳本在退出途中被封存或被移除權限           | 目標帳本的檢查放進同一個資料庫交易並鎖該列；SC-K11 涵蓋                                |
| 新建分類撞到目標帳本既有的名稱                 | 決策 200 先找同類型、同名的；單元測試涵蓋找到與新建                                    |
| 選擇畫面連續勾選送出很多預覽請求，數字跳來跳去 | query key 含勾選狀態，畫面只顯示最新一次的回應；元件測試模擬快速連點                   |
| dev 上還有舊規則下退出的成員                   | 部署前跑 spec §8 的查詢，不是 0 就先照 2026-10-18 的作法用 API 加回                    |
| 拿掉「退出後唯讀」影響既有畫面與 e2e           | K5 一併拿掉歷史頁；K6 改既有 e2e；協調者驗收時跑兩套 e2e                               |

## 4. 驗證點

- 每個 worker：`pnpm lint / typecheck / test / format:check`；後端再跑自己資料庫的相關 API e2e。
- 協調者：
  - 逐行看 migration SQL、`ledger-leave-plan.ts`、`ledger-leave.service.ts`、`payer-account-rules.ts` 的 diff。
  - 自己重跑隔離測試（紅轉綠）、兩套 e2e；`pnpm build`。
- 部署後：dev 上用 a@a.com 建一本暫時的共享帳本，加 b@b.com，記 §1 的 3 筆。b@b.com 退出並合併，比對帳戶餘額與借還頁；最後 a@a.com 刪除帳本。做完確認暫時的帳本已刪。

## 5. 派工

| 波次 | worker        | 角色      | 範圍 | 驗收                                                  |
| ---- | ------------- | --------- | ---- | ----------------------------------------------------- |
| 0    | 協調者        | —         | §1.1 | 隔離測試紅燈；shared build 後 typecheck 通過          |
| 1    | `lvm-migrate` | `backend` | §1.2 | migration 在自己的資料庫套用成功；CHECK 用 SQL 驗證過 |
| 1    | `lvm-rules`   | `backend` | §1.3 | SC-K4、SC-K9 的 API e2e；隔離測試的對應部分轉綠       |
| 1    | `lvm-web`     | `default` | §1.6 | W188～W193 的元件測試；Web 檢查全綠                   |
| 2    | `lvm-leave`   | `backend` | §1.4 | SC-K1～K3、K6～K8、K11；隔離測試其餘部分轉綠          |
| 2    | `lvm-merged`  | `backend` | §1.5 | SC-K5 與決策 202 的 API e2e                           |
| 3    | `lvm-web-e2e` | `default` | §1.7 | 兩套 Web e2e 全綠                                     |

- 每個 worker 一個 `ledger_lvm_<名>_test` 資料庫，`.env` 與 `.env.test` 都指向它（`docs/orca-multi-agent.md` §5）。
- worker 不改 `packages/shared`（要改先問協調者）。
- K3 與 K2 都會動 `ledgers.service.ts`：K3 的程式放新檔，只呼叫 `LedgersService` 既有的刪除內部函式；合併時有衝突由協調者處理。

## 6. 實作紀錄

### K0（協調者，2026-10-18）

- shared 新檔 `types/ledger-leave.ts`：`LeaveRequest`、`LedgerLeavePreview`（項目、帳戶、帳本轉入、撤銷拆成具名型別）、`LEDGER_LEAVE_BLOCKERS`、`TransactionMerge`。
- spec 沒寫、契約補上的：`LEDGER_DELETE_BLOCKERS` 加 `HAS_OTHER_MEMBERS`。共享帳本還有其他成員時，刪除預覽要有一個原因可以顯示（W190 的「一行原因」）。
- 新的借還種類讓 web 兩張種類對照表少一項，先補「帳本轉入」（`entry-flow.ts`、`PendingCard.tsx`）；刪除對話框補 `HAS_OTHER_MEMBERS` 的原因。K5 可以再調。
- API 端 `merge` 先一律回 `null`，K4 填值。`debt-proposals.service.ts` 加一個型別收窄：Prisma 還沒有 `LEDGER_CARRY_OVER`，K1 之後可以拿掉。
- 隔離測試 9 條：8 條紅燈（端點不存在、移除與舊退出照舊 204、已退出的付款人仍記到臨時帳戶），1 條綠燈（沒帳的成員可以移除，防止 K2 擋過頭）。SC-K4 用資料庫刪成員模擬退出，K2 單獨就能轉綠。

### K5（lvm-web，2026-10-19）

- 完成退出與合併預覽、交易選擇器、共享帳本刪除、交易合併資訊與成員改檢視者流程；移除帳本歷史頁、路由及相關導覽分支。
- shared 的 `DebtEntry` 尚無來源帳本名稱欄位，`LEDGER_CARRY_OVER` 往來列暫顯示既有「帳本轉入」；未修改 shared 契約。
- 驗證：`pnpm lint`、`pnpm typecheck`、`pnpm --filter @ledger/web test`（102 個檔案、792 個測試）與 `pnpm format:check`。
