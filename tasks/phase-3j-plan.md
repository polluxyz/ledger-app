# 3j 實作計畫：帳本的刪除、封存、取消封存

spec：`docs/specs/phase-3j-ledger-delete-archive.md`（決策 183～188、W183～W186、SC-J1～SC-J7）。後端、畫面、e2e 合成一個 PR。

> 核可：**已核可**（開發者 2026-10-17 選 A 縮小範圍，與 spec 一起）。

## 0. 起點

- 整合分支：`feature/ledger-leave-delete`（已從 `main` 開好，worktree `lld-integration`）。worker 從協調者的契約 commit 開分支，驗收後 merge 回來，最後一個 PR。
- 授權與刪除時的關聯處理派 `backend`；畫面與 e2e 派 `default`。模型看 `docs/orca-multi-agent.md` §0。
- 不改資料表與欄位、不改餘額公式。有 1 個放寬 CHECK 的 migration（spec §3），部署要先備份 `ledger_dev`、`migrate deploy`、build、重開 API。

## 1. 元件與相依

### 1.1 協調者自己做（J0：契約與隔離測試）

- `packages/shared`：
  - 型別 `LedgerRemovalPreview`（spec §4.2）。
  - 錯誤碼 `LEDGER_NOT_ARCHIVED`、`DEBT_WITHDRAWAL_REQUIRED`。
- `apps/api/test/ledger-delete-archive-isolation.e2e-spec.ts`：SC-J1、SC-J6、SC-J2 的權限部分，先看到紅燈。

### 1.2 後端 A：借還寫入權（J1，worker）

- `debt-entries.service.ts`：`update` 拿掉「只有新欄位才檢查」的條件，有交易就 `assertLedgerWritable`；`remove` 同樣檢查（決策 183）。
- `debt-proposals.service.ts`：`acceptAmend`、`acceptDelete` 在目標有交易時檢查目標交易所在帳本；拒絕不檢查。
- 單元測試、API e2e：SC-J1。

### 1.3 後端 B：取消封存、預覽、刪除（J2，worker）

- `POST /ledgers/{id}/unarchive`（決策 184）。
- 刪除（`remove`）：spec §4.3 的擋下順序；決策 187 的「記到別人帳戶」檢查；私人帳本撤銷借還與分帳（沿用 `DebtEntriesService.remove` 與 `SplitsService.remove` 的內部函式，同一個資料庫交易，不另寫一套撤銷）；撤銷後依 spec §3 處理關聯，再刪帳本。做不到要改 schema → 停下來回報協調者。
- `GET /ledgers/{id}/removal-preview`（決策 188）：「能不能刪」與刪除共用同一個檢查函式；帳戶的 `balanceAfter` = 現在餘額 − 這本帳本的有效交易對該帳戶的影響（沿用 `accounts.service.ts` 的 `directionOf`）；對象的 `balanceAfter` = 現在餘額 − 我在這本帳本的有效往來紀錄的影響（含分支、分帳產生的）。
- 單元測試、API e2e：SC-J2～J5。

### 1.4 畫面（J3，worker）

| 區塊     | 決策 | 主要檔案                                                                                                                       |
| -------- | ---- | ------------------------------------------------------------------------------------------------------------------------------ |
| 刪除     | W183 | `pages/LedgerDetailPage.tsx`、新元件 `features/ledgers/DeleteLedgerDialog.tsx`、`features/ledgers/use-ledgers.ts`              |
| 封存     | W184 | `pages/LedgerDetailPage.tsx`                                                                                                   |
| 取消封存 | W185 | `pages/LedgerDetailPage.tsx`、`features/ledgers/use-ledgers.ts`（新 hook）                                                     |
| 借還頁   | W186 | `features/debts/DebtEntriesList.tsx`、`CounterpartyDetail.tsx`、`DebtHistoryView.tsx`、`transactions/TransactionWorkbench.tsx` |

- 刪除對話框的資料來自 `removal-preview`，前端只排版不計算。預覽 `withdrawsDebts` 為真時送 `withdrawDebts=true`。
- W186：用 `GET /ledgers?includeArchived=true` 的角色與封存狀態判斷每一筆的帳本能不能寫。
- `lib/error-messages.ts` 補兩個新錯誤碼的文字。
- 元件測試涵蓋 SC-J7。

### 1.5 e2e（J4，worker）

- Web e2e `ledger-delete-archive.spec.ts`：spec §6 的主線，加取消封存。
- 既有 Web e2e 若因封存不用打名稱、刪除對話框改版而找不到元素，照新畫面調整，意圖不變。

## 2. 實作順序

1. J0（協調者）→ push 契約 commit。
2. J1、J2、J3 平行。
3. 三者 merge 回整合分支後派 J4。
4. 協調者整體驗收、PR、部署。

## 3. 風險與對策

| 風險                           | 對策                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------- |
| 預覽的數字跟實際刪除後不一樣   | 預覽與刪除共用同一個檢查與查詢；SC-J5 直接比對前後的 `GET /accounts` 與對象餘額 |
| 刪除帳本卡在 `Restrict` 關聯   | spec §3 的處理順序；e2e 涵蓋有分支的還款與分帳；真的不行就停下來問              |
| 撤銷時誤撤別人的往來紀錄       | 只查呼叫者自己的對象底下的紀錄；SC-J6 斷言別人的紀錄不變                        |
| 撤銷與刪除沒在同一個資料庫交易 | 單元測試讓第 2 筆撤銷失敗，斷言第 1 筆也沒撤銷、帳本還在                        |
| 決策 187 將來忘了放寬          | spec §1「延後」寫明放寬條件；`remove` 的檢查旁註解指回 spec；記進專案決策脈絡   |

## 4. 驗證點

- 每個 worker：`pnpm lint / typecheck / test / format:check`；後端再跑自己資料庫的相關 API e2e。
- 協調者：逐行看 `assertLedgerWritable` 的新呼叫點、刪除的擋下順序與關聯處理；自己重跑隔離測試（紅轉綠）、兩套 e2e；`pnpm build`。
- 部署後：dev 上用測試帳號建一本暫時的私人帳本，記支出與借出，看預覽數字與刪除後一致，做完確認帳本已刪。

## 5. 派工

| 波次 | worker        | 角色      | 範圍 | 驗收                                         |
| ---- | ------------- | --------- | ---- | -------------------------------------------- |
| 1    | 協調者        | —         | §1.1 | 隔離測試紅燈；shared build 後 typecheck 通過 |
| 1    | `lld-api-a`   | `backend` | §1.2 | SC-J1 的 API e2e；隔離測試的 J1 部分轉綠     |
| 1    | `lld-api-b`   | `backend` | §1.3 | SC-J2～J5；隔離測試其餘部分轉綠              |
| 1    | `lld-web`     | `default` | §1.4 | SC-J7 的元件測試；Web 檢查全綠               |
| 2    | `lld-web-e2e` | `default` | §1.5 | 兩套 Web e2e 全綠                            |

- 每個 worker 一個 `ledger_lld_<名>_test` 資料庫，`.env` 與 `.env.test` 都指向它（`docs/orca-multi-agent.md` §5）。
- worker 不改 `packages/shared`（要改先問協調者）。

## 6. 實作紀錄

- 2026-10-17：原 spec 含退出規則（餘額只算成員帳本），寫完發現跟 3f 決策 152 衝突，開發者選 A 縮小範圍；同時補決策 187。
- 2026-10-17：J2 發現 `PAID_FOR_ME`／`RECEIVED_FOR_ME` 的 CHECK 擋住刪除私人帳本，開發者同意放寬（spec §3）；`Transaction.splitId` 的 `Restrict` 在刪分帳前清掉。J2 把撤銷抽成 `DebtEntriesService.removeInTransaction`、`SplitsService.removeInTransaction`，協調者合併時把 J1 的寫入權檢查搬進前者。`AccountsService.calculateBalances` 改成可傳資料庫交易與範圍，預覽用同一個公式算影響。
