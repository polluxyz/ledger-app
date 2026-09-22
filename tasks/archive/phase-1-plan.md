# 實作計畫：階段一 — 核心記帳系統

> 狀態：**已核可**（2026-07-20）
> 依據：`docs/specs/phase-1-core-ledger.md`（已核可）
> 核可後拆分為 `tasks/todo.md`；實作依 Step 門控規則逐步進行。

---

## 1. 主要元件與相依關係

```
ConfigModule ──┐
PrismaModule ──┼──> AuthModule ──> 全域 JWT Guard
               │        │
               │        ▼
               │   UsersModule
               │
               ├──> LedgersModule ──> LedgerAccessGuard（帳本授權）
               │        │                    │
               │        ▼                    ▼
               ├──> CategoriesModule   （所有 /ledgers/{id}/** 端點）
               │        │
               │        ▼
               └──> TransactionsModule
```

關鍵相依：

- **PrismaModule 是一切的地基**：全域模組，提供 `PrismaService`，所有 service 注入使用。
- **AuthModule 先於所有受保護模組**：全域 JWT guard 就緒後，後續模組才能拿到 `request.user`。
- **LedgerAccessGuard 先於 Categories / Transactions**：兩者的所有端點都掛在 `/ledgers/{ledgerId}/` 之下，依賴該 guard 做成員資格與角色檢查。
- **註冊流程橫跨 Auth + Ledgers + Categories**（自動建個人帳本＋預設分類）：以「LedgersService 提供 `createLedgerForUser()`，AuthService 呼叫」處理，避免循環相依；預設分類常數放 `packages/shared`。
- **`packages/shared` 與各模組並行演進**：每個模組的 request/response 型別與錯誤碼，在實作該模組的 Step 內同步加入 shared。

## 2. 實作順序（Step 與 PR 對應）

| Step | 內容                                                                                       | Branch / PR                          |
| ---- | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| 1    | 本地 PostgreSQL 安裝（開發者親手）＋ Prisma 初始化、schema、首次 migration                 | PR① `feature/db-and-infra`           |
| 2    | API 基礎設施：Config、PrismaModule、ValidationPipe、錯誤 filter、Swagger、移除 Hello World | PR①（同上）                          |
| 3    | Auth + Users：註冊（自動建帳本）、登入、JWT guard、`/users/me`                             | PR② `feature/auth-and-users`         |
| 4    | Ledgers：帳本 CRUD、成員管理、LedgerAccessGuard                                            | PR③ `feature/ledgers-and-categories` |
| 5    | Categories：分類 CRUD、預設分類                                                            | PR③（同上）                          |
| 6    | Transactions：CRUD、分頁/篩選、軟刪除                                                      | PR④ `feature/transactions`           |
| 7    | 收尾：rate limiting、e2e 補全、README 更新                                                 | PR④（同上）                          |

順序理由：每個 Step 只依賴前面已完成的東西，且完成後都有可獨立驗證的產出。PR 粒度控制在單次可審閱的大小，且每個 PR 合併後 `main` 都是可部署狀態（CI 全綠）。

## 3. 各 Step 細節與驗證點

### Step 1：資料庫與 Prisma 地基

- **開發者親手**：安裝 PostgreSQL 18.x、建立 `ledger_dev` 與 `ledger_test` 資料庫（Claude 提供逐步說明）。
- 安裝 `prisma` / `@prisma/client`；建立 `apps/api/prisma/schema.prisma`（依 spec §3）；設定 `.env` 與 `.env.example`。
- 產生首次 migration 與 Prisma Client。
- **驗證點**：`npx prisma migrate dev` 成功；`npx prisma studio` 可看到空表；`pnpm typecheck` 通過。

### Step 2：API 基礎設施

- `@nestjs/config`（載入並驗證環境變數）、`PrismaModule`（全域）、全域 `ValidationPipe`（`whitelist: true, transform: true`）、統一錯誤格式的 exception filter（spec §4 格式）、Swagger 於 `/docs`、`/api` 全域前綴；移除 scaffolding 的 Hello World。
- `packages/shared`：建立 `constants/error-codes.ts` 骨架。
- **驗證點**：`start:dev` 啟動成功、`/docs` 可開；打不存在路徑回統一格式 404；lint / typecheck / test / build 全綠。

### Step 3：Auth + Users

- 註冊（bcrypt 雜湊、DB transaction 內建 User＋個人帳本＋OWNER 成員＋預設分類）、登入（簽發 JWT）、全域 JWT guard（`@Public()` decorator 豁免 auth 端點與 Swagger）、`GET/PATCH /users/me`。
- shared：auth/users 的 request/response 型別、預設分類常數。
- 單元測試：AuthService；e2e：註冊→登入→`/users/me` 流程、401 情境。
- **驗證點**：spec §2 條件 4（密碼雜湊、不洩漏 passwordHash）；e2e 通過。

### Step 4：Ledgers 與成員

- 帳本 CRUD（刪除需 `?confirm=`）、成員管理（加入/改角色/移除/退出、最後 OWNER 保護）、`LedgerAccessGuard` ＋ `@RequireLedgerRole()` decorator（非成員 404、角色不足 403）。
- 單元測試：guard 角色判定、最後 OWNER 規則；e2e：資料隔離核心情境（spec §2 條件 3）。
- **驗證點**：非成員一律 404；viewer 寫入 403；guard 測試全綠。

### Step 5：Categories

- 分類 CRUD（EDITOR 權限）、建帳本自動複製預設分類（Step 3 已接、此處補完整）、刪除保護（有交易引用 → 409，先以「引用檢查」實作，交易表此時尚空）。
- **驗證點**：新帳本自帶預設分類；e2e 權限情境通過。

### Step 6：Transactions

- CRUD、金額正整數驗證、分類與交易 type 一致性檢查、分頁/篩選/排序（spec §4 查詢參數）、軟刪除（所有查詢過濾 `deletedAt: null`）。
- 單元測試：TransactionsService 核心邏輯；e2e：分頁篩選正確性、軟刪除不可見、跨帳本分類引用被拒。
- **驗證點**：spec §2 條件 3 後半、條件 5。

### Step 7：收尾

- `@nestjs/throttler`（auth 端點收緊）、e2e 全情境補完、README 更新（本地啟動步驟）、Swagger 標註總檢查。
- **驗證點**：spec §2 全部條件逐條驗收＝階段一完成的定義。

## 4. 風險與對策

| 風險                                                 | 對策                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `bcrypt` 原生模組在 Windows 編譯失敗                 | 優先用預編譯 binary；若仍失敗改用純 JS 的 `bcryptjs`（介面相容，屬 Ask first 的相依變更）                                |
| e2e 測試資料庫的重置與隔離（測試互相污染）           | 專用 `ledger_test` 庫；每輪測試前 `prisma migrate reset`／逐表清空；e2e 序列執行（`--runInBand`）                        |
| 註冊流程非原子（建了 User 但帳本失敗）               | 一律包在 `prisma.$transaction` 內，任何一步失敗全部回滾；單元測試覆蓋                                                    |
| 授權檢查有漏（某端點忘了掛 guard）                   | guard 全域註冊、以 decorator 豁免（deny by default 的實作形式）；e2e 逐端點驗證 401/403/404                              |
| 「最後一名 OWNER」規則的併發競態                     | 階段一以 DB transaction 內重查成員數處理；極端併發留待未來（單人使用場景風險低）                                         |
| Prisma Client 產生物與 monorepo typecheck 的整合問題 | Prisma 7 client 產於 `apps/api/src/generated/`（進 `.gitignore`）；CI 與 typecheck 前先 `prisma generate`（納入 script） |

## 5. 全程驗證節奏

- 每個 Step 完成：`pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全綠才算完成，經開發者驗收後 commit。
- 每個 PR：CI 通過＋自我 code review 後合併（squash merge）。
- 階段一結束：以 spec §2「可驗證的成功條件」逐條驗收。
