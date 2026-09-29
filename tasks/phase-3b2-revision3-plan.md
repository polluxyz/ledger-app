# 3b-2 修訂 3 實作計畫：右側欄直接收起、明細直接編輯借還交易

spec：`docs/specs/phase-3b2-web.md` §12（W57～W61、SC-W67～SC-W71）。

## 1. 元件與相依

- **shared ＋ API（協調者自己做，已完成）**：`TransactionDebtRef.paired`；`transactions.service.ts` 的 include 多選 `pairedEntryId`。單元測試與 API e2e 補 `paired`。
- **Web（派 Pi + GLM）**：
  - `TransactionWorkbench`：`PanelTarget` 新增 `{ kind: 'debtTransaction'; transaction: Transaction }`，用 `Dialog variant="panel" title="編輯交易"` 包往來紀錄編輯表單。
  - `DebtEntryEditDialog`：把表單拆成可單獨使用的元件，讓右側欄重用；輸入改成「金額、日期、備註、paired、名字、entryId」而不是整個 `DebtEntry`。
  - `TransactionList`：`debt` 有值的列點了呼叫新的 `onEditDebtTransaction(transaction)`。
  - `TransactionsPage`、`HomePage`：關閉面板時切回 `new` 並呼叫 `useRightPanel().close()`。

## 2. 實作順序

1. shared ＋ API（完成）。
2. Web 全部由一個 worker 做（改動互相牽連，拆開反而衝突）。
3. 協調者驗收、重跑全部檢查與兩套 e2e。

## 3. 風險與對策

- **交易金額與往來紀錄金額的對應**：借還交易的金額等於 `|delta|`，代付支出也是；調整類紀錄（結清差額、免除）沒有交易，不會出現在明細。表單送出只帶有變更的欄位，後端是唯一驗證來源。
- **關閉後焦點**：右側欄收起後焦點回到觸發的列或按鈕；沿用現有的焦點處理，不另寫。
- **既有 e2e 依賴「關閉回到新增表單」**：`layout.spec.ts`、`transactions.spec.ts`、`debts.spec.ts` 可能要改；協調者重跑確認。

## 4. 驗證點

- 元件與頁面測試覆蓋 SC-W67～SC-W69。
- API 單元測試與 e2e 覆蓋 SC-W70（已過：單元 46、API e2e 141）。
- 全部檢查＋兩套 e2e。

## 5. 實作紀錄

（實作時填寫）
