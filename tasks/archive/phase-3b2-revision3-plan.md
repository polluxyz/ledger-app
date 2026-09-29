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

2026-09-30 完成。

1. **派工**：先派 Pi + GLM，開發者中途指示改派 Codex（`gpt-6-luna` max）；GLM 停掉時還沒改任何檔案。Codex 用同一份 Task spec 在同一個 worktree 做完 Web。
2. **驗收發現（計畫外）**：借還交易本身的 `note` 一律是 `null`，備註存在往來紀錄上。面板若帶 `transaction.note` 會顯示空白，使用者填字就蓋掉原備註。開發者同意在 `Transaction.debt` 再補 `note`（W60 已更新），協調者自己改 shared、API 與 Web 的帶值，並把測試 fixture 改成真實形狀（交易 note 為 null、備註在 debt.note）。
3. **e2e 修正**：Codex 寫的 `getByRole('button', { name: /小明/ })` 在切換檢視的當下會同時命中明細列，改成 `/^小明/`。
4. **新增的共用 helper**：`features/transactions/transaction-label.ts`（列與面板共用標籤）。
