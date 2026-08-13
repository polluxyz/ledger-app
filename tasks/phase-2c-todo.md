# 任務清單：階段二 (2c) — 帳戶與餘額（後端）

> 狀態：**待開發者審核**
> 依據：`docs/specs/phase-2c-accounts.md`、`tasks/phase-2c-plan.md`（皆已核可）。
> 用法：依序執行；每個任務有驗收條件。勾選＝「開發者已驗收」。
> 標 👤 = 開發者親手操作（Claude 陪跑）；⚠️ = 破壞性、動手前須再次確認。
> 通用驗收：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全綠——
> **但 Step 2～5 期間 `apps/web` 會是紅的（刻意），此通用驗收自 Step 6 起才恢復要求。**
> 分支：於 `feature/accounts`（自 `main` 開，需先 merge `docs/accounts-spec` PR）。

### 微決策（已於 Plan §3 核可，實作時一律照此）

| #   | 結論                                                                     |
| --- | ------------------------------------------------------------------------ |
| M1  | `tracksBalance` 在 `UpdateLedgerDto` **明確宣告**，由 service 丟專屬 400 |
| M2  | 「他人交易」計數 **含軟刪除**                                            |
| M3  | 舊交易的 `accountId` → 其 `creatorId` 的「現金」帳戶                     |
| M4  | 資料轉換用 `INSERT ... SELECT` 涵蓋全部使用者，migration 末尾加斷言      |
| M5  | 帳戶改名天然連動歷史交易（存 id），不做快照                              |
| M6  | `initialBalance` **可為負**，DTO 用 `@IsInt()` 不加 `@Min(0)`            |
| M7  | 帳戶列表**不**回傳總淨值（屬統計，走後續彙總端點）                       |

---

## Step 1：shared 契約

- [ ] **1.1 新增帳戶型別與常數**
  - 內容：`types/account.ts`——`Account`（`id` / `name` / `initialBalance` / `balance` / `createdAt`）、`CreateAccountRequest`（`name`、`initialBalance?`）、`UpdateAccountRequest`（皆選填）；`constants/default-accounts.ts`——`DEFAULT_ACCOUNTS = ['現金', '銀行', '信用卡'] as const`。
  - 驗收：型別可被 import；`balance` 有註解說明是「即時計算、不儲存」。
- [ ] **1.2 交易與帳本型別調整（破壞性）**
  - 內容：`TRANSACTION_TYPES` 加 `'TRANSFER'`；`Transaction` 的 `category` 改 `{ id, name } | null`、**移除 `paymentMethod`**、新增 `account` / `toAccount`（`{ id, name } | null`）；`CreateTransactionRequest` / `UpdateTransactionRequest` 的 `categoryId` 改選填、加 `accountId?` / `toAccountId?`、移除 `paymentMethodId`；`Ledger` 加 `tracksBalance: boolean` / `archivedAt: string | null`；`CreateLedgerRequest` 加 `tracksBalance?`；新增 `ListLedgersQuery`（`includeArchived?`）。
  - 驗收：型別註解寫清楚「條件必填」的兩條規則（連動帳本 vs 非連動帳本）。
- [ ] **1.3 錯誤碼增減 ＋ 移除付款方式契約**
  - 內容：`error-codes.ts` 新增 `ACCOUNT_NAME_TAKEN`、`ACCOUNT_IN_USE`、`ACCOUNT_REQUIRED`、`ACCOUNT_NOT_ALLOWED`、`TRANSFER_SAME_ACCOUNT`、`LEDGER_ARCHIVED`、`LEDGER_HAS_OTHERS_TRANSACTIONS`、`TRACKS_BALANCE_IMMUTABLE`，**移除** `PAYMENT_METHOD_NAME_TAKEN` / `PAYMENT_METHOD_IN_USE`；刪除 `types/payment-method.ts`、`constants/default-payment-methods.ts`；更新 `index.ts` 匯出。
  - 驗收：`pnpm --filter @ledger/shared build` 綠（此時 api / web 會紅，屬預期）。

## Step 2：資料庫 schema 與破壞性 migration ⚠️

- [ ] **2.0 👤 備份 `ledger_dev`**
  - 內容：開發者執行 `pg_dump` 存一份到本機（Claude 提供指令，不代跑）。
  - 驗收：備份檔存在且大小合理。**未完成不得進 2.2。**
- [ ] **2.1 改 `schema.prisma`**
  - 內容：新增 `Account` model（`@@unique([userId, name])`、對 `User` `onDelete: Cascade`）；`TransactionType` 加 `TRANSFER`；`Ledger` 加 `tracksBalance Boolean @default(true)` / `archivedAt DateTime?`；`Transaction` 加 `accountId String?` / `toAccountId String?` 與兩條具名關聯、`categoryId` 改 `String?`、加兩個 `@@index`；**移除** `PaymentMethod` model 與 `Transaction.paymentMethodId`。
  - 驗收：`prisma validate` 通過；關聯名稱為 `TransactionAccount` / `TransactionToAccount`。
- [ ] **2.2 ⚠️ 手寫資料轉換 migration 並套用**
  - 內容：`prisma migrate dev --create-only` 產出 SQL 後**手動編輯**，依 Plan §2 的六段順序補上資料轉換：為每位使用者 `INSERT` 三個預設帳戶；`UPDATE "Transaction" SET "accountId" = 其 creatorId 的現金帳戶`；末尾加斷言（若仍有 `accountId IS NULL` 則 `RAISE EXCEPTION`）；最後 `DROP` 付款方式相關結構。**SQL 先給開發者過目，同意後才套用。**
  - 驗收：migration 檔進版控；`prisma migrate dev` 無 pending；Prisma Studio 中——`Account` 表每位使用者三筆、舊交易 `accountId` 全部有值且對應正確使用者、`PaymentMethod` 表已消失；`prisma generate` 後 client 型別更新。

## Step 3：AccountsModule（CRUD ＋ 餘額）

- [ ] **3.1 `AccountsService`**
  - 內容：`list(userId)`（2 次 `groupBy` 算完所有餘額，公式見 spec §4）；`create` / `update`（P2002 → `ACCOUNT_NAME_TAKEN` 409）；`remove`（引用計數涵蓋 `accountId` **或** `toAccountId`、**含軟刪除交易** → `ACCOUNT_IN_USE` 409）；`getOwned(userId, accountId)`（非本人一律 404，供交易模組重用）。
  - 驗收：單元測試——重複名稱 409、跨使用者 404、有引用不可刪、無引用可刪；**餘額五個加減項各一條獨立案例**（初始 / 收入 / 支出 / 轉出 / 轉入）＋ **兩條排除案例**（軟刪除交易、非連動帳本），不合併成單一大測試。
- [ ] **3.2 Controller / DTO / 模組接線**
  - 內容：`accounts.controller.ts`（`/accounts` 四個端點、`@ApiTags('accounts')`、`@CurrentUser()`，**不掛 `LedgerAccessGuard`**）；`create-account.dto.ts`（`name` `@IsString` `@IsNotEmpty`、`initialBalance?` `@IsInt`，依 M6 **不加 `@Min(0)`**）；`update-account.dto.ts`；`AccountsModule` 註冊進 `AppModule`。
  - 驗收：手動打四個端點成功；帶別人的 accountId → 404；`initialBalance: -5000` 可建立。
- [ ] **3.3 預設帳戶種子搬家**
  - 內容：`AuthService.register` 的 `$transaction` 內以 `DEFAULT_ACCOUNTS` 建立帳戶；`LedgersService.createLedgerForUser` **移除** `paymentMethod.createMany`；同步更新 `auth.service.spec.ts` 的 mock 期望。
  - 驗收：新註冊使用者 `GET /accounts` 回三筆、餘額皆為 0（SC-C1）。

## Step 4：交易整合

- [ ] **4.1 帳戶規則驗證**
  - 內容：`TransactionsService` 以 `assertAccountRules()` 取代 `assertPaymentMethodOwned()`——讀 `ledger.tracksBalance`；連動缺 `accountId` → 400 `ACCOUNT_REQUIRED`；非連動卻給 → 400 `ACCOUNT_NOT_ALLOWED`；帳戶非本人 → 404；`TRANSFER` 需 `toAccountId`（本人、≠ `accountId` 否則 400 `TRANSFER_SAME_ACCOUNT`）且**不得帶 `categoryId`**；`EXPENSE`/`INCOME` 則 `categoryId` 必填（`assertCategoryConsistent` 改為僅在有值時呼叫）。
  - 驗收：單元測試覆蓋以上七種情境各一條（SC-C5～SC-C7）。
- [ ] **4.2 帳戶隱私過濾**
  - 內容：`TRANSACTION_INCLUDE` 的 `account` / `toAccount` 取 `{ id, name, userId }`；**`toTransaction` 加必填參數 `viewerUserId`**（不給預設值），帳戶 `userId !== viewerUserId` 時輸出 `null`；`create` / `list` / `getById` / `update` 一路承接，controller 補傳 `@CurrentUser()`。
  - 驗收：單元測試——他人建立的交易，`account` 為 `null` 但 `amount` / `category` / `creator` 仍在（SC-C9）。
- [ ] **4.3 移除 PaymentMethodsModule**
  - 內容：刪除 `apps/api/src/payment-methods/` 整個資料夾（含 `payment-methods.service.spec.ts`）與 `AppModule` 中的註冊；交易 DTO 移除 `paymentMethodId`、新增 `accountId?` / `toAccountId?`（`@IsOptional` + `@IsUUID`）、`categoryId` 改 `@IsOptional`。
  - 驗收：全 repo grep 不到 `paymentMethod`（`apps/web` 除外，Step 6 處理）。

## Step 5：帳本整合

- [ ] **5.1 `tracksBalance` 與封存欄位**
  - 內容：`CreateLedgerDto` 加 `tracksBalance?: boolean`（`@IsOptional` `@IsBoolean`，預設 `true`）；`UpdateLedgerDto` 依 M1 **明確宣告** `tracksBalance?`，service 一旦收到即丟 400 `TRACKS_BALANCE_IMMUTABLE`；`toLedger` / `toSummary` 回傳新欄位。
  - 驗收：建立非連動帳本成功；`PATCH` 帶 `tracksBalance` → 400 且錯誤碼正確（SC-C12）。
- [ ] **5.2 封存與列表過濾**
  - 內容：`POST /ledgers/:id/archive`（`@RequireLedgerRole('OWNER')`，設 `archivedAt`）；`GET /ledgers` 預設 `archivedAt: null`，`?includeArchived=true` 才含（`ListLedgersQueryDto`）。
  - 驗收：封存後帳本從預設列表消失、帶參數才出現（SC-C10 前半）。
- [ ] **5.3 `LedgerAccessGuard` 擋封存帳本的寫入**
  - 內容：guard 查詢一併取出 `ledger.archivedAt`；`request.method !== 'GET'` 且已封存 → 409 `LEDGER_ARCHIVED`。
  - 驗收：`ledger-access.guard.spec.ts` 補兩條——封存帳本 `POST` 交易 409、`GET` 交易仍 200（SC-C10 後半）。
- [ ] **5.4 刪除帳本的新規則**
  - 內容：`LedgersService.remove` 保留既有 `confirm` 防呆，**再加**：`count` 該帳本中 `creatorId !== actingUserId` 的交易（依 M2 **含軟刪除**）> 0 → 409 `LEDGER_HAS_OTHERS_TRANSACTIONS`；controller 傳入操作者 id。
  - 驗收：單元測試——有他人交易 409、只有自己的交易可刪（SC-C11）。

## Step 6：apps/web 最小適配（**不可省略**）

- [ ] **6.1 帳戶取代付款方式**
  - 內容：刪除 `features/payment-methods/`；新增 `features/accounts/use-accounts.ts`（`GET /accounts`）；`TransactionForm` 的付款方式下拉改為**帳戶下拉（必選、預設第一個）**；`TransactionList` 顯示帳戶名稱（`null` → `—`）；`category` 已可為 `null`，顯示端一併處理。
  - 驗收：`pnpm --filter @ledger/web test` 綠（`transactions.test.tsx` 的 mock 與斷言同步更新）。
- [ ] **6.2 👤 瀏覽器實測**
  - 內容：開發者實際登入、記一筆、確認成功寫入。
  - 驗收：不再出現 400；列表顯示帳戶名稱。
  - 備註：**本步不做**帳戶管理頁、轉帳 UI、非連動帳本 UI（併入 Slice 1 之後）。

## Step 7：測試補完與最終驗收

- [ ] **7.1 e2e：`resetDb` 調整 ＋ 帳戶情境**
  - 內容：**`test/e2e-utils.ts` 的 TRUNCATE 清單移除 `"PaymentMethod"`、加入 `"Account"`**（2a 的易漏點）；刪除 `payment-methods.e2e-spec.ts`；新增 `accounts.e2e-spec.ts`（註冊自帶三個帳戶、CRUD、重複名稱 409、有交易不可刪、他人帳戶 404）；`transactions.e2e-spec.ts` 補「連動 / 非連動帳本各記一筆並驗餘額」「轉帳後兩邊餘額」「共享帳本中他人交易 `account` 為 `null`」；`ledgers.e2e-spec.ts` 補封存流程與刪除兩種結果。
  - 驗收：`pnpm --filter @ledger/api test:e2e` 全綠。
- [ ] **7.2 最終驗收（對照 spec §3）**
  - 內容：跑全套 `pnpm lint` / `typecheck` / `test` / `build` ＋ e2e；逐條核對 SC-C1～SC-C13。
  - 驗收：SC-C1～SC-C13 全部打勾 ＝ **2c 完成**。
- [ ] **7.3 👤 PR `feature/accounts`：自我 review 後合併**
  - 驗收：CI 全綠；squash merge 進 `main`。

---

## 對外提醒

- **API 破壞性變更**（前端／未來 RN 皆受影響）：
  - `/ledgers/:id/payment-methods` 整組移除 → 改為頂層 `/accounts`
  - 交易 request：移除 `paymentMethodId`；`accountId` 與 `categoryId` 皆改為**條件必填**
  - 交易 response：移除 `paymentMethod`；新增 `account` / `toAccount`；`category` 可為 `null`
  - `TransactionType` 多一個 `TRANSFER`——前端若用「非 EXPENSE 即 INCOME」的二分法**會錯**
  - 帳本 response 多 `tracksBalance` / `archivedAt`
- **文件同步**：2c 完成後把 `docs/specs/phase-2a-payment-methods.md` 標記為「已被 2c 取代」。
- 無新增執行期相依套件、無新增環境變數（`.env.example` 不需更動）。
