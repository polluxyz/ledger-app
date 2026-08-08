# 任務清單：階段一 — 核心記帳系統

> 狀態：**已核可**（2026-07-20）
> 依據：`docs/specs/phase-1-core-ledger.md`、`tasks/plan.md`（皆已核可）
> 用法：依序執行；每個任務有驗收條件與驗證方式。勾選代表「開發者已驗收」。
> 標 👤 = 開發者親手操作（Claude 陪跑說明）；其餘由 Claude 實作、開發者驗收。
> 通用驗收（每個任務皆適用，不再重複列）：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全綠。

---

## PR① `feature/db-and-infra`（Step 1–2）

### Step 1：資料庫與 Prisma 地基

- [x] **1.1 👤 安裝 PostgreSQL 18.x 並建立資料庫**（2026-07-20 完成：PostgreSQL 18.4）
  - 內容：本機安裝 PostgreSQL；建立 `ledger_dev`、`ledger_test` 兩個資料庫與開發用帳號。
  - 驗收：`psql` 可連線兩個資料庫。
- [x] **1.2 安裝 Prisma 並初始化**（Prisma 7 + pg adapter；含 `prisma.config.ts`）
  - 內容：`apps/api` 加入 `prisma`（dev）與 `@prisma/client`；建立 `prisma/schema.prisma`；`.env`（不入版控）與 `.env.example` 加入 `DATABASE_URL`。
  - 驗收：`npx prisma validate` 通過；`.env.example` 有鍵無值。
- [x] **1.3 撰寫 schema 並產生首次 migration**
  - 內容：依 spec §3 完整定義 enum 與 5 個 model；`prisma migrate dev` 產生首次 migration。
  - 驗收：migration 檔進版控；`prisma studio` 可見全部資料表；重跑 `prisma migrate dev` 無 pending 變更。

### Step 2：API 基礎設施

- [x] **2.1 ConfigModule 與環境變數驗證**（Zod；並鎖定 build rootDir 至 src）
  - 內容：`@nestjs/config` 全域載入；以 schema 驗證 `DATABASE_URL`、`JWT_SECRET`、`JWT_EXPIRES_IN`、`PORT`，缺漏即啟動失敗；`.env.example` 同步補齊。
  - 驗收：缺 `JWT_SECRET` 時 `start:dev` 啟動報錯且訊息明確。
- [x] **2.2 PrismaModule / PrismaService**（postinstall 自動 `prisma generate`）
  - 內容：全域 PrismaModule；PrismaService 管理連線生命週期（`onModuleInit` 連線、關閉時斷線）。
  - 驗收：`start:dev` 啟動成功且連上 DB（連線失敗有清楚錯誤）。
- [x] **2.3 全域 ValidationPipe 與統一錯誤 filter**（含 `forbidNonWhitelisted`）
  - 內容：`class-validator`/`class-transformer`；`ValidationPipe({ whitelist: true, transform: true })`；exception filter 輸出 spec §4 錯誤格式；`packages/shared` 建 `constants/error-codes.ts` 骨架；未知例外一律回 500 通用訊息（不洩漏內部細節）。
  - 驗收：打不存在路徑回統一格式 404；單元測試覆蓋 filter 的格式輸出。
- [x] **2.4 Swagger 與 `/api` 前綴，移除 Hello World**
  - 內容：全域前綴 `/api`；`@nestjs/swagger` 於 `/docs`；刪除 `app.controller.ts`/`app.service.ts` 與對應測試。
  - 驗收：`/docs` 可開且顯示（目前為空的）API 文件；舊 Hello World 路由消失。
- [ ] **2.5 👤 PR①：自我 review 後合併**
  - 驗收：CI 全綠；squash merge 進 `main`。

---

## PR② `feature/auth-and-users`（Step 3）

- [x] **3.1 註冊端點（含自動建個人帳本）**
  - 內容：`POST /auth/register`；bcrypt 雜湊；`prisma.$transaction` 內完成 User＋個人 Ledger＋OWNER 成員＋預設分類（常數放 shared）；email 重複回 409 `EMAIL_ALREADY_EXISTS`。
  - 驗收：單元測試覆蓋雜湊與原子性（模擬中途失敗全回滾）；回應不含 `passwordHash`。
- [x] **3.2 登入端點與 JWT 簽發**
  - 內容：`POST /auth/login`；驗證密碼、簽發 JWT（`@nestjs/jwt`）；回 `{ accessToken }`；帳密錯誤一律回 401 同一訊息（不洩漏 email 是否存在）。
  - 驗收：單元測試覆蓋成功/失敗路徑。
- [x] **3.3 全域 JWT guard 與 `@Public()` decorator**
  - 內容：全域 guard 驗 JWT、掛 `request.user`；`@Public()` 豁免 auth 端點；Swagger 加 bearer auth 設定。
  - 驗收：e2e——無 token 打受保護端點 401；有效 token 通過；auth 端點免 token。（以實際發請求驗證；正式 jest-e2e 併入 Step 7）
- [x] **3.4 Users：`GET/PATCH /users/me`**
  - 內容：取得/更新（name）自己的資料；DTO 與 shared 型別。
  - 驗收：e2e——註冊→登入→查me→改名全流程。（以實際發請求驗證；正式 jest-e2e 併入 Step 7）
- [ ] **3.5 👤 PR②：自我 review 後合併**
  - 驗收：CI 全綠；squash merge。

---

## PR③ `feature/ledgers-and-categories`（Step 4–5）

- [x] **4.1 帳本 CRUD**（與 4.2 合併實作，對稱 owner 模型）
  - 內容：建立（自動 OWNER＋預設分類，重用 3.1 的 `createLedgerForUser()`）、列表（含自己角色）、明細（含成員）、改名、刪除（`?confirm=名稱`，Cascade）。
  - 驗收：e2e——建立/列表/明細/改名/刪除；confirm 不符回 400。
- [x] **4.2 LedgerAccessGuard ＋ `@RequireLedgerRole()`**
  - 內容：查成員資格——非成員 404、角色不足 403；角色層級 OWNER > EDITOR > VIEWER；掛上所有 `/ledgers/{ledgerId}/**` 端點。
  - 驗收：單元測試覆蓋角色判定矩陣；e2e——非成員存取他人帳本 404。
- [x] **4.3 成員管理**（對稱 owner + 最後 owner 保護；決策見 spec §4）
  - 內容：成員列表；以 email 加入已註冊使用者（查無 404、已是成員 409）；改角色；移除/退出；最後 OWNER 保護（409 `LAST_OWNER_CANNOT_LEAVE`，DB transaction 內重查）。
  - 驗收：單元測試覆蓋最後 OWNER 各情境（退出/降級/被移除）；e2e——owner 管理成員、editor/viewer 被拒 403。
- [x] **5.1 分類 CRUD 與預設分類補完**（獨立 CategoriesModule）
  - 內容：列表（`?type=` 篩選）、新增/改名（EDITOR，同帳本同型別名稱唯一 409）、刪除（有交易引用 409——引用檢查先行，交易表此時尚空）。
  - 驗收：e2e——新帳本自帶預設分類；viewer 寫入 403；重複名稱 409。
- [ ] **5.2 👤 PR③：自我 review 後合併**
  - 驗收：CI 全綠；squash merge。

---

## PR④ `feature/transactions`（Step 6–7）

- [x] **6.1 交易新增與明細**（含 `Transaction→Ledger` cascade migration）
  - 內容：`POST`（EDITOR；金額正整數、`categoryId` 屬同帳本且 type 一致，違者 400/404）；`GET` 明細；`creatorId` 記錄記帳者；shared 型別。
  - 驗收：單元測試——金額與分類一致性驗證；e2e——跨帳本 categoryId 被拒。
- [x] **6.2 交易列表（分頁/篩選/排序）**
  - 內容：`page`/`limit`（預設 1/20、上限 100）、`from`/`to`/`categoryId`/`type` 篩選；`date` 新→舊；回 `{ items, page, limit, total }`。
  - 驗收：e2e——分頁邊界（超出頁數回空陣列）、日期區間與分類篩選正確。
- [x] **6.3 交易更新與軟刪除**
  - 內容：`PATCH` 部分更新（同 6.1 驗證規則）；`DELETE` 設 `deletedAt`；所有查詢過濾 `deletedAt: null`；5.1 的分類引用檢查納入軟刪除交易。
  - 驗收：e2e——軟刪除後列表與明細均不可見；再刪回 404。
- [x] **7.1 Rate limiting**（auth 60 秒 5 次；429 訊息清乾淨）
  - 內容：`@nestjs/throttler`；auth 端點收緊（如 60 秒 5 次），其餘寬鬆全域限制。
  - 驗收：e2e——連打登入超限回 429。
- [x] **7.2 e2e 全情境補完與最終驗收**（jest-e2e vs `ledger_test`＋CI Postgres service；README 更新）
  - 內容：比對 spec §2 成功條件逐條補齊缺漏的 e2e；README 更新（環境需求、本地啟動步驟、常用指令）；Swagger 標註總檢查（每個 DTO 欄位有型別與範例）。
  - 驗收：spec §2 全部條件逐條打勾＝**階段一完成**。
- [ ] **7.3 👤 PR④：自我 review 後合併**
  - 驗收：CI 全綠；squash merge。
