# 3i 實作計畫：借還紀錄可以改名稱、帳戶、分類

spec：`docs/specs/phase-3i-debt-entry-edit.md`（決策 176～182、W178～W182、SC-I1～SC-I9）。後端、畫面、e2e 合成一個 PR。

> 核可：**已核可**（開發者 2026-10-15，與 spec 一起）。

## 0. 起點

- 整合分支：從 `main` 開 `feature/debt-entry-edit`。worker 從協調者的契約 commit 開分支，驗收後 merge 回來，最後一個 PR。
- 後端碰到帳戶授權與分類規則，派 `backend`；畫面與 e2e 派 `default`。模型看 `docs/orca-multi-agent.md` §0。
- 沒有 migration，部署只要 build 與重開 API。

## 1. 元件與相依

### 1.1 協調者自己做（I0：契約與隔離測試）

- `packages/shared`：
  - `UpdateDebtEntryRequest` 加 `title?: string | null`、`accountId?: string`、`categoryId?: string | null`。
  - `CreateDebtEntryRequest` 加 `title?: string`、`categoryId?: string`。
  - `DebtEntry` 加 `recorded: { ledgerId; accountId; title; categoryId } | null`。
  - 純函式 `debtCategoryTypeOf(kind)`：`LEND`／`REPAY` → `EXPENSE`，`BORROW`／`COLLECT` → `INCOME`，其他 → `null`，附 Node test。後端檢查與前端列清單都用它，方向只有一份。
- `apps/api/test/debt-entry-edit-isolation.e2e-spec.ts`：SC-I8，先看到紅燈。

### 1.2 後端（I1，worker）

- DTO：`UpdateDebtEntryDto`、`CreateDebtEntryDto` 加欄位與驗證（`title` 長度沿用交易的上限）。順手修 `debt-entry-record-target.dto.ts` 的舊說明。
- `TransactionsService`：
  - 新增 `assertDebtCategory(client, ledgerId, kind, categoryId)`：用 `debtCategoryTypeOf` 比對，不是這本帳本的 → 404。
  - `createDebtTransaction` 收 `categoryId`；`updateDebtTransaction` 收 `title`、`accountId`、`categoryId`。帳戶走 `assertSelectableAccount`。
- `debt-entries.service.ts`：
  - `assertEntryShape` 拿掉「`categoryId` 只能用在分帳」，改成交給上面的檢查。
  - `update`：沒有交易卻帶新欄位 → 409；改帳戶時分支一起改（`differenceOfId`）；`proposeAmend` 只在金額、日期變時呼叫（現狀已是，補測試鎖住）。
  - `toDebtEntry` 回 `recorded`：讀紀錄時一併 `include` 交易的 `ledgerId`、`accountId`、`title`、`categoryId`，不要每筆多查一次。
- 單元測試：分類方向 4 種、分支跟著換帳戶、只改新欄位不送提議。
- API e2e：`debt-entry-edit.e2e-spec.ts` 走 SC-I1～I7。

### 1.3 畫面（I2，worker）

| 區塊           | 決策           | 主要檔案                                                                                                          |
| -------------- | -------------- | ----------------------------------------------------------------------------------------------------------------- |
| 修改表單       | W178、W182     | `features/debts/DebtEntryEditDialog.tsx`（`DebtEntryEditForm`）、`features/transactions/TransactionWorkbench.tsx` |
| 新增表單       | W180、181、182 | `features/debts/DebtEntryForm.tsx`                                                                                |
| 免除、接受連動 | 182            | `features/debts/CounterpartyDetail.tsx`（免除剩餘）、`features/linking/PendingCard.tsx`                           |
| 明細列         | W179、W181     | `features/transactions/TransactionList.tsx`、`transaction-label.ts`                                               |

- `DebtEntryEditForm` 改收一個物件：金額（實收）、日期、備註、名稱、帳戶、分類、帳本 id、種類。交易頁從 `Transaction` 組，借還頁從 `DebtEntry.recorded` 組。
- 欄位順序比照 `TransactionForm`：金額、日期＋分類（同一列，沿用它的 `row` 樣式與分類選擇器）、帳戶、名稱、備註。
- 帳戶清單用 `selectableAccounts`（3h，不含臨時帳戶）；分類清單用該帳本的分類，依 `debtCategoryTypeOf(kind)` 過濾，加一個「不選」。
- 只送有變的欄位（現有做法）。「會送給〇〇確認」只在金額或日期有變時顯示。
- 決策 182：3 個表單拿掉帳本下拉，送出 `ledger.id`；帳戶預設改呼叫 `useRecordDefaults(ledger.id)`。目前帳本是檢視者或已封存時不顯示入口。
- W181：有分支的還款列改用分帳的展開鈕（›），細項兩行（`欠款 +$93`、`少收 −$3`，名稱靠左、金額靠右）放在展開區；拿掉 3h 修訂 1 的 `└` 分支行。`TransactionList.test.tsx` 與 `e2e/every-entry-account.spec.ts` 的分支斷言改成先展開。
- 元件測試涵蓋 SC-I9。

### 1.4 e2e（I3，worker）

- Web e2e `debt-entry-edit.spec.ts`：spec §6 的主線。
- 既有 Web e2e 若因表單多欄位而找不到元素，照新表單調整，意圖不變。

## 2. 實作順序

1. I0（協調者）→ push 契約 commit。
2. I1、I2 平行。
3. I1、I2 merge 回整合分支後派 I3。
4. 協調者整體驗收、PR、部署（build＋請開發者重開 API 與 Vite）。

## 3. 風險與對策

| 風險                                           | 對策                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| 改帳戶時漏改分支，帳戶合計不等於實收           | 單元測試與 SC-I1 都斷言兩個帳戶的餘額；分支用 `differenceOfId` 一次 `updateMany` |
| 分類方向前後端各寫一套                         | 只用 shared 的 `debtCategoryTypeOf`；後端是唯一的檢查點                          |
| `recorded` 讓列表每筆多一次查詢                | 讀紀錄時 `include` 交易欄位；協調者驗收時看 SQL 次數                             |
| 連動紀錄改帳戶時誤送提議，對方看到莫名的待確認 | SC-I5 斷言對方沒有提議                                                           |
| 明細列有分類後第一行變成分類名稱，看不出是借還 | W179 的元件測試                                                                  |

## 4. 驗證點

- 每個 worker：`pnpm lint / typecheck / test / format:check`；後端再跑自己資料庫的相關 API e2e。
- 協調者：逐行看 `assertDebtCategory`、`updateDebtTransaction` 的帳戶檢查與分支更新；自己重跑隔離測試（紅轉綠）、兩套 e2e；`pnpm build`。
- 部署後：dev 上把房東那筆改到別的帳戶再改回來，兩個帳戶的餘額都回到原值。

## 5. 派工

| 波次 | worker        | 角色      | 範圍 | 驗收                                               |
| ---- | ------------- | --------- | ---- | -------------------------------------------------- |
| 1    | 協調者        | —         | §1.1 | 隔離測試紅燈；shared build 後 typecheck 只剩未實作 |
| 1    | `dee-api`     | `backend` | §1.2 | SC-I1～I7 的 API e2e；隔離測試轉綠                 |
| 1    | `dee-web`     | `default` | §1.3 | SC-I9 的元件測試；Web 檢查全綠                     |
| 2    | `dee-web-e2e` | `default` | §1.4 | 兩套 Web e2e 全綠                                  |

- 每個 worker 一個 `ledger_dee_<名>_test` 資料庫，`.env` 與 `.env.test` 都指向它（`docs/orca-multi-agent.md` §5）。
- worker 不改 `packages/shared`（要改先問協調者）。

## 6. 實作紀錄

- **I0**（2026-10-15）：shared 型別與 `debtCategoryTypeOf`（Node test 116 條全過）；`debt-entry-edit-isolation.e2e-spec.ts` 6 條全紅（預期 404 拿到 400、`recorded` 為 undefined）。
- **I1**（`dee-api`，`backend`）：API e2e 36 suites／302 條、單元 468 條全綠；隔離測試 6 條轉綠。
  - worker 發現既有缺口：只改金額、日期、備註與撤銷，沒有檢查帳本寫入權（降為檢視者或封存後仍能改）。依協調者回覆，3i 只對新欄位加 `assertLedgerWritable`，既有行為不動，另案請開發者決定。
  - 協調者驗收時修：`updateDebtTransaction` 換帳戶時，缺 `callerUserId` 改成直接丟錯，不再拿交易建立者代替。
- **I2**（`dee-web`，`default`）：Web 100 檔／775 條全綠。把 `CategoryPicker` 從 `TransactionForm` 抽成共用元件，加「不選」。
- **協調者合併後修**：舊的 `PAID_FOR_ME` 紀錄沒有帳戶，API 改成名稱、帳戶、分類只開放借出、借入、收回、還款（其他 409 `DEBT_ENTRY_NOT_EDITABLE`），表單也不顯示這 3 個欄位；名稱欄 `maxLength` 從 200 改成 100，對齊 API。合併後單元測試：shared 116、API 471、Web 776 全綠。
- **I3**（`dee-web-e2e`，`default`）：worker 寫完新主線與 3 個既有測試的調整，但 Orca 夜裡重開，終端機在回報前關掉（dispatch 標為 failed），改動留在 worktree 沒 commit。協調者接手驗收、跑完整 Web e2e 發現 2 條失敗並修好：
  - `phase-3c-split.spec.ts` 接受連動時還在選帳本（決策 182 拿掉了）。
  - `debts.spec.ts` 用 API 補的借出用「現在時間」，畫面記的是「當地日期的 UTC 0 點」；在 UTC+8 早上 8 點前會排到前一天，未還清的切點就錯。改成同一天的 UTC 中午。CI 跑在 UTC，碰不到。
  - 最後 Web e2e 58 條全綠。
