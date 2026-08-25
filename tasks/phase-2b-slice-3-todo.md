# 任務清單：階段二 (2b) Slice 3 — 交易的完整生命週期（前端）

> 狀態：**已核可**（2026-08-25）
> 依據：`docs/specs/phase-2-web-mvp.md`、`tasks/phase-2b-slice-3-plan.md`（Plan 已核可）。
> 用法：依序執行；每個任務有驗收條件。勾選＝「開發者已驗收」。
> 通用驗收（每任務皆適用，不再重複）：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全綠。
> 分支：`feature/transaction-lifecycle`（自 `main` 開）。**本切片不改後端。**

### 設計決策（已於 Plan §4 核可，實作時一律照此）

| #   | 結論                                                                                 |
| --- | ------------------------------------------------------------------------------------ |
| D1  | 編輯與新增共用 `TransactionForm`；編輯包進 `Dialog`                                  |
| D2  | 別人的交易：帳戶欄位鎖住，不渲染下拉。判斷條件是 `tracksBalance && account === null` |
| D3  | 帳戶鎖住時型別不給「轉帳」；反方向（轉帳改成支出）允許，且不可逆                     |
| D4  | 篩選狀態放元件 state，不寫進網址                                                     |
| D5  | `useCategories` 的 `type` 改為可選；轉帳時分類篩選停用                               |
| D6  | 分頁用上一頁 / 下一頁；`keepPreviousData`；改篩選回第 1 頁                           |
| D7  | 轉帳：非連動帳本不出現；帳戶少於 2 個給引導並停用送出                                |
| D8  | 編輯時清空備註送 `''`；新增維持「空的不送」                                          |
| D9  | query key 帶查詢參數；編輯與刪除都要失效 `ACCOUNTS_KEY`                              |
| D10 | 刪除用 `ConfirmDialog`，不要求打字；文案寫明無法復原                                 |
| D11 | e2e 補 3 條（編號 7、8、9）；篩選與分頁不進 e2e                                      |

---

## Step 0：開工前的清債（與本切片無關，先做掉）

- [ ] **0.1 開分支**
  - 內容：自 `main` 開 `feature/transaction-lifecycle`。
  - 驗收：`main` 未被動到。
- [ ] **0.2 修正 `docs/specs/phase-2-web-mvp.md` §9 的三處過期記述**
  - 內容：Step 5（Slice 2）打勾；技術債表刪掉「`ProtectedRoute` 重新啟用」（已完成，見 `app/ProtectedRoute.tsx` 與 `lib/safe-redirect.ts`）；刪掉「CI 的 web job」（`ci.yml` 的根目錄遞迴指令早已涵蓋 web，另有 Playwright 步驟）。
  - 驗收：表格只剩仍然成立的項目。
- [ ] **0.3 收攏 `showModal` 替身**
  - 內容：7 個測試檔各有一份 jsdom 的 `showModal` / `close` 替身（`ConfirmDialog`、`Dialog`、`accounts`、`AuthDialog`、`ledgers`、`members`、`LedgerDetailPage`）。移到 `src/test/setup.ts` 的全域 `beforeEach`，每個測試都拿到乾淨的替身。
  - 注意：`Dialog.test.tsx` 會斷言 `showModal` 被呼叫過，改成從 `HTMLDialogElement.prototype` 取那個替身。
  - 驗收：`pnpm --filter @ledger/web test` 112 條全綠，數量不變。

## Step 1：資料層

- [ ] **1.1 `useTransactions` 支援查詢參數**
  - 內容：第二個參數收 `ListTransactionsQuery`，用 `URLSearchParams` 組查詢字串（空值不送）。query key 改為 `['transactions', ledgerId, query]`（D9）。加 `placeholderData: keepPreviousData`（D6）。
  - 補充：query key 的前綴抽成 `transactionsKey(ledgerId)` 匯出，供失效時使用。
  - 驗收：型別綠；既有測試不受影響（不帶參數時行為相同）。
- [ ] **1.2 `useUpdateTransaction` / `useDeleteTransaction`**
  - 內容：`PATCH /ledgers/:id/transactions/:txId`、`DELETE`（回 204，`apiRequest` 已處理）。成功後同時失效 `transactionsKey(ledgerId)` 與 `ACCOUNTS_KEY`。
  - 驗收：型別綠。

## Step 2：轉帳（新增模式）

- [ ] **2.1 型別鈕變三顆**
  - 內容：`TransactionForm` 的 type state 從 `CategoryType` 放寬為 `TransactionType`。轉帳鈕只在 `ledger.tracksBalance` 時渲染（D7）。
  - 驗收：非連動帳本沒有轉帳鈕。
- [ ] **2.2 轉帳的欄位規則**
  - 內容：選轉帳時隱藏分類、顯示「轉入帳戶」（排除已選的轉出帳戶），送出帶 `toAccountId`、不帶 `categoryId`。
  - 驗收：元件測試比對送出的 body。
- [ ] **2.3 帳戶少於 2 個的引導**
  - 內容：選轉帳但帳戶不足 2 個時，顯示引導文字並停用送出鈕（D7）。
  - 驗收：元件測試。

## Step 3：編輯模式

- [ ] **3.1 `TransactionForm` 收選填的 `transaction`**
  - 內容：有值＝編輯模式。所有欄位預填；送出改走 `useUpdateTransaction`；成功後呼叫 `onSaved`。按鈕文字改「儲存」。
  - 注意：編輯模式送出後**不清空欄位**（那是新增模式為了連續記帳才做的）。
  - 驗收：元件測試：預填正確、送出的是 PATCH。
- [ ] **3.2 帳戶鎖定（D2、D3）**
  - 內容：`ledger.tracksBalance && transaction.account === null` 時不渲染帳戶下拉，改顯示說明文字；送出不帶 `accountId`；型別鈕不給轉帳。
  - 驗收：元件測試釘住「送出的 body 沒有 `accountId`」。
- [ ] **3.3 清空備註（D8）**
  - 內容：編輯模式的備註為空時送 `''`。
  - 驗收：元件測試比對 body。
- [ ] **3.4 `TransactionDialog`**
  - 內容：把表單包進 `Dialog`，標題「編輯交易」。資料流（開哪一筆、關閉）留在 `HomePage`。
  - 驗收：元件測試：開啟後看得到預填值。

## Step 4：刪除

- [ ] **4.1 `TransactionList` 加編輯 / 刪除入口**
  - 內容：比照 `AccountList` 的 `onEdit` / `onRemove` 與 `aria-label`（例如「編輯 8/12 的午餐」之類可辨識的字串）。
  - 驗收：元件測試用 `getByRole('button', { name: ... })` 找得到。
- [ ] **4.2 刪除確認與送出**
  - 內容：`ConfirmDialog`，文案寫明無法復原（D10）。失敗不關彈窗（比照 `AccountsPage`）。
  - 驗收：元件測試：確認後該筆從列表消失。
- [ ] **4.3 兩條快取失效測試**（原 Step 1.3，因為要走真實畫面操作才移到這裡）
  - 內容：比照 `use-transactions.test.tsx` 既有的新增案例，為編輯與刪除各補一條：操作後 `/accounts` 必須被重新請求，且新數字出現在畫面上。
  - 驗收：測試綠；把 `ACCOUNTS_KEY` 那行拿掉會變紅（自行驗一次再改回來）。

## Step 5：篩選

- [ ] **5.1 `useCategories` 的 `type` 改為可選（D5）**
  - 內容：`type?: CategoryType`；沒給就不帶 `?type=`。query key 帶 `type`。
  - 驗收：既有兩個呼叫點不受影響。
- [ ] **5.2 `TransactionFilters` 元件**
  - 內容：型別、分類、起日、迄日、清除篩選。轉帳時分類停用並說明。
  - 注意：`to` 要補成當天 23:59:59.999 再送（Plan §6）。
  - 驗收：元件測試：改型別後請求帶 `?type=`。

## Step 6：分頁與首頁串接

- [ ] **6.1 `components/Pagination.tsx`**
  - 內容：上一頁 / 下一頁 ＋「第 X / Y 頁」。第 1 頁停用上一頁，最後一頁停用下一頁。總數為 0 時不渲染。
  - 驗收：元件測試。
- [ ] **6.2 `HomePage` 串接**
  - 內容：篩選與頁碼的 state、編輯與刪除的彈窗資料流。**改篩選就把頁碼設回 1**（D6）。
  - 驗收：元件測試涵蓋換頁與篩選重置。

## Step 7：e2e 與文件回寫

- [ ] **7.1 三條 e2e 情境（D11）**
  - 內容：新增 `e2e/transactions.spec.ts`，情境 7（編輯改金額 → 餘額變）、8（刪除 → 消失）、9（轉帳 → 兩邊餘額都動）。前置資料用 `e2e/api.ts` 建立。
  - 注意：元素一律用 `getByRole` / `getByLabel` / `getByText`；不用 CSS class；不用 `waitForTimeout`。整頁搜尋文字容易撞到下拉選項，用 `getByRole('listitem').filter({ hasText })` 縮小範圍。
  - 驗收：`pnpm --filter @ledger/web test:e2e` 共 11 條全綠。
- [ ] **7.2 文件回寫**
  - 內容：2e spec §7 補三條情境、§8 補「篩選與分頁不進 e2e」、§11 補實作紀錄；`docs/specs/phase-2-web-mvp.md` §9 的 Step 6 打勾。
  - 驗收：文件與實作一致。

## Step 8：收尾

- [ ] **8.1 全套指令**
  - 內容：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm format:check`、兩套 e2e。
  - 注意：本機不可同時跑 api 與 web 的 e2e，兩者共用 `ledger_test`。
  - 驗收：全綠。
- [ ] **8.2 瀏覽器實測**
  - 內容：照 Plan §7 的七條逐項走過。
  - 驗收：SC-10、SC-15 逐條核對通過。
