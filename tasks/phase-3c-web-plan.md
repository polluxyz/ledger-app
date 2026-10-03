# 3c 畫面實作計畫：代墊與分帳

spec：`docs/specs/phase-3c-web.md`（W62～W88、SC-W72～SC-W81）。與 3c 後端（`tasks/phase-3c-plan.md`）平行開發，最後合進同一個 PR。

> 核可：開發者 2026-10-03 指示「平行進行、等完成再叫我」，本 plan 由協調者依已核可的方向自行核可。

## 1. 元件與相依

- **`components/DebtArrow.tsx`（新）**：W82、W83。props：`from`、`to`（顯示名稱，「我」由呼叫端傳）、`amount`（分）、`srText`（讀屏句子）。
- **`features/transactions/TransactionForm.tsx`**：W62～W68、W78、W79。表單變大，拆出子元件：
  - `PaymentRow`（帳戶列與切換圖示、付款人、預覽箭頭）
  - `SplitSection`（開關、名單、「›」、箭頭預覽）
  - `SplitOptionsView`（側欄內換頁，W69～W73）
  - 送出邏輯 `submitTransactionOrSplit`（W68）：選端點、先建新名字的對象、組 body。
- **`features/transactions/use-splits.ts`（新）**：`useCreateSplit`、`useUpdateSplit`、`useDeleteSplit`、`useSplit(id)`，成功後讓交易、帳戶、對象、往來的查詢失效（沿用 `use-debts.ts` 的做法）。
- **`TransactionList.tsx`、`pages/HomePage.tsx`**：W74～W77。
- **`features/debts/CounterpartyDetail.tsx`**：W80、W84。
- **`CounterpartyList.tsx`、`CounterpartyPicker.tsx`、`DebtEntryForm.tsx`、`DebtEntryEditDialog.tsx`**：W63、W84。
- **`features/linking/PendingCard.tsx`**：W84～W87。
- **`lib/error-messages.ts`**：W88。

## 2. 實作順序

1. `DebtArrow` 與元件測試；W84 的既有畫面替換（測試的文字斷言靠 W83 的讀屏文字沿用）。
2. 表單：名稱、順序、「選填」（W62、W63）。
3. `PaymentRow`（W64、W65）。
4. `SplitSection` 與 `SplitOptionsView`（W66、W67、W69～W73）。
5. 送出與編輯（W68、W78、W79）、`use-splits.ts`。
6. 列表與總覽（W74～W77）、往來帳明細（W80、W81）。
7. 待確認卡片（W85～W87）、錯誤訊息（W88）。
8. Web e2e：SC-W80 一條主線；修既有 e2e。

## 3. 風險與對策

| 風險                                            | 對策                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 後端還沒合併，畫面接不到真的 API                | 元件測試用 mock；型別全部來自 `@ledger/shared`。Web e2e 等後端合併後由協調者跑，失敗的再派回修   |
| 在前端算份額，違反單一後端原則                  | 份額只用 `@ledger/shared` 的 `computeSplitShares` 預覽，送出的是分法與輸入值，份額以後端回應為準 |
| 子頁面與右側欄的 ✕、動畫衝突（3b-2 回報過三次） | 子頁面不放 ✕（W69）；右側欄 ✕ 照舊直接收起；子頁面的收起不卸載內容的規則比照 #84                 |
| `TransactionForm` 太大                          | 依 §1 拆子元件，每個有自己的測試                                                                 |
| 既有 e2e 依賴「欠你」文字                       | W83 的讀屏文字保留原句，`getByText` 多半照舊找得到；找不到的改用 role 或新結構                   |

## 4. 驗證點

- worker：`pnpm --filter @ledger/shared build`、`pnpm --filter @ledger/web lint / typecheck / test / build`。
- 協調者（合併後端之後）：Web e2e 全綠；在 dev 環境依 §1 的 5 個情境各點一次；截圖給開發者。

## 5. 派工

- **一個 Codex `gpt-6-luna` max worker**，worktree `split-web`，從 `feature/split` 的契約 commit 開出。純前端，額度用盡照備援順序換。
- 只改 `apps/web/`；`packages/shared` 要改先問協調者；不跑 e2e（後端 worker 在跑 API e2e）。

## 6. 實作紀錄

（實作時填寫）
