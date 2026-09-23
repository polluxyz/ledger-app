# 實作計畫：階段三 (3b-1) — 單邊借還

> 狀態：**已核可**（2026-09-24）
> 依據：`docs/specs/phase-3b-debts.md`（2026-09-24 核可；開發者表示不完備處等實際成果出來再調整）。
> 對應成功條件：SC-D1～SC-D12、SC-D22。
> 分支：`feature/debts-single`（自 `main` 開）。
> 範圍：只做 3b-1。3b-2（連動）的 plan 等 3b-1 合併、開發者看過成果後再寫。

---

## 1. 元件與相依

```
packages/shared/src/
├── types/transaction.ts        修改：TRANSACTION_TYPES 擴充為 7 種；新增 MANUAL_TRANSACTION_TYPES、DEBT_TRANSACTION_TYPES；Transaction.debtId
├── types/debt.ts               新增：Debt、DebtPayment、DebtSummary 與請求型別
├── constants/error-codes.ts    修改：本步用到的 6 個錯誤碼
└── index.ts                    修改：匯出

apps/api/prisma/
├── schema.prisma               修改：TransactionType 加 4 值；DebtDirection；Debt、DebtPayment
└── migrations/<新>/            新增：DDL + 手寫 CHECK（本金、還款金額 > 0）

apps/api/src/accounts/accounts.service.ts          修改：餘額加總改成窮舉型別
apps/api/src/transactions/transactions.service.ts  修改：借還交易唯讀、回應帶 debtId、對外提供「寫一筆借還交易」
apps/api/src/transactions/dto/*.dto.ts             修改：create / update 改用 MANUAL_TRANSACTION_TYPES
apps/api/src/ledgers/ledgers.service.ts            修改：帳本內有借還交易時禁止真刪

apps/api/src/debts/
├── debts.module.ts
├── debts.controller.ts         /debts、/debts/summary、/debts/{id}
├── debt-payments.controller.ts /debts/{id}/payments、/debts/{id}/forgive
├── debts.service.ts            W1：建立、列表、單筆、修改、刪除、每人淨額
├── debt-payments.service.ts    W2：記還款、刪還款、免除
├── debt-state.ts               協調者：未清餘額與狀態的計算（純函式）
├── debt-ledger-access.ts       協調者：「這個人能不能把交易記進這本帳本」
├── dto/*.dto.ts
└── *.spec.ts

apps/api/test/
├── debts.e2e-spec.ts           SC-D1～D9、D11
└── debts-isolation.e2e-spec.ts SC-D10、SC-D12

apps/web/src/features/transactions/
├── TransactionList.tsx         W3：新型別的正負號、顏色、標籤；借還交易不顯示編輯與刪除
└── （其他因型別擴充而 typecheck 失敗的地方）
```

相依順序：shared → schema → 協調者的共用函式與交易端點調整 → 測試先行 → W1、W2、W3 平行 → e2e。

---

## 2. 實作重點

### 2.1 型別清單分三份

- `TRANSACTION_TYPES`：全部 7 種。回應型別與列表篩選用。
- `MANUAL_TRANSACTION_TYPES`：`EXPENSE`、`INCOME`、`TRANSFER`。`/transactions` 的 create 與 update DTO 改用它，借還型別在 DTO 驗證就被擋成 400（SC-D8）。
- `DEBT_TRANSACTION_TYPES`：4 種借還型別。`PATCH` / `DELETE` 交易前先查型別，屬於這組就回 `409 DEBT_TRANSACTION_READ_ONLY`。

### 2.2 餘額加總窮舉

`accounts.service.ts:91` 的 `group.type === 'INCOME' ? sum : -sum` 改成一個 `switch`，每個 case 明確回傳 `+1` 或 `-1`，`default` 分支用 `const unreachable: never = type` 讓漏處理的型別在 typecheck 失敗（SC-D2）。**先補一個「新型別方向正確」的測試，看到紅燈再改。**

### 2.3 寫一筆借還交易

債務端點不在 `/ledgers/{id}` 之下，`LedgerAccessGuard` 管不到，所以授權要在 service 裡自己做。兩個協調者寫的共用函式：

- `debt-ledger-access.ts`：確認呼叫者是帳本成員（否則 `404`）、角色至少 EDITOR（否則 `403`）、帳本未封存（否則 `409 LEDGER_ARCHIVED`）。規則與 `LedgerAccessGuard` 相同，實作前先讀它，**錯誤碼與訊息要一致**。
- `TransactionsService.createDebtTransaction(tx, ...)`：在呼叫端給的資料庫交易（transaction）裡建立一筆借還交易，沿用既有的 `assertAccountRules`（連動帳本必填帳戶、帳戶屬於本人）。只接受 `DEBT_TRANSACTION_TYPES`。

W1、W2 只呼叫這兩個函式，不自己寫授權。

### 2.4 未清餘額與狀態

`debt-state.ts` 的純函式：輸入本金、未刪除的還款、`forgivenAt`，輸出 `outstanding` 與 `status`。列表與單筆都用它。**不在資料庫存這兩個值**（決策 5）。

### 2.5 交易回應的 `debtId`

`toTransaction` 目前逐筆轉換。列表時多查一次：這一頁的交易 id 裡，哪些是「呼叫者自己的債務」的本金交易或還款交易。查到的補上 `debtId`，其餘為 `null`。帳本其他成員永遠拿到 `null`（spec §3.5 最後一列、SC-D12）。

### 2.6 刪除債務

`DELETE /debts/{id}` 在同一個資料庫交易內：軟刪除債務、軟刪除它所有還款、軟刪除所有關聯的交易。3b-1 沒有連動，不必處理解除連動。

---

## 3. 風險與對策

| 風險                                                              | 對策                                                                                                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 餘額改寫把舊型別的結果改掉                                        | 既有的帳戶 e2e 全部維持綠燈；新增的單元測試逐一驗 7 種型別                                                                                    |
| 債務端點的帳本授權與 `LedgerAccessGuard` 行為不一致               | 協調者自己寫 `debt-ledger-access.ts`；SC-D10 的 e2e 同時打交易端點與債務端點，比對兩邊回的狀態碼                                              |
| Web 還在調整視覺，`TransactionList.tsx` 可能衝突                  | W3 的改動只動正負號、顏色、標籤的對照表與按鈕的顯示條件；開 PR 前先把 `main` 併進來                                                           |
| worktree 沒從正確的 commit 分出、Prisma Client 過期（3a 的教訓）  | Task spec 第 1 步寫明要檢查的 commit 與 `merge --ff-only`；第 2 步寫明 `pnpm install` 之後再跑 `prisma generate` 與 `@ledger/shared` 的 build |
| migration 套到 `ledger_test` 後，其他 worktree 的分支沒有這個檔案 | 與 3a 相同，合併後提醒                                                                                                                        |

---

## 4. 驗證點

1. 協調者的部分完成後：授權與隔離測試存在且為紅燈；既有測試全綠。
2. migration 的手寫 SQL 給開發者看過才套用。
3. 合併 W1～W3 之後：單元測試全綠；兩套 e2e 全綠；對照 SC-D1～SC-D12 逐條打勾。

---

## 5. 分工

見 `phase-3b1-todo.md` 的「負責」欄。協調者做 shared 契約、schema、controller 與 DTO、兩個授權相關的共用函式、交易與帳本端點的調整、先寫的測試。worker 做兩個 service 的內部實作與 Web 的相容改動。

worker 一律用 Claude Code，模型釘 `claude-opus-5`（開發者 2026-09-24 決定，W1～W3 全部）。W1、W2 仍涉及「非擁有者回 404」這類授權判斷，延續 3a 的豁免與補償措施：授權測試由協調者先寫，worker 不准修改。

---

## 6. 實作紀錄

（實作中遇到的計畫外問題與處置記在這裡。）
