# 實作計畫：階段二 (2c) — 帳戶與餘額（後端）

> 狀態：**草案，待開發者審核**
> 依據：`docs/specs/phase-2c-accounts.md`（已核可）。
> 核心策略：**先立契約、再動 schema、最後才改行為**。與 2a 最大的不同是——本步是
> **破壞性**變更（移除 `PaymentMethod`、`accountId` 條件必填），會**打壞現有的
> Web Slice 0 表單**，因此收尾必須包含前端的最小適配，否則 monorepo 的
> `typecheck` / `test` 不會綠。

---

## 1. 主要元件與相依關係

```
@ledger/shared（Account 型別 / TRANSFER / 錯誤碼 / DEFAULT_ACCOUNTS）
        │
        ▼
Prisma schema + 破壞性 migration
（Account 表、Ledger.tracksBalance/archivedAt、
  Transaction.accountId/toAccountId、categoryId 改 nullable、
  資料轉換、DROP PaymentMethod）
        │
        ├──▶ AuthService.register（改為在此種預設「帳戶」）
        │    LedgersService.createLedgerForUser（移除付款方式種子）
        │
        ├──▶ AccountsModule（CRUD ＋ 餘額計算）── 純使用者範圍，不用 LedgerAccessGuard
        │
        ├──▶ TransactionsModule（條件必填、TRANSFER、帳戶隱私過濾）
        │
        ├──▶ LedgersModule（tracksBalance、封存、刪除規則）
        │    └─ LedgerAccessGuard 擴充：封存帳本擋寫入
        │
        └──▶ 刪除 PaymentMethodsModule ＋ 其測試
                    │
                    ▼
        apps/web 最小適配（帳戶下拉取代付款方式下拉）
                    │
                    ▼
        單元 ＋ e2e 測試（含 resetDb 清單調整）
```

### 與 2a 的關鍵結構差異

| 面向     | 2a 付款方式                    | 2c 帳戶                                     |
| -------- | ------------------------------ | ------------------------------------------- |
| 歸屬     | 帳本                           | **使用者**                                  |
| 端點     | `/ledgers/:id/payment-methods` | **`/accounts`**（頂層）                     |
| 授權     | `LedgerAccessGuard` ＋ 角色    | **只有 JWT**，一律 `where: { userId }` 過濾 |
| 種子時機 | 建立帳本時                     | **註冊使用者時**                            |
| 必填性   | 永遠選填                       | **條件必填**（看帳本 `tracksBalance`）      |

→ 所以 **不能照抄 `CategoriesModule` 的形狀**（那是帳本範圍的模組）。`AccountsService`
是本專案第一個「使用者範圍」的資源模組，形狀較接近 `UsersService`。

---

## 2. 實作順序（依相依，逐步可驗證）

### Step 1 — shared 契約

- `types/account.ts`：`Account`（含 `balance`）、`CreateAccountRequest`、`UpdateAccountRequest`。
- `types/transaction.ts`：`TRANSACTION_TYPES` 加 `'TRANSFER'`；`Transaction` 的
  `category` 改 nullable、移除 `paymentMethod`、新增 `account` / `toAccount`
  （`{ id, name } | null`）；request 型別加 `accountId?` / `toAccountId?`，
  `categoryId` 改選填。
- `types/ledger.ts`：`Ledger` 加 `tracksBalance`、`archivedAt`；`CreateLedgerRequest`
  加 `tracksBalance?`；`ListLedgersQuery`（`includeArchived?`）。
- `constants/default-accounts.ts`：`DEFAULT_ACCOUNTS = ['現金', '銀行', '信用卡']`。
- `constants/error-codes.ts`：加 8 個新碼、**移除** 2 個 `PAYMENT_METHOD_*`。
- 刪除 `types/payment-method.ts`、`constants/default-payment-methods.ts`，並更新 `index.ts`。
- **驗證**：`pnpm --filter @ledger/shared build` 綠（api / web 此時會紅，屬預期）。

### Step 2 — schema ＋ 破壞性 migration ⚠️

> **執行前必須再次向開發者確認**（spec §9）。這一步會刪掉 `ledger_dev` 的
> `PaymentMethod` 資料。

- 改 `schema.prisma`（照 spec §4）。
- 用 **`prisma migrate dev --create-only`** 產出 SQL 後**手動編輯**，補上資料轉換
  （Prisma 不會自己生），順序固定為：
  1. `ALTER TYPE "TransactionType" ADD VALUE 'TRANSFER'`
  2. `CREATE TABLE "Account"` ＋ 索引 ＋ FK
  3. `ALTER TABLE "Ledger" ADD tracksBalance/archivedAt`
  4. `ALTER TABLE "Transaction" ADD accountId/toAccountId`；`categoryId` DROP NOT NULL
  5. **資料轉換**：`INSERT INTO "Account" ... SELECT` 為每位使用者建三個帳戶；
     `UPDATE "Transaction" SET "accountId" = (該筆 creatorId 的「現金」帳戶)`
  6. `ALTER TABLE "Transaction" DROP COLUMN "paymentMethodId"`；`DROP TABLE "PaymentMethod"`
- 再 `prisma migrate dev` 套用 ＋ 重新產生 client。
- **驗證**：migration 進版控；`migrate dev` 顯示無 pending；Prisma Studio 中舊交易的
  `accountId` 皆已填入且指向正確使用者的現金帳戶；`PaymentMethod` 表已消失。

### Step 3 — AccountsModule（CRUD ＋ 餘額）

- `accounts.service.ts`
  - `list(userId)`：先取自己的帳戶，再用 **2 次 `groupBy`** 一次算完所有餘額
    （不論帳戶數，查詢次數固定，避免 N+1）：
    - A：`groupBy [accountId, type]`，`where { accountId: { in }, deletedAt: null, ledger: { tracksBalance: true } }`
    - B：`groupBy [toAccountId]`，`where { type: 'TRANSFER', toAccountId: { in }, ... }`
    - 合成：`initialBalance + INCOME − EXPENSE − TRANSFER(out) + TRANSFER(in)`
  - `create` / `update`：P2002 → `ACCOUNT_NAME_TAKEN`（409）
  - `remove`：先 `count` 引用（`accountId` **或** `toAccountId`，**含軟刪除交易**）
    → `ACCOUNT_IN_USE`（409）
  - `getOwned(userId, accountId)`：跨使用者一律 404（供交易模組重用）
- `accounts.controller.ts`：`@ApiTags('accounts')`、`/accounts` 四個端點、`@CurrentUser()`。
- DTO：`create-account.dto.ts`（`name` 必填、`initialBalance?` 為 `@IsInt()`，
  **允許負數**）、`update-account.dto.ts`。
- 種子搬家：`AuthService.register` 的 `$transaction` 內建立 `DEFAULT_ACCOUNTS`；
  `LedgersService.createLedgerForUser` 移除 `paymentMethod.createMany`。
- **驗證**：手打四個端點；別人的帳戶 404；餘額在只有初始餘額時等於 `initialBalance`。

### Step 4 — 交易整合

- `TransactionsService` 新增 `assertAccountRules()`，取代 `assertPaymentMethodOwned()`：
  - 讀出 `ledger.tracksBalance` → 連動缺 `accountId` 則 `ACCOUNT_REQUIRED`(400)；
    非連動卻給了則 `ACCOUNT_NOT_ALLOWED`(400)
  - 帳戶須屬呼叫者（否則 404）
  - `TRANSFER`：`toAccountId` 必填、屬呼叫者、且 ≠ `accountId`（`TRANSFER_SAME_ACCOUNT`）；
    `categoryId` 必須不存在
  - `EXPENSE`/`INCOME`：`categoryId` 必填
- **`toTransaction` 加 `viewerUserId` 參數**：帳戶不屬於檢視者時輸出 `null`
  （spec 決策 7）。`TRANSACTION_INCLUDE` 的 account/toAccount 需 `select { id, name, userId }`。
- 連鎖影響：`create` / `list` / `getById` / `update` 都要拿得到目前使用者 →
  controller 補傳 `@CurrentUser()`。
- 刪除 `payment-methods/` 整個資料夾與其在 `AppModule` 的註冊。
- **驗證**：六種錯誤情境各打一次；共享帳本中他人交易的 `account` 為 `null`。

### Step 5 — 帳本整合

- `CreateLedgerDto` 加 `tracksBalance?: boolean`（預設 `true`）。
- `UpdateLedgerDto` **明確宣告** `tracksBalance?`，並在 service 直接丟
  400 `TRACKS_BALANCE_IMMUTABLE`（理由見 §3 的微決策）。
- `GET /ledgers` 加 `?includeArchived=true`；預設 `archivedAt: null`。
- `POST /ledgers/:id/archive`（`@RequireLedgerRole('OWNER')`）。
- `DELETE /ledgers/:id`：既有的 `confirm` 防呆保留，**再加**「有其他成員的交易
  → 409 `LEDGER_HAS_OTHERS_TRANSACTIONS`」。
- **`LedgerAccessGuard` 擴充**：一併讀出 `archivedAt`，非 GET 方法且已封存 →
  409 `LEDGER_ARCHIVED`（集中把關，勝過在每個 service 各寫一次）。
- **驗證**：封存後記帳回 409；有他人交易時刪除回 409；改 `tracksBalance` 回 400。

### Step 6 — apps/web 最小適配（**不可省略**）

`accountId` 變成條件必填，現有表單不改**會直接壞掉**（送出即 400）。

- 刪除 `features/payment-methods/`。
- 新增 `features/accounts/use-accounts.ts`（`GET /accounts`）。
- `TransactionForm`：付款方式下拉 → **帳戶下拉（必選，預設第一個）**。
- `TransactionList`：顯示帳戶名稱（`null` 時顯示 `—`）。
- 測試 `transactions.test.tsx` 的 mock 與斷言同步更新。
- **本步不做**：帳戶管理頁、轉帳 UI、非連動帳本 UI（併入 Slice 1 之後）。
- **驗證**：`pnpm --filter @ledger/web test` 綠；瀏覽器實際新增一筆成功。

### Step 7 — 測試補完與最終驗收

- 新增 `accounts.service.spec.ts`、`accounts.e2e-spec.ts`。
- 增補 `transactions.service.spec.ts`、`ledgers.service.spec.ts`、`ledger-access.guard.spec.ts`。
- 刪除 `payment-methods.service.spec.ts`、`payment-methods.e2e-spec.ts`。
- **`test/e2e-utils.ts` 的 TRUNCATE 清單：移除 `"PaymentMethod"`、加入 `"Account"`**
  （2a 時的易漏點，這次同樣列為獨立驗收項）。
- 對照 SC-C1～SC-C13 逐條打勾。

---

## 3. 待確認的微決策（實作前一次講清楚）

| #   | 議題                             | 建議做法                                                                                      |
| --- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| M1  | `tracksBalance` 改動的擋法       | **明確在 DTO 宣告再擋**。靠 `forbidNonWhitelisted` 也會 400，但錯誤訊息含糊、OpenAPI 看不出來 |
| M2  | 刪帳本時「他人交易」是否含軟刪除 | **含**。軟刪除的仍是別人的紀錄，保守處理與「帳戶引用」規則一致                                |
| M3  | 舊交易的 `accountId` 指向誰      | spec 已定：`creatorId` 的現金帳戶。共享帳本中會分散到各成員名下，**這是正確的**               |
| M4  | 舊交易若無 creator 對應的帳戶    | 資料轉換以 `INSERT ... SELECT` 涵蓋全部使用者，不會有孤兒；migration 末尾加一句斷言檢查       |
| M5  | 帳戶改名是否連動歷史交易         | 天然連動（存的是 id）。不做快照                                                               |
| M6  | `initialBalance` 可否為負        | **可**（信用卡既有欠款），DTO 用 `@IsInt()` 不加 `@Min(0)`                                    |
| M7  | 帳戶列表要不要順便回傳「總淨值」 | **不要**。屬統計，走後續彙總端點                                                              |

---

## 4. 風險與對策

| 風險                                                     | 對策                                                                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **破壞性 migration 寫壞 → 開發資料回不來**               | 執行前先 `pg_dump ledger_dev` 存一份到 scratchpad；`--create-only` 先讓開發者看過 SQL 再套用；**動手前再確認一次**                        |
| `ALTER TYPE ... ADD VALUE` 在交易中的限制                | PG 12+ 允許在交易內新增 enum 值，只要**同一交易內不使用它**——我們的資料轉換不會用到 `TRANSFER`。若 Prisma 仍報錯，改拆成兩個 migration 檔 |
| **餘額算錯（本步最致命）**                               | 公式集中在 `AccountsService` 一處；單元測試涵蓋五個加減項 ＋ 兩個排除條件（軟刪除、非連動帳本）各一條獨立案例，不合併成一個大測試         |
| `toTransaction` 加 `viewerUserId` 波及所有交易端點       | 一次改完 service ＋ controller ＋ spec；型別系統會逼出所有呼叫點，**不留預設值**（給預設值等於埋一個「忘了傳就洩漏」的地雷）              |
| **前端在 Step 2～5 期間是壞的**                          | 已知且刻意：Step 6 修好才進 Step 7 驗收。中途不要求 `pnpm test` 根目錄全綠                                                                |
| 封存檢查放在 guard，可能誤擋合法讀取                     | 只擋非 GET；`GET` 一律放行（封存帳本仍可唯讀）。guard 的 spec 補兩條案例                                                                  |
| `Transaction.categoryId` 改 nullable 讓既有查詢/型別鬆掉 | shared 的 `Transaction.category` 同步改 `                                                                                                 | null`，TS 會逼前端處理；`assertCategoryConsistent` 改為只在有值時呼叫 |
| e2e `resetDb` 漏掉 `Account`                             | 與 2a 相同的易漏點，列為 Step 7 的獨立驗收項                                                                                              |

---

## 5. 各階段驗證點總表

- **每步後**：對應 package 的 `build` / `typecheck` 綠（Step 2～5 期間 web 可紅）。
- **全部完成**：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、
  `pnpm --filter @ledger/api test:e2e` 全綠；SC-C1～SC-C13 逐條打勾；
  瀏覽器手動走一次「註冊 → 看到預設帳戶 → 記一筆 → 餘額改變」。

---

## 6. 對外介面影響提醒

- **API 破壞性變更**（前端／未來 RN 都受影響）：
  - `/ledgers/:id/payment-methods` **整組移除** → 改為 `/accounts`
  - 交易 request：`paymentMethodId` 移除；`accountId` 條件必填；`categoryId` 改條件必填
  - 交易 response：`paymentMethod` 移除；新增 `account` / `toAccount`；`category` 可為 `null`
  - 交易 `type` 多一個 `TRANSFER`——前端的 type 判斷若用二分法（非 EXPENSE 即 INCOME）**會錯**
  - 帳本 response 多 `tracksBalance` / `archivedAt`
- **無新增執行期相依套件**；**無新增環境變數**。
- OpenAPI 由 Nest 自動產生，DTO 標註齊全即會同步。

---

## 7. 建議的 PR 切法

單一 PR `feature/accounts`（自 `main` 開，需先 merge `docs/accounts-spec`）：
shared → schema → accounts → 交易 → 帳本 → web 適配 → 測試一次到位。

**理由**：中間任何一刀切開，`main` 都會停在「API 已改、前端未改」或
「schema 已改、service 未改」的不可運作狀態，違反「`main` 永遠可部署」。
commit 依上述 7 步分次提交（每步經驗收後）。
