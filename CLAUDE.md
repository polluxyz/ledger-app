# CLAUDE.md

本檔案為 Claude Code 在此專案工作的權威指引。請在每次任務開始前閱讀並遵守本檔的決策與規範。若本檔與你既有的通用做法衝突，以本檔為準。

---

## 1. 專案概述

這是一套**記帳系統**，支援兩種使用模式：

- **個人模式**：使用者管理自己的帳本與交易。
- **家庭模式**：多名使用者共享同一本帳本，可協作記帳，並依角色控制權限。

系統提供 **Web 版**與**行動 App 版（Android / iOS）**，兩者皆透過後端 API 串接。

未來規劃的核心亮點功能是 **AI 自動記帳**：使用者可用自然語言（最終目標為語音）描述消費，系統解析為結構化交易草稿，經使用者確認後寫入帳本。

### 核心設計原則（貫穿所有開發）

1. **可維護性**：清楚的模組邊界、一致的命名、完整型別、避免過度設計。
2. **可擴充性**：新功能（特別是 AI provider、新帳本類型）應能在不改動核心的前提下加入。
3. **安全性**：涉及金錢與多人共享資料，授權與資料隔離是第一優先，絕不可忽略。
4. **單一後端原則**：所有業務邏輯只存在於 NestJS 後端。Web 與 App 是純前端，只透過 API 取用資料，**絕不在前端實作業務邏輯**（兩個前端必須共用同一套 API）。此原則不因前端框架更換而改變。

> 各項選型「為什麼這樣選」的完整理由，見專案根目錄的《專案決策脈絡》文件。變更選型前先閱讀該文件理解決策背景。

---

## 2. 技術選型（已定案，勿擅自更換）

| 層 | 技術 |
|---|---|
| 資料庫 | PostgreSQL |
| 後端框架 | NestJS (TypeScript) |
| ORM | Prisma |
| 資料驗證 | Zod 與 / 或 NestJS class-validator（DTO 層） |
| Web 前端 | React + TypeScript + Vite |
| 行動 App | React Native + Expo (TypeScript) |
| API 規格 | OpenAPI（由後端產生 / 維護） |

整個系統以 **TypeScript** 為統一語言，盡量共用型別定義（API 的 request / response 型別應可供前端與 App 重用）。

若你認為某項選型在特定情境下不適用，**先提出建議與理由，不要直接替換**。

---

## 3. 系統架構

### 高層分層

```
[ Web (React) ]   [ App (React Native) ]
        \               /
         \             /
        [ 後端 API：NestJS ]
                 |
        [ Prisma ORM ]
                 |
        [ PostgreSQL ]
```

### 後端模組劃分（NestJS Modules）

- **AuthModule**：認證、授權、JWT、密碼雜湊。
- **UsersModule**：使用者帳號與個人資料。
- **LedgersModule**：帳本（個人 / 家庭），成員與角色管理。
- **TransactionsModule**：交易的 CRUD 與業務邏輯。系統的核心，介面務必設計乾淨。
- **CategoriesModule**：消費分類。
- **AiModule**（後續階段）：封裝語音轉文字（STT）與 LLM 自然語言解析，輸出「交易草稿」。**不直接寫入資料庫**，而是呼叫 `TransactionsService`。

### 專案結構（Monorepo）

本專案採 **monorepo**，後端、Web、App 同處一個 repo，便於共用型別與統一管理。建議結構：

```
/
├── apps/
│   ├── api/        # NestJS 後端
│   ├── web/        # React + Vite 前端
│   └── mobile/     # React Native + Expo App
├── packages/
│   └── shared/     # 共用 TypeScript 型別、常數、工具（API 型別共享於此）
├── .github/        # workflows、PR/issue template
├── CLAUDE.md
└── README.md
```

- 跨端共用的型別（特別是 API 的 request / response 型別）放在 `packages/shared`，由各 app 引用，確保前後端型別一致。
- Workspace 管理使用 **pnpm workspaces**（安裝快、磁碟效率高、monorepo 支援佳）。若專案成長後需要建置快取與任務編排，再評估加入 Turborepo，現階段不引入以免過度複雜。
- 各 app 可有自己的子 `CLAUDE.md` 補充該層特定約定；根目錄這份負責全局。

### AI 功能的擴充設計（重要）

AI 記帳分三段：STT（語音→文字）、NLU（文字→結構化草稿）、寫入（呼叫既有交易邏輯）。

- LLM 來源必須抽象化，定義 `LLMProvider` 介面（例如方法 `parseTransaction(text): TransactionDraft`）。
- 提供多個實作：雲端（如 `OpenAIProvider`、`ClaudeProvider`）與本地（如 `LocalOllamaProvider`）。
- 透過 NestJS 的依賴注入與設定檔切換 provider，**上層程式不得依賴特定 provider**。
- AI 解析結果一律先回傳「草稿」供使用者確認 / 修改，**嚴禁未經確認直接寫入帳本**（金錢資料容錯率必須高）。

---

## 4. 開發階段（依序進行，勿跳階）

**階段零 — 專案初始化**：建立 GitHub repo、monorepo scaffolding（pnpm workspaces）、基礎 CI workflow、分支保護、`.gitignore` / `.env.example` / README 等倉庫文件。**此階段的 GitHub 設定（建 repo、分支保護規則、第一個 CI workflow）由開發者親手操作以達成學習目的**，Claude Code 從旁說明與產生設定檔內容即可，勿代為完成所有設定。

**階段一 — 地基**：核心記帳系統。個人 / 家庭帳本、交易 CRUD、認證授權。把 `TransactionsService` 介面設計乾淨。

**階段二 — AI 文字版**：建立 `AiModule` 與 `LLMProvider` 介面。先支援「打字輸入自然語言 → 解析 → 確認 → 記帳」，使用雲端 API。先不處理語音。

**階段三 — 語音 + 本地模型**：加入 STT；加入本地 provider，驗證 Adapter 設計的可換性。

除非當前階段任務明確要求，否則不要提前實作後續階段的功能。

---

## 5. 資料模型原則

> 詳細 schema 尚在設計中。以下為必須遵守的原則。

- **帳本是資料隔離的核心邊界**。每筆交易都屬於某個帳本；所有查詢都必須限定在使用者有權存取的帳本範圍內。
- **個人模式與家庭模式應以同一套帳本模型表達**，差別在於成員數與角色，而非兩套獨立資料表。
- 使用者與帳本為多對多關係，透過「成員」關聯表並帶有**角色**（如 owner / editor / viewer）。
- 金額**不可使用浮點數**。使用整數（以最小貨幣單位儲存，如「分」）或 Prisma 的 `Decimal`，避免精度誤差。
- 重要資料表保留 `createdAt` / `updatedAt`；考慮對交易採軟刪除（soft delete）以利稽核。

---

## 6. 程式碼規範

### 通則

- 全程使用 TypeScript，**啟用 strict 模式**，避免 `any`；必要時用 `unknown` 並加以收斂。
- 命名清楚、語意完整，勿用無意義縮寫。
- 遵循 NestJS 慣例：`*.module.ts`、`*.controller.ts`、`*.service.ts`、`*.dto.ts`。
- 業務邏輯放在 **service**，controller 只負責處理請求 / 回應與驗證。
- 對外輸入一律經過 DTO 驗證（class-validator / Zod），**絕不信任未驗證的輸入**。

### 資料庫

- 所有 schema 變更都透過 **Prisma migration**，不可手動改資料庫。
- 變更 `schema.prisma` 後，務必產生對應 migration 並更新 Prisma Client。

### 錯誤處理

- 使用 NestJS 的 exception filter 與標準 HTTP 例外。
- 錯誤訊息對使用者要清楚，但**不可洩漏內部細節**（堆疊、SQL、機敏資訊）。

---

## 7. 安全性要求（不可妥協）

- **授權檢查必做**：每個存取帳本 / 交易的端點，都必須驗證當前使用者對該帳本有對應權限。預設拒絕（deny by default）。
- **資料隔離**：使用者永遠不能讀寫不屬於自己帳本的資料。撰寫查詢時主動以帳本權限過濾。
- 密碼使用強雜湊（如 bcrypt / argon2），**絕不明文儲存或記錄**。
- 機敏設定（DB 連線、JWT 密鑰、LLM API key）一律放 **環境變數**，**禁止寫死或提交進版本庫**。
- 對外 API 套用適當的 rate limiting，特別是認證與 AI 相關端點。
- 記錄日誌時**遮蔽機敏資訊**（密碼、token、API key、完整交易明細視情況）。

---

## 8. API 設計規範

本系統採 **RESTful 風格**，並以 **OpenAPI** 描述（由 NestJS 自動產生）。REST 是設計風格，OpenAPI 是描述該 API 的規格文件，兩者搭配使用。

### REST 約定

- 資源用**名詞複數**：`/ledgers`、`/transactions`、`/categories`。
- 巢狀表達歸屬：`GET /ledgers/{ledgerId}/transactions`。
- HTTP 動詞對應操作：GET 查詢、POST 新增、PATCH 部分更新、PUT 全量替換、DELETE 刪除。
- 正確使用狀態碼：200 / 201 / 204 成功；400 輸入錯誤；401 未認證；403 無權限；404 不存在；409 衝突。
- **一致的錯誤回應格式**，且不洩漏內部細節（呼應安全性要求）。
- 列表端點支援**分頁、篩選、排序**：如 `?page=&limit=&from=&to=&categoryId=`。交易量會成長，從一開始就設計好。
- **授權貫穿每個端點**：存取帳本相關資源前必先驗證權限（deny by default）。
- 動作型操作（非純資源 CRUD）務實處理：如 AI 解析用 `POST /ai/parse-transaction`（輸入文字，回傳交易草稿）。不必為了純粹而硬凹。

### OpenAPI 約定

- 善用 NestJS 的 OpenAPI 支援：每個 controller 加 `@ApiTags`，每個 DTO 完整標註型別，使自動產生的文件與 Swagger UI 完整正確。
- 將 OpenAPI 視為前後端契約；可由其產生 TypeScript 型別供 Web / App 共用。

---

## 9. 測試

- 核心業務邏輯（交易、授權、帳本權限）需有單元測試。
- 授權與資料隔離邏輯**必須有測試覆蓋**，這是安全性的防線。
- 新增功能時一併補上測試，勿事後補。

---

## 10. Git / GitHub 開發流程（企業級標準）

本專案全程透過 GitHub 進行版本控管，採企業級流程。未來可能開源或商業化，故文件與流程需完整、規範。**即使單人開發也完整走完整流程**——這是練習與展現專業度的核心。

### 分支策略（GitHub Flow）

- `main` 永遠保持**可部署狀態**，禁止直接 push。
- 所有開發都在 feature branch 進行，透過 **Pull Request** 合併回 `main`。
- 分支命名加前綴表明目的：
  - `feature/` 新功能，如 `feature/ai-transaction-parsing`
  - `fix/` 修錯，如 `fix/auth-token-expiry`
  - `refactor/`、`docs/`、`test/`、`chore/` 視性質使用

### Commit 規範（Conventional Commits）

- 格式：`<type>: <簡述>`，type 包括 `feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `perf` / `ci`。
- 範例：`feat: add ledger member role validation`、`fix: prevent cross-ledger data access`。
- 一個 commit 聚焦一件事，訊息清楚說明「做了什麼」。
- 此規範可支援未來自動產生 changelog。

### Pull Request 流程

- 每個 feature / fix 開獨立 PR，**不可把無關變更混在一起**。
- PR 描述需說明：改了什麼、為什麼、如何測試、影響範圍（特別是是否動到資料模型或 API 介面）。
- PR 必須通過 CI 才能合併。
- 單人開發時亦進行**自我 code review**，把 PR 當成留給未來與審查者看的決策紀錄。
- 合併建議用 squash merge，保持 `main` 歷史乾淨。

### 分支保護（main）

- 禁止直接 push 到 `main`。
- PR 必須通過所有 CI 檢查才能合併。
- 視情況要求至少一個 approval（多人協作或開源後）。

### CI/CD（GitHub Actions）

CI 放在 `.github/workflows/`。考量未來開源 / 商業化，預留可擴展空間，分階段建置：

- **現階段 CI**（每次 PR 必跑）：
  - 安裝相依 → lint → type check → 測試 → build。
  - monorepo 下可針對受影響的 app 分別跑（如 api / web / mobile 各自的 job）。
- **未來可擴充**：
  - CD 自動部署（後端容器化部署、Web 靜態部署）。
  - 自動產生 changelog 與版本標籤（搭配 Conventional Commits）。
  - 程式碼覆蓋率報告、安全性掃描（如相依套件漏洞檢查）、Docker 映像建置。

### 必備倉庫文件

- `.gitignore`：**絕不提交** `.env`、`node_modules`、build 產物、機敏檔案。
- `.env.example`：列出所需環境變數的鍵（不含實際值），方便他人設定。
- `README.md`：專案簡介、技術棧、本地啟動步驟。
- `.github/pull_request_template.md`：統一 PR 描述格式。
- 為未來開源預留：`LICENSE`、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、issue template（時機成熟再補）。

---

## 11. 與 Claude Code 協作的約定

- 進行任何變更前，先理解相關模組的現有結構，**與既有慣例保持一致**。
- 涉及架構決策、選型變更、資料模型重大調整時，**先說明方案與取捨，取得確認後再實作**。
- 一次專注完成一件事；大型任務先拆解步驟再執行。
- 變更資料模型或 API 介面時，同步提醒前端 / App 端可能受影響之處。
- 不確定需求時**主動提問**，不要臆測後逕行實作。
- 產生的程式碼要可直接運行，避免留下 `TODO` 佔位而未說明。
- **遵守 Git 流程**：在 feature branch 上工作，不直接動 `main`；commit 遵循 Conventional Commits；完成功能以 PR 形式整理，並寫清楚 PR 描述。
- 提交前自我檢查：lint、type check、測試應可通過（對齊 CI 要求）。
- **絕不提交機敏資訊**（`.env`、API key、密鑰）；新增環境變數時同步更新 `.env.example`。
