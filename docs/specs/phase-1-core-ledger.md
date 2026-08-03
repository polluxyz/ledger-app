# Spec：階段一 — 核心記帳系統

> 狀態：**已核可**（2026-07-20）
> 對應開發階段：階段一（地基）
> 前置：階段零已完成（monorepo scaffolding、CI、分支保護）
> 假設清單：已於 2026-07-20 與開發者逐項確認定案（見本文各節）

---

## 1. 目標與成功樣貌

建立記帳系統的後端核心：使用者可以註冊登入，擁有個人帳本、建立家庭帳本並加入成員，在帳本內管理分類與交易。所有端點皆有授權檢查與資料隔離，並以 OpenAPI（Swagger UI）作為前後端契約與測試介面。

完成後的樣貌：

- 開發者啟動本地 PostgreSQL 與 `pnpm --filter @ledger/api start:dev` 後，瀏覽器開 Swagger UI 即可操作全部 API。
- 從「註冊 → 登入 → 自動擁有個人帳本 → 建家庭帳本 → 加成員 → 記帳 → 查詢/篩選/分頁」全流程可透過 API 完成。
- 授權與資料隔離有自動化測試護欄；`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全綠。

### 範圍內（In scope）

- AuthModule：註冊、登入、JWT 驗證。
- UsersModule：取得/更新自己的個人資料。
- LedgersModule：帳本 CRUD、成員與角色管理。
- CategoriesModule：帳本內分類 CRUD、預設分類。
- TransactionsModule：交易 CRUD、分頁/篩選/排序、軟刪除。
- 基礎設施：Prisma、全域驗證、統一錯誤格式、Swagger、rate limiting、`packages/shared` 共用型別。

### 範圍外（Out of scope，未來階段）

以下明確**不做**，但設計上保留擴充點（見 §9）：

Web/App 前端、AiModule、refresh token、Email 驗證、忘記密碼、OAuth、成員邀請確認流程、多幣別與匯率換算、轉帳/帳戶概念、預算、報表統計、多語系（i18n）。

---

## 2. 可驗證的成功條件

1. `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 於 repo 根目錄全部通過（CI 同步驗證）。
2. Swagger UI 於 `/docs` 可用，涵蓋所有端點，且每個 DTO 欄位皆有型別標註。
3. e2e 測試涵蓋以下情境並通過：
   - 註冊成功後自動擁有一本個人帳本（含預設分類），登入取得 JWT。
   - 未帶 token 存取受保護端點 → `401`。
   - 使用者存取**非成員帳本**的任何資源（帳本、分類、交易）→ `404`（不洩漏存在性）。
   - viewer 嘗試寫入（新增交易/分類）→ `403`。
   - editor 可記帳但不能管理成員；owner 可管理成員。
   - 交易列表分頁、日期區間與分類篩選結果正確。
   - 軟刪除後的交易不出現在列表與明細中。
4. 密碼以 bcrypt 雜湊儲存；資料庫中無明文密碼；回應與日誌不含 passwordHash。
5. 金額欄位為整數（最小貨幣單位）；API 拒絕非整數金額（`400`）。
6. auth 端點有 rate limiting（超限回 `429`）。

---

## 3. 資料模型（Prisma schema 草案）

> 定案原則：帳本為資料隔離邊界；個人/家庭同一套模型；金額整數；軟刪除交易。

```prisma
enum LedgerRole {
  OWNER
  EDITOR
  VIEWER
}

enum TransactionType {
  EXPENSE
  INCOME
}

model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  name         String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  memberships  LedgerMember[]
  transactions Transaction[]  @relation("TransactionCreator")
}

model Ledger {
  id        String   @id @default(uuid())
  name      String
  currency  String   @default("TWD") // ISO 4217，階段一僅開放 TWD
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  members      LedgerMember[]
  categories   Category[]
  transactions Transaction[]
}

model LedgerMember {
  ledgerId  String
  userId    String
  role      LedgerRole
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  ledger Ledger @relation(fields: [ledgerId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([ledgerId, userId])
}

model Category {
  id        String          @id @default(uuid())
  ledgerId  String
  name      String
  type      TransactionType
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt

  ledger       Ledger        @relation(fields: [ledgerId], references: [id], onDelete: Cascade)
  transactions Transaction[]

  @@unique([ledgerId, type, name])
}

model Transaction {
  id         String          @id @default(uuid())
  ledgerId   String
  categoryId String
  creatorId  String
  type       TransactionType
  amount     Int             // 最小貨幣單位的整數，> 0；TWD 即為「元」
  date       DateTime        // 消費日期（含時間，查詢以日期區間篩選）
  note       String?
  deletedAt  DateTime?       // 軟刪除標記
  createdAt  DateTime        @default(now())
  updatedAt  DateTime        @updatedAt

  ledger   Ledger   @relation(fields: [ledgerId], references: [id])
  category Category @relation(fields: [categoryId], references: [id])
  creator  User     @relation("TransactionCreator", fields: [creatorId], references: [id])

  @@index([ledgerId, date])
  @@index([ledgerId, categoryId])
}
```

設計要點：

- **金額**：`Int`、必為正整數；收支方向由 `type` 表達，不用正負號（語意清楚、報表好算）。
- **分類與交易同型別**：交易的 `category.type` 必須等於交易 `type`（service 層驗證）。
- **軟刪除**：僅 `Transaction` 需要（稽核價值最高）；所有查詢一律過濾 `deletedAt: null`。
- **分類刪除**：若已有交易引用（含軟刪除者）→ 回 `409`，不做連鎖刪除。
- **帳本刪除**：owner 可刪，連鎖刪除成員/分類/交易（Cascade）。刪除前 API 要求確認參數（見 §4）。
- 註冊時以 transaction（DB 交易）一次完成：建 User → 建個人 Ledger → 建 OWNER 成員 → 複製預設分類。

### 預設分類（種子資料，屬於各帳本可自行修改）

- 支出：餐飲、交通、購物、居住、娛樂、醫療、教育、其他
- 收入：薪資、獎金、投資、其他

定義放 `packages/shared`（常數），建立帳本時複製寫入該帳本。

---

## 4. API 設計

Base path：`/api`（版本化留待未來，擴充點見 §9）。標「🔒」= 需 JWT；粗體為權限下限。

### Auth（含 rate limiting）

| Method | Path             | 說明                                         | 成功  |
| ------ | ---------------- | -------------------------------------------- | ----- |
| POST   | `/auth/register` | email + password + name 註冊；自動建個人帳本 | `201` |
| POST   | `/auth/login`    | 登入，回 `{ accessToken }`                   | `200` |

### Users

| Method | Path           | 說明                   | 成功  |
| ------ | -------------- | ---------------------- | ----- |
| GET    | `/users/me` 🔒 | 取得自己的資料         | `200` |
| PATCH  | `/users/me` 🔒 | 更新自己的資料（name） | `200` |

### Ledgers 與成員

| Method | Path                                      | 權限                    | 說明                                          |
| ------ | ----------------------------------------- | ----------------------- | --------------------------------------------- |
| POST   | `/ledgers` 🔒                             | 登入者                  | 建帳本（自動成為 OWNER、複製預設分類）        |
| GET    | `/ledgers` 🔒                             | 登入者                  | 列出自己所屬帳本（含自己的角色）              |
| GET    | `/ledgers/{ledgerId}` 🔒                  | **VIEWER**              | 帳本明細（含成員清單）                        |
| PATCH  | `/ledgers/{ledgerId}` 🔒                  | **OWNER**               | 改名                                          |
| DELETE | `/ledgers/{ledgerId}` 🔒                  | **OWNER**               | 刪帳本（需 query `?confirm=帳本名稱` 防誤刪） |
| GET    | `/ledgers/{ledgerId}/members` 🔒          | **VIEWER**              | 成員列表                                      |
| POST   | `/ledgers/{ledgerId}/members` 🔒          | **OWNER**               | 以 email 加入**已註冊**使用者並指定角色       |
| PATCH  | `/ledgers/{ledgerId}/members/{userId}` 🔒 | **OWNER**               | 變更成員角色                                  |
| DELETE | `/ledgers/{ledgerId}/members/{userId}` 🔒 | **OWNER**（或本人退出） | 移除成員/退出帳本                             |

成員規則：帳本至少一名 OWNER（最後一名 OWNER 不可退出/降級/被移除 → `409`）；不可加入已是成員者（`409`）；email 查無已註冊使用者 → `404`。

### Categories

| Method | Path                                             | 權限       | 說明                       |
| ------ | ------------------------------------------------ | ---------- | -------------------------- |
| GET    | `/ledgers/{ledgerId}/categories` 🔒              | **VIEWER** | 列表（可 `?type=` 篩選）   |
| POST   | `/ledgers/{ledgerId}/categories` 🔒              | **EDITOR** | 新增                       |
| PATCH  | `/ledgers/{ledgerId}/categories/{categoryId}` 🔒 | **EDITOR** | 改名                       |
| DELETE | `/ledgers/{ledgerId}/categories/{categoryId}` 🔒 | **EDITOR** | 刪除（有交易引用 → `409`） |

### Transactions

| Method | Path                                                  | 權限       | 說明     |
| ------ | ----------------------------------------------------- | ---------- | -------- |
| GET    | `/ledgers/{ledgerId}/transactions` 🔒                 | **VIEWER** | 分頁列表 |
| POST   | `/ledgers/{ledgerId}/transactions` 🔒                 | **EDITOR** | 新增     |
| GET    | `/ledgers/{ledgerId}/transactions/{transactionId}` 🔒 | **VIEWER** | 明細     |
| PATCH  | `/ledgers/{ledgerId}/transactions/{transactionId}` 🔒 | **EDITOR** | 部分更新 |
| DELETE | `/ledgers/{ledgerId}/transactions/{transactionId}` 🔒 | **EDITOR** | 軟刪除   |

列表查詢參數：`page`（預設 1）、`limit`（預設 20、上限 100）、`from` / `to`（ISO 日期）、`categoryId`、`type`。預設排序 `date` 新→舊。回應含 `{ items, page, limit, total }`。

### 授權模型（deny by default）

- 全域 JWT guard：除 `/auth/*` 與 Swagger 外，一律要求登入（`401`）。
- 帳本層 guard：所有 `/ledgers/{ledgerId}/**` 端點先查成員資格——**非成員一律 `404`**（避免洩漏帳本存在性）；是成員但角色不足 → `403`。
- 角色層級：OWNER > EDITOR > VIEWER，以「權限下限」宣告於各端點（如 `@RequireLedgerRole('EDITOR')`）。

### 統一錯誤格式

```json
{
  "statusCode": 409,
  "errorCode": "LAST_OWNER_CANNOT_LEAVE",
  "message": "A ledger must have at least one owner."
}
```

- `errorCode` 為穩定的機器可讀代碼（未來 i18n 依此顯示文案），集中定義於 `packages/shared`。
- 不洩漏堆疊、SQL、內部細節；驗證錯誤（`400`）附欄位層級訊息。

---

## 5. 技術方案與新增相依

> 新增相依屬「Ask first」項目，在此一次列出，隨 spec 一併審核。

`apps/api` dependencies：

| 套件                                    | 用途                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `prisma`（dev）/ `@prisma/client`       | ORM 與 migration（Prisma 7）                                                                |
| `@prisma/adapter-pg`                    | Prisma 7 驅動介面卡：執行期 client 經 `pg` 連線 PostgreSQL                                  |
| `dotenv`（dev）                         | 供 `prisma.config.ts` 載入 `.env`（Prisma 7 不再自動載入）                                  |
| `@nestjs/config`                        | 環境變數載入與驗證                                                                          |
| `@nestjs/jwt`                           | JWT 簽發與驗證（採官方現行教學做法：`@nestjs/jwt` + 自訂 Guard，不引入 passport，減少相依） |
| `bcrypt`（+ `@types/bcrypt`）           | 密碼雜湊                                                                                    |
| `class-validator` / `class-transformer` | DTO 驗證（全域 `ValidationPipe`，`whitelist: true`）                                        |
| `@nestjs/swagger`                       | OpenAPI / Swagger UI                                                                        |
| `@nestjs/throttler`                     | Rate limiting（auth 端點收緊）                                                              |

環境變數（同步更新 `.env.example`）：

```
DATABASE_URL=postgresql://user:password@localhost:5432/ledger_dev
JWT_SECRET=
JWT_EXPIRES_IN=7d
PORT=3000
```

開發環境：**本地安裝 PostgreSQL 18.x**（不用 Docker；由開發者親手安裝，Claude 陪跑說明）。程式僅透過 `DATABASE_URL` 連線，未來部署形態改變不影響程式碼。

---

## 6. 對專案結構的影響

```
apps/api/src/
├── app.module.ts          # 掛載各模組、全域 guard/pipe/filter
├── main.ts                # bootstrap、Swagger 設定
├── prisma/                # PrismaModule + PrismaService
├── common/                # 錯誤 filter、共用 decorator、分頁工具
├── auth/                  # AuthModule（controller/service/dto/guard）
├── users/                 # UsersModule
├── ledgers/               # LedgersModule（含成員管理、帳本授權 guard）
├── categories/            # CategoriesModule
└── transactions/          # TransactionsModule

apps/api/prisma/
├── schema.prisma
└── migrations/

packages/shared/src/
├── constants/             # 錯誤碼、預設分類、幣別
└── types/                 # API request/response 型別（前端未來直接引用）
```

- `TransactionsService` 介面設計為未來 AiModule 的唯一寫入入口（AI 只產草稿，確認後呼叫本 service）。
- 既有 scaffolding（`app.controller.ts`/`app.service.ts` 的 Hello World）將移除。

---

## 7. 測試策略

- **單元測試**（`*.spec.ts` 與程式碼同目錄）：AuthService（雜湊、驗證）、帳本授權 guard/service（角色判定、最後 OWNER 規則）、TransactionsService（型別與分類一致性、金額驗證、軟刪除過濾）、CategoriesService（刪除保護）。Prisma 以 mock 隔離。
- **e2e 測試**（`apps/api/test/`）：§2 所列授權與資料隔離情境為必測核心，走真實 PostgreSQL 測試資料庫（`ledger_test`，每輪重置）。
- 授權與資料隔離測試是安全防線，**任何相關改動必須先讓測試存在**。

---

## 8. 界線（Always / Ask first / Never）— 階段一補充

依 CLAUDE.md §12 為準，本階段特別強調：

- **Always**：每個 `/ledgers/{ledgerId}/**` 端點過帳本 guard；所有交易查詢過濾 `deletedAt: null`；schema 變更走 Prisma migration；新增環境變數同步 `.env.example`。
- **Ask first**：偏離本 spec 的任何設計（含 schema 欄位增減、端點增減、錯誤碼語意變更）；新增本文未列的相依套件。
- **Never**：金額用浮點數；回應洩漏 `passwordHash` 或其他使用者的個資；未過授權檢查的查詢直接以 `ledgerId` 撈資料。

---

## 9. 擴充點（未來功能如何接上，現在不實作）

| 未來功能       | 現在預留的設計                                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 多幣別         | `Ledger.currency`（ISO 4217）已存在；金額為最小單位整數，未來於 `packages/shared` 加「幣別→小數位數」對照表即可                                                                                                                                                     |
| Refresh token  | Auth 回應為 `{ accessToken }` 物件（而非裸字串），未來加欄位不破壞契約                                                                                                                                                                                              |
| 成員邀請確認流 | 成員管理集中於 LedgersService，未來以 Invitation 資料表 + 新端點擴充，現有端點不變                                                                                                                                                                                  |
| 轉帳/帳戶      | `TransactionType` 為 enum，未來可加值；schema 不排斥新增 Account 資料表                                                                                                                                                                                             |
| i18n           | 錯誤碼（`errorCode`）機制；預設分類為可改名的使用者資料，非寫死文案                                                                                                                                                                                                 |
| AI 記帳        | AiModule 產草稿 → 使用者確認 → 呼叫 `TransactionsService.create()`，寫入路徑唯一                                                                                                                                                                                    |
| API 版本化     | 現為 `/api` 前綴；需要時以 NestJS URI versioning 加 `/api/v2`，既有路徑不動                                                                                                                                                                                         |
| 本地／離線模式 | 部分使用者只想把資料留在自己手機、不登入。此為 **App 端的離線優先儲存策略**（本地 SQLite/AsyncStorage，不呼叫 API），後端核心不受影響；未來可走「離線優先＋選配帳號（guest → 升級同步/家庭）」。家庭模式本質需要伺服器故不適用此模式。屬 App 階段主題，非階段一範圍 |

---

## 10. Step 拆分概觀

> 細節（順序、相依、驗收指令）待 spec 核可後寫入 `tasks/plan.md` 與 `tasks/todo.md`。每個 Step 依門控規則：先說明 → 同意 → 實作 → 驗收 → commit。

1. 開發環境：本地 PostgreSQL 安裝（開發者親手）＋ Prisma 初始化、schema、首次 migration。
2. API 基礎設施：ConfigModule、PrismaModule、全域 ValidationPipe、統一錯誤 filter、Swagger、移除 Hello World。
3. Auth + Users：註冊（含自動建帳本）、登入、JWT guard、`/users/me`。
4. Ledgers：帳本 CRUD、成員管理、帳本授權 guard。
5. Categories：分類 CRUD、預設分類種子。
6. Transactions：CRUD、分頁/篩選、軟刪除。
7. 收尾：rate limiting、e2e 補全、文件（README 更新）。

預計 3–4 條 feature branch / PR（基礎設施＋schema、auth+users、ledgers+categories、transactions+收尾），單一 PR 保持可審閱大小。
