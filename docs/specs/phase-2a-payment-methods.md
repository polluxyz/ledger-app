# Spec：階段二 (2a) — 付款方式（後端）

> 狀態：**草案，待開發者審核**（2026-08-10）
> 依據：`CLAUDE.md` §4（階段二）、`docs/specs/phase-2-web-mvp.md`（前端 MVP 依賴本步）。
> 定位：階段二在前端動工前的一個**範圍受控的後端小步**。幾乎是 `CategoriesModule` 的翻版，風險與工作量可預期。

---

## 1. 目標與成功樣貌

交易可記錄「付款方式」（現金 / 信用卡 / 銀行轉帳 / 行動支付…），且付款方式如同分類，是**每帳本可自行管理**的清單。前端 MVP（2b）的交易表單與管理頁才有東西可接。

**設計立場（已定案）**：

- 交易的 `paymentMethodId` **選填**（不是每筆都有，尤其收入）。
- **不與 `type` 綁定**——收入 / 支出共用同一組付款方式（與分類的 type 耦合不同）。
- **每帳本管理** + 預設種子；名稱在帳本內唯一；**被交易引用時不可刪**（含軟刪除交易，比照分類）。

### 範圍內

- 新增 `PaymentMethod` 資料模型與 migration；`Transaction` 加選填 `paymentMethodId`。
- `PaymentMethodsModule`：列表 / 新增 / 改名 / 刪除（比照 `CategoriesModule`）。
- 交易 create / update 支援選填 `paymentMethodId`；交易回應巢狀帶 `paymentMethod`。
- `@ledger/shared` 型別、預設種子常數、錯誤碼。
- 單元與 e2e 測試。

### 範圍外

- 付款方式的統計 / 報表（未來）。
- 與借還帳、AI 的整合（各自階段再接；本步只把欄位與 CRUD 備好）。

---

## 2. 可驗證的成功條件

- **SC-A1**：新帳本自動帶預設付款方式（如 現金 / 信用卡 / 銀行轉帳 / 行動支付）。
- **SC-A2**：`GET /ledgers/:id/payment-methods` 列出該帳本付款方式（VIEWER 以上）。
- **SC-A3**：EDITOR 可新增 / 改名 / 刪除；VIEWER 寫入回 403；同帳本重複名稱回 409。
- **SC-A4**：刪除「有交易引用（含軟刪除交易）」的付款方式回 409（`PAYMENT_METHOD_IN_USE`）。
- **SC-A5**：建立 / 更新交易可帶選填 `paymentMethodId`；省略時交易正常建立、`paymentMethod` 為 `null`。
- **SC-A6**：`paymentMethodId` 指向「他帳本或不存在」的付款方式時回 404（不洩漏存在性，比照分類）。
- **SC-A7**：交易明細 / 列表回應含 `paymentMethod: { id, name } | null`。
- **SC-A8**：`pnpm lint / typecheck / test / build` 全綠；migration 進版控且重跑無 pending。

---

## 3. 資料模型（Prisma）

```prisma
model PaymentMethod {
  id        String   @id @default(uuid())
  ledgerId  String
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  ledger       Ledger        @relation(fields: [ledgerId], references: [id], onDelete: Cascade)
  transactions Transaction[]

  @@unique([ledgerId, name])   // 同帳本內名稱唯一
}

model Transaction {
  // ...既有欄位不動...
  paymentMethodId String?
  paymentMethod   PaymentMethod? @relation(fields: [paymentMethodId], references: [id])
}
```

- 對 `Ledger` 採 `onDelete: Cascade`（刪帳本一併清掉付款方式，比照 Category）。
- `Transaction.paymentMethodId` 可為 NULL；migration 向後相容，既有交易自動為 NULL。
- 「引用中不可刪」由 **service 計數把關**（比照分類的 `CATEGORY_IN_USE`），DB FK 作為後盾。
- **預設種子**在 `createLedgerForUser()` 內一併建立（比照 `DEFAULT_CATEGORIES`）；常數 `DEFAULT_PAYMENT_METHODS` 放 `@ledger/shared`。

---

## 4. API 設計（比照 Categories）

| 方法   | 路徑                                       | 角色   | 說明                        |
| ------ | ------------------------------------------ | ------ | --------------------------- |
| GET    | `/ledgers/{ledgerId}/payment-methods`      | VIEWER | 列表                        |
| POST   | `/ledgers/{ledgerId}/payment-methods`      | EDITOR | 新增 `{ name }`（重複 409） |
| PATCH  | `/ledgers/{ledgerId}/payment-methods/{id}` | EDITOR | 改名（重複 409）            |
| DELETE | `/ledgers/{ledgerId}/payment-methods/{id}` | EDITOR | 刪除（引用中 409）          |

- 交易 DTO：`create` / `update` 皆加選填 `paymentMethodId`（`@IsUUID` + `@IsOptional`）。
- 交易 service：若帶 `paymentMethodId`，驗證其屬同帳本（否則 404）；**無 type 檢查**（付款方式不綁 type）。
- 授權：沿用 `LedgerAccessGuard` + `@RequireLedgerRole`，deny by default。
- 統一錯誤格式；新增錯誤碼 `PAYMENT_METHOD_NAME_TAKEN`、`PAYMENT_METHOD_IN_USE`（跨帳本 / 不存在沿用 `NOT_FOUND`）。

---

## 5. `@ledger/shared` 影響

- 新增 `PaymentMethod` 型別、`CreatePaymentMethodRequest` / `UpdatePaymentMethodRequest`。
- `Transaction` 型別加 `paymentMethod: { id: string; name: string } | null`。
- `CreateTransactionRequest` / `UpdateTransactionRequest` 加選填 `paymentMethodId?`。
- 新增 `DEFAULT_PAYMENT_METHODS` 常數與對應 error codes。

---

## 6. 測試策略

- **單元（PaymentMethodsService）**：重複名稱 409、跨帳本改名 404、引用中不可刪、無引用可刪、依帳本列表。
- **單元（TransactionsService）**：帶跨帳本 `paymentMethodId` → 404；省略 → 正常且 `paymentMethod` 為 null。
- **e2e**：新帳本自帶預設付款方式；VIEWER 寫入 403；重複 409；建立交易帶 / 不帶付款方式；刪除引用中付款方式 409。
- 比照分類既有測試風格，安全 / 授權路徑必覆蓋。

---

## 7. 界線（Always / Ask first / Never）

- **Always**：DTO 驗證、帳本授權（deny by default）、schema 變更走 Prisma migration、新錯誤碼進 shared。
- **Ask first**：本步「改 schema / API」本身已取得同意（2026-08-10）；實作中若需再擴大範圍需再確認。
- **Never**：金額浮點、前端塞業務邏輯、洩漏跨帳本存在性。

---

## 8. 對既有與後續的影響

- **既有 API**：交易新增一個**選填**欄位＝向後相容（未傳的客戶端不受影響）。屬 API 介面變更，前端（2b）會接上、未來 RN 亦同。
- **階段三（借還帳）**：正交——借還的連動交易可選填付款方式，自然契合，不增負擔。
- **階段四（AI）**：僅多一個選填欄位供解析，與「分類解析」同套路，加法、不返工。

---

## 9. Step 拆分概觀（核可後寫入 `tasks/`）

1. **schema + migration + 種子**：`PaymentMethod` 模型、`Transaction.paymentMethodId`、`DEFAULT_PAYMENT_METHODS`、`createLedgerForUser` 補種子。
2. **PaymentMethodsModule**：service + controller + DTO（比照 Categories）+ shared 型別 / 錯誤碼。
3. **交易整合**：交易 DTO / service / 回應加付款方式；驗證同帳本。
4. **測試 + 收尾**：單元 / e2e 補完，確認全綠。

> 完成 2a 後才進 2b（前端 MVP），使前端一開始就含付款方式、不返工。
