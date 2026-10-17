# 3j 實作計畫：帳本的退出、刪除、封存

spec：`docs/specs/phase-3j-ledger-leave-delete.md`（決策 183～191、W183～W187、SC-J1～SC-J9）。後端、畫面、e2e 合成一個 PR。

> 核可：**已核可**（開發者 2026-10-17，與 spec 一起）。

## 0. 起點

- 整合分支：從 `main` 開 `feature/ledger-leave-delete`。worker 從協調者的契約 commit 開分支，驗收後 merge 回來，最後一個 PR。
- 授權、餘額、刪除時的關聯處理都派 `backend`；畫面與 e2e 派 `default`。模型看 `docs/orca-multi-agent.md` §0。
- 不改 schema、沒有 migration。部署要 build、重開 API，並先查「部署後餘額會變的帳戶」（spec §8）。

## 1. 元件與相依

### 1.1 協調者自己做（J0：契約與隔離測試）

- `packages/shared`：
  - 型別 `LedgerRemovalPreview`（spec §4.2）。
  - 錯誤碼 `LEDGER_NOT_ARCHIVED`、`LEDGER_HAS_OTHER_MEMBERS`、`DEBT_WITHDRAWAL_REQUIRED`、`MEMBER_HAS_TRANSACTIONS`。
- `apps/api/test/ledger-leave-delete-isolation.e2e-spec.ts`：SC-J1、SC-J8、SC-J2 的權限部分，先看到紅燈。

### 1.2 後端 A：借還寫入權與餘額（J1，worker）

- `debt-entries.service.ts`：`update` 拿掉「只有新欄位才檢查」的條件，有交易就 `assertLedgerWritable`；`remove` 同樣檢查（決策 183）。
- `debt-proposals.service.ts`：`acceptAmend`、`acceptDelete` 在目標有交易時檢查目標交易所在帳本；拒絕不檢查。
- `accounts.service.ts` `calculateBalances`：交易條件加「帳本成員裡有帳戶主人」（決策 186），轉入（`toAccountId`）也一樣。`used`（能不能刪帳戶）照舊看全部交易。
- 匯出一個純函式「這筆交易對某帳戶的影響」（沿用 `directionOf`），給 J2 的預覽用。**函式名稱與簽名先在 J0 的 Task spec 寫定**，J1、J2 照同一份。
- 單元測試、API e2e：SC-J1、SC-J3。

### 1.3 後端 B：取消封存、預覽、退出、刪除（J2，worker）

- `POST /ledgers/{id}/unarchive`（決策 184）。
- `GET /ledgers/{id}/removal-preview`（決策 191）：帳戶的 `balanceAfter` = 現在餘額 − 我的帳戶在這本帳本的有效交易影響；對象的 `balanceAfter` = 現在餘額 − 我在這本帳本的有效往來紀錄的 `delta`（含分支、分帳產生的）。退出、刪除共用同一個「這本帳本裡我的東西」查詢。
- 退出（`removeMember` 移除自己）：決策 188 的 `withdrawDebts`；撤銷沿用 `DebtEntriesService.remove` 與 `SplitsService.remove` 的內部函式（同一個資料庫交易，不另寫一套撤銷）。
- 移除別人：決策 190。
- 刪除（`remove`）：決策 189 的條件；撤銷後依 spec §3 處理關聯，再刪帳本。做不到要改 schema → 停下來回報協調者。
- 單元測試、API e2e：SC-J2、SC-J4～J7。

### 1.4 畫面（J3，worker）

| 區塊     | 決策 | 主要檔案                                                                                                                       |
| -------- | ---- | ------------------------------------------------------------------------------------------------------------------------------ |
| 刪除     | W183 | `pages/LedgerDetailPage.tsx`、新元件 `features/ledgers/RemovalDialog.tsx`                                                      |
| 退出     | W184 | 同上（退出、移除成員的彈窗）                                                                                                   |
| 封存     | W185 | `pages/LedgerDetailPage.tsx`                                                                                                   |
| 取消封存 | W186 | `pages/LedgerDetailPage.tsx`、`features/ledgers/use-ledgers.ts`（新 hook）                                                     |
| 借還頁   | W187 | `features/debts/DebtEntriesList.tsx`、`CounterpartyDetail.tsx`、`DebtHistoryView.tsx`、`transactions/TransactionWorkbench.tsx` |

- 刪除與退出共用一個對話框元件，資料來自 `removal-preview`，前端只排版不計算。
- 有借還時送 `withdrawDebts=true`。
- W187：用 `GET /ledgers?includeArchived=true` 的角色與封存狀態判斷每一筆的帳本能不能寫。
- 元件測試涵蓋 SC-J9。

### 1.5 e2e（J4，worker）

- Web e2e `ledger-leave-delete.spec.ts`：spec §6 的主線。
- 既有 Web e2e 若因封存不用打名稱、刪除對話框改版而找不到元素，照新畫面調整，意圖不變。

## 2. 實作順序

1. J0（協調者）→ push 契約 commit。
2. J1、J2、J3 平行。J2 依賴 J1 的影響函式：名稱與簽名在 J0 寫定，J2 先照簽名呼叫，合併時以 J1 的實作為準。
3. 三者 merge 回整合分支後派 J4。
4. 協調者整體驗收、PR、部署前查受影響帳戶、部署。

## 3. 風險與對策

| 風險                                                 | 對策                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 預覽的數字跟實際執行後不一樣                         | 預覽與執行共用同一個「這本帳本裡我的東西」查詢；SC-J5 直接比對前後的 `GET /accounts` |
| 刪除帳本卡在 `Restrict` 關聯                         | spec §3 的處理順序；e2e 涵蓋有分支的還款與分帳；真的不行就停下來問                   |
| 撤銷時誤撤別人的往來紀錄                             | 只查呼叫者自己的對象底下的紀錄；SC-J8 斷言別人的紀錄不變                             |
| 部署後已退出的人餘額突然變                           | 部署前查出受影響的帳戶列給開發者（spec §8）                                          |
| 餘額查詢多一層成員條件變慢                           | 只多一個 `EXISTS`；協調者驗收時看 SQL                                                |
| 退出與刪除的撤銷沒在同一個資料庫交易，失敗時只做一半 | 單元測試讓第 2 筆撤銷失敗，斷言第 1 筆也沒撤銷、還是成員                             |

## 4. 驗證點

- 每個 worker：`pnpm lint / typecheck / test / format:check`；後端再跑自己資料庫的相關 API e2e。
- 協調者：逐行看 `assertLedgerWritable` 的新呼叫點、餘額查詢、刪除的關聯處理；自己重跑隔離測試（紅轉綠）、兩套 e2e；`pnpm build`。
- 部署前：重跑 spec §8 的兩個查詢，結果給開發者看。
- 部署後：dev 上用測試帳號看預覽數字與實際退出後一致（用暫時建的帳本，做完刪掉）。

## 5. 派工

| 波次 | worker        | 角色      | 範圍 | 驗收                                         |
| ---- | ------------- | --------- | ---- | -------------------------------------------- |
| 1    | 協調者        | —         | §1.1 | 隔離測試紅燈；shared build 後 typecheck 通過 |
| 1    | `lld-api-a`   | `backend` | §1.2 | SC-J1、J3 的 API e2e；隔離測試的 J1 部分轉綠 |
| 1    | `lld-api-b`   | `backend` | §1.3 | SC-J2、J4～J7；隔離測試其餘部分轉綠          |
| 1    | `lld-web`     | `default` | §1.4 | SC-J9 的元件測試；Web 檢查全綠               |
| 2    | `lld-web-e2e` | `default` | §1.5 | 兩套 Web e2e 全綠                            |

- 每個 worker 一個 `ledger_lld_<名>_test` 資料庫，`.env` 與 `.env.test` 都指向它（`docs/orca-multi-agent.md` §5）。
- worker 不改 `packages/shared`（要改先問協調者）。

## 6. 實作紀錄

（實作時填）
