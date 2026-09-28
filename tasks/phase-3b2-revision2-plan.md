# 3b-2 修訂 2 實作計畫：對象頁只管人、交易頁只看帳

spec：`docs/specs/phase-3b2-web.md` §11（W52～W56、SC-W61～SC-W66）。純前端，不動後端、API、`packages/shared`。

## 1. 元件與相依

- **`features/counterparties/CounterpartyProfile.tsx`（新）**：讀 `useCounterparty(id)` 顯示人的資料；未連動另讀往來紀錄總數（沿用現有 hook、`limit` 最小）決定「刪除對象」是否出現。對話框（改名、設定暱稱、合併之前的紀錄、解除連動、刪除對象）從 `CounterpartyDetail` 原樣搬過來，文字不改。
- **`features/debts/CounterpartyDetail.tsx`**：刪掉管理按鈕、對應的 state 與對話框；`onDeleted` prop 隨之移除。`TransactionWorkbench` 的 `onCounterpartyDeleted` 一併移除。
- **`pages/CounterpartiesPage.tsx`**：拿掉 `TransactionWorkbench` 與 `recordEntry`；選人時用 `RightPanelContent` 放 `Dialog variant="panel" title="對象"`，`onClose` 呼叫 `useRightPanel().close()` 並清掉選取。刪除對象成功後也收起右側欄。W41 導覽（`readOpenCounterpartyState`）照舊。

## 2. 實作順序

1. 新增 `CounterpartyProfile` 與元件測試（先搬對話框與測試案例）。
2. 精簡 `CounterpartyDetail` 與測試。
3. 改 `CounterpartiesPage` 與測試（叉叉收起、無新增表單）。
4. 更新 e2e：管理動作改在對象頁操作；加 SC-W62 的叉叉檢查。

## 3. 風險與對策

- **e2e 依賴舊位置的按鈕**：`debts.spec.ts`、`debt-linking.spec.ts` 裡改名、刪除、合併、解除的步驟要改路徑。對策：協調者驗收時自己重跑兩套 e2e。
- **右側欄關閉的時序**：對象頁沒有預設內容，收起後 `RightPanelContent` 不渲染，第三欄回到 0 寬（與管理頁相同，App.tsx 已支援）。
- **不小心改到修訂 1 的文字**：對話框原樣搬移，驗收時比對 §10.2。

## 4. 驗證點

- 元件測試覆蓋 SC-W61～SC-W63。
- 手動：dev 環境依 SC-W61～SC-W64 各點一次（截圖給開發者）。
- `pnpm lint / typecheck / test / build / format:check`、Web e2e、API e2e（依序跑，不同時）。

## 5. 派工

純前端、不涉及授權與資料隔離，依開發者 2026-09-28 指示派 **Pi + `zai/glm-5.3`**（額度用盡再換下一層）。協調者驗收完整 diff 後開 PR。

## 6. 實作紀錄

（實作時填寫）
