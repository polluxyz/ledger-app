# 實作計畫：階段二 (2a) — 付款方式（後端）

> 狀態：**草案，待開發者審核**
> 依據：`docs/specs/phase-2a-payment-methods.md`（已核可）。
> 核心策略：**比照既有 `CategoriesModule` 打造**，把已知良好的形狀複製過來，降低風險。

---

## 1. 主要元件與相依關係

由下而上，型別先行（後面全部依賴它）：

```
@ledger/shared（型別/常數/錯誤碼）
        │
        ▼
Prisma schema + migration（PaymentMethod、Transaction.paymentMethodId）
        │
        ├──▶ LedgersService.createLedgerForUser（補預設種子）
        │
        ├──▶ PaymentMethodsModule（service / controller / dto）
        │
        └──▶ TransactionsModule（DTO / service / 回應整合）
                    │
                    ▼
               單元 + e2e 測試（含 resetDb 調整）
```

- `PaymentMethodsModule` 需 `imports: [LedgersModule]` 以重用 `LedgerAccessGuard`（比照 `CategoriesModule`）。
- `TransactionsModule` 的變更是「加欄位」，不改既有授權/流程。

---

## 2. 實作順序（依相依，逐步可驗證）

1. **shared 契約**：`PaymentMethod`、`CreatePaymentMethodRequest`、`UpdatePaymentMethodRequest`；`Transaction` 加 `paymentMethod: { id, name } | null`；`CreateTransactionRequest` / `UpdateTransactionRequest` 加 `paymentMethodId?`；`DEFAULT_PAYMENT_METHODS` 常數；錯誤碼 `PAYMENT_METHOD_NAME_TAKEN`、`PAYMENT_METHOD_IN_USE`。
   - 驗證：`pnpm --filter @ledger/shared build` 綠。
2. **schema + migration**：新增 `PaymentMethod` model、`Transaction.paymentMethodId`（String?）與關聯；`prisma migrate dev` 產 migration；重新產生 client。
   - 驗證：migration 進版控；`prisma migrate dev` 無 pending；`prisma studio` 見新表。
3. **預設種子**：在 `LedgersService.createLedgerForUser()` 內用 `DEFAULT_PAYMENT_METHODS` 建立（與現有 `DEFAULT_CATEGORIES` 同一 `$transaction`）。
   - 驗證：新註冊使用者的帳本自帶預設付款方式。
4. **PaymentMethodsModule**（比照 Categories）：`payment-methods.service.ts`（list/create/rename/remove、`getOwned`、P2002→NAME_TAKEN、引用計數→IN_USE）、`payment-methods.controller.ts`（`/ledgers/:ledgerId/payment-methods`、`@RequireLedgerRole`）、DTO（create/update）、module 掛進 `AppModule`。
   - 驗證：手動打四個端點；VIEWER 寫入 403、重複 409。
5. **交易整合**：交易 DTO 加選填 `paymentMethodId`（`@IsOptional @IsUUID`）；`TransactionsService` 建立/更新時驗證 `paymentMethodId` 屬同帳本（否則 404，**無 type 檢查**）；`TRANSACTION_INCLUDE` 與 `toTransaction` 加入 `paymentMethod`。
   - 驗證：帶跨帳本 id → 404；省略 → `paymentMethod` 為 null。
6. **測試 + 收尾**：補單元（payment-methods.service.spec、transactions.service.spec 增補）與 e2e（payment-methods.e2e、交易帶/不帶付款方式）；**更新 `test/e2e-utils.ts` 的 `resetDb` TRUNCATE 清單，納入 `PaymentMethod`**；README 如有需要補一行。
   - 驗證：`pnpm lint / typecheck / test` 與 `pnpm --filter @ledger/api test:e2e` 全綠。

---

## 3. 風險與對策

| 風險                                                | 對策                                                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 對既有 `Transaction` 表加欄位                       | 欄位為 **NULL-able**，migration 向後相容；既有資料自動為 NULL。先在 `ledger_dev` 跑 `migrate dev`，e2e 前以 `migrate deploy` 套到 `ledger_test`。 |
| **e2e `resetDb` 漏清 `PaymentMethod`** 導致測試互汙 | 明確在 TRUNCATE 清單加入 `"PaymentMethod"`（CASCADE）；此為易漏點，列為獨立驗收項。                                                               |
| `createLedgerForUser` 變更影響註冊/建帳本既有測試   | `auth.service.spec` 對它是 mock，不受影響；e2e 另外斷言預設付款方式數量，與分類的 12 筆斷言並存不衝突。                                           |
| 「引用中不可刪」與軟刪除交易                        | 計數比照分類，`count` 不過濾 `deletedAt`（歷史須可追溯）。                                                                                        |
| 跨帳本存在性洩漏                                    | 一律回 404（比照分類 `getOwned`），不回 400/403。                                                                                                 |

---

## 4. 各階段驗證點總表

- 每步後：對應 package `build` / `typecheck` 綠。
- 全部完成：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm --filter @ledger/api test:e2e` 全綠；對照 spec §2 的 SC-A1～SC-A8 逐條打勾。

---

## 5. 對外介面影響提醒

- **API 變更**：交易 create/update 多一個選填 `paymentMethodId`，回應多 `paymentMethod`——向後相容。前端（2b）會接上；未來 RN 同。
- **無新增執行期相依套件**（沿用既有 Nest/Prisma/class-validator）。
- **無新增環境變數**。

---

## 6. 建議的 PR 切法

單一 PR `feature/payment-methods`（自 `main` 開，需先 merge 本規劃 PR）：一次涵蓋 shared→schema→module→交易整合→測試，因為彼此相依、拆開反而破碎。commit 依上述 6 步分次提交（經驗收後）。
