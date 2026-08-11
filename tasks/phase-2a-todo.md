# 任務清單：階段二 (2a) — 付款方式（後端）

> 狀態：**待開發者審核**
> 依據：`docs/specs/phase-2a-payment-methods.md`、`tasks/phase-2a-plan.md`（皆已核可）。
> 用法：依序執行；每個任務有驗收條件。勾選＝「開發者已驗收」。
> 標 👤 = 開發者親手操作（Claude 陪跑）；其餘由 Claude 實作、開發者驗收。
> 通用驗收（每任務皆適用，不再重複）：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全綠。
> 分支：於 `feature/payment-methods`（自 `main` 開，需先 merge 本規劃 PR）。

---

## Step 1：shared 契約

- [ ] **1.1 `@ledger/shared` 型別 / 常數 / 錯誤碼**
  - 內容：新增 `PaymentMethod`、`CreatePaymentMethodRequest`、`UpdatePaymentMethodRequest`；`Transaction` 加 `paymentMethod: { id: string; name: string } | null`；`CreateTransactionRequest` / `UpdateTransactionRequest` 加選填 `paymentMethodId?`；新增 `DEFAULT_PAYMENT_METHODS`（現金 / 信用卡 / 銀行轉帳 / 行動支付）；錯誤碼 `PAYMENT_METHOD_NAME_TAKEN`、`PAYMENT_METHOD_IN_USE`；於 `index.ts` 匯出。
  - 驗收：`pnpm --filter @ledger/shared build` 綠；api 可 import 到新型別。

## Step 2：資料庫 schema 與 migration

- [ ] **2.1 `PaymentMethod` 模型與 `Transaction` 欄位**
  - 內容：新增 `PaymentMethod` model（`@@unique([ledgerId, name])`、對 `Ledger` `onDelete: Cascade`）；`Transaction` 加 `paymentMethodId String?` 與關聯；`prisma migrate dev` 產 migration；重新產生 Prisma Client。
  - 驗收：migration 檔進版控；重跑 `prisma migrate dev` 無 pending；`prisma studio` 可見新表與新欄位。

## Step 3：預設種子

- [ ] **3.1 `createLedgerForUser` 補付款方式種子**
  - 內容：在既有 `$transaction` 內，用 `DEFAULT_PAYMENT_METHODS` 為新帳本建立預設付款方式（與 `DEFAULT_CATEGORIES` 同批）。
  - 驗收：新註冊使用者 / 新建帳本自帶預設付款方式（手動或於 Step 6 e2e 驗證）。

## Step 4：PaymentMethodsModule（比照 Categories）

- [ ] **4.1 `PaymentMethodsService`**
  - 內容：`list` / `create` / `rename` / `remove`；`getOwned`（跨帳本回 404）；P2002 → `PAYMENT_METHOD_NAME_TAKEN`（409）；引用計數（**不過濾 `deletedAt`**）> 0 → `PAYMENT_METHOD_IN_USE`（409）。
  - 驗收：單元測試覆蓋——重複名稱 409、跨帳本改名 404、引用中不可刪、無引用可刪、依帳本列表。
- [ ] **4.2 Controller / DTO / 模組接線**
  - 內容：`payment-methods.controller.ts`（`/ledgers/:ledgerId/payment-methods`；`@UseGuards(LedgerAccessGuard)` + `@RequireLedgerRole`：讀 VIEWER、寫 EDITOR；`@ApiTags`）；create / update DTO（`@IsString` 等，比照分類）；`PaymentMethodsModule` `imports: [LedgersModule]` 並註冊進 `AppModule`。
  - 驗收：手動打四個端點成功；VIEWER 寫入 403；重複名稱 409（e2e 於 Step 6 補齊）。

## Step 5：交易整合

- [ ] **5.1 交易 DTO / service / 回應加入付款方式**
  - 內容：`CreateTransactionDto` / `UpdateTransactionDto` 加選填 `paymentMethodId`（`@IsOptional` + `@IsUUID`）；`TransactionsService` 建立 / 更新時，若帶 `paymentMethodId` 驗證其屬同帳本（否則 404，**無 type 檢查**）；`TRANSACTION_INCLUDE` 與 `toTransaction` 納入 `paymentMethod`（`select: { id, name }`）。
  - 驗收：單元測試——帶跨帳本 `paymentMethodId` → 404；省略 → 建立成功且 `paymentMethod` 為 `null`；明細 / 列表回應含 `paymentMethod`。

## Step 6：測試補完與最終驗收

- [ ] **6.1 e2e：`resetDb` 調整 + 付款方式與交易情境**
  - 內容：**`test/e2e-utils.ts` 的 `resetDb` TRUNCATE 清單加入 `"PaymentMethod"`（CASCADE）**；新增 `payment-methods.e2e-spec.ts`（新帳本自帶預設付款方式、VIEWER 寫 403、重複 409、引用中刪 409）；交易 e2e 補「帶 / 不帶付款方式」建立。
  - 驗收：`pnpm --filter @ledger/api test:e2e` 全綠。
- [ ] **6.2 最終驗收（對照 spec §2）**
  - 內容：跑全套 lint / typecheck / test / build / e2e；逐條核對 SC-A1～SC-A8。
  - 驗收：SC-A1～SC-A8 全部打勾 ＝ **2a 完成**。
- [ ] **6.3 👤 PR `feature/payment-methods`：自我 review 後合併**
  - 驗收：CI 全綠；squash merge 進 `main`。

---

## 對外提醒

- **API 介面變更**：交易 create/update 多選填 `paymentMethodId`、回應多 `paymentMethod`（向後相容）——前端 2b 會接上，未來 RN 同。
- 無新增執行期相依套件、無新增環境變數（`.env.example` 不需更動）。
