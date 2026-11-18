# CLAUDE.md

本檔是專案共用規範。依任務讀相應的分層指引與規格。

## 1. 專案目標

交付可部署的個人與家庭記帳系統。兩種模式共用帳本模型。Web 與行動 App 共用後端 API。業務邏輯只在後端。AI 只產生交易草稿，由使用者確認後走原有寫入流程。

## 2. 技術選型（已定案，勿擅自更換）

TypeScript strict、NestJS、PostgreSQL、Prisma、class-validator（DTO）、Zod（環境變數）、OpenAPI、React + Vite、React Native + Expo（行動 App 待建）、pnpm workspaces。替換前讀[專案決策脈絡](專案決策脈絡.md)，說明理由並取得同意。

## 3. 架構與專案結構

- 修改後端或 Web 前，讀對應的 [API 指引](apps/api/CLAUDE.md)或 [Web 指引](apps/web/CLAUDE.md)。
- 共用型別與工具放 `packages/shared`。修改後先跑 `pnpm --filter @ledger/shared build`，再檢查使用這個套件的程式。
- shared 使用 Node 內建測試工具。被測檔只能用 `import type`，避免無法解析省略副檔名的值匯入。
- 用能維持 UTF-8 的工具編輯繁中檔案。
- 提交前跑 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`。平行工作只格式化自己的檔案。

## 4. 開發階段

階段與規格狀態見[文件索引](docs/README.md#開發階段)。只實作當前核可的範圍與明確要求的擴充點。

## 5. 開發工作流程

1. 新功能或重大變更先請開發者確認假設。再寫 `docs/specs/` 規格，列目標、結構影響、界線、測試策略及可驗證的成功條件。
2. 規格核可後，在 `tasks/` 寫計畫與任務清單。列相依、順序、風險、替代方案、選擇理由與各項驗收方式。兩份文件一起送審。
3. 計畫核可後一路執行。核可範圍內的問題直接修並記進計畫。偏離前先取得同意。改設計時先更新規格，與程式一同提交。結案後把計畫與任務清單移到 `tasks/archive/`。
4. 自足的小修先說清楚驗收條件。要開發者拍板時，依[多代理指南 §1.1](docs/orca-multi-agent.md#11-徵詢-advisor)同時徵詢 2 位獨立顧問。

### 專案 skills

建立或更新 PR 時用 [pr](.agents/skills/pr/SKILL.md)。由使用者啟動的流程有 [implement-spec](.agents/skills/implement-spec/SKILL.md) 與 [retro](.agents/skills/retro/SKILL.md)。權威內容在 `.agents/skills/`，Claude Code 的同名入口在 `.claude/skills/`。

### 決策門控

§14 的界線即使已列在計畫仍適用。Git 與 CI 依 §10。

### 報告方式

階段結束時列完成範圍、驗收證據與數字、計畫偏離及剩餘問題。跨工作區回報節點見[多代理指南 §1](docs/orca-multi-agent.md#1-分工)。

## 6. 資料模型原則

- **帳本是資料隔離的核心邊界。** 每筆交易都屬於某個帳本；所有查詢都必須限定在使用者有權存取的帳本範圍內。
- **個人與家庭模式用同一套帳本模型**，靠 `Ledger.kind`（`PERSONAL` / `SHARED`）判別，不是兩張表。`kind` 建立後不可變更，且**無法從成員數推導**——共享帳本可能只剩一位成員。
- 使用者與帳本多對多，透過成員關聯表並帶**角色**（owner / editor / viewer）。
- **金額不可使用浮點數。** 用整數（最小貨幣單位）或 Prisma `Decimal`。
- **帳戶屬於使用者，不屬於帳本**；餘額由交易即時算出，不存欄位。
- **每一筆交易都要有帳戶**（3h）：付款人是別的成員時記到他的臨時帳戶。例外只有錢不經過我的帳戶、對應的是欠款的情況，見 `docs/specs/phase-3h-every-entry-has-account.md` 決策 159～162。另一個例外：帳戶主人已經退出的共享帳本（3k 決策 192）。
- 重要資料表保留 `createdAt` / `updatedAt`；交易採軟刪除（`deletedAt`）以利稽核與未來同步。

---

## 7. 程式碼與 API 規範

- TypeScript **strict**，避免 `any`；必要時用 `unknown` 再收斂。
- 命名語意完整，勿用無意義縮寫。
- **註解用繁體中文**，語氣是「導讀 + 解釋為什麼」，不是逐行複述程式。深度中等：每個檔案 / class 一段檔頭總述；只在較繞的邏輯（授權、交易、guard、DTO 信任邊界）加解釋，自明的給一行就夠。測試檔在 `describe` 上方寫這個 suite 驗證什麼、用什麼策略。
- 業務邏輯放 service，controller 只處理請求 / 回應與驗證。
- **對外輸入一律經 DTO 驗證**，絕不信任未驗證的輸入。
- 所有 schema 變更走 **Prisma migration**，不可手動改資料庫。
- 錯誤用 NestJS exception filter 與標準 HTTP 例外。訊息對使用者清楚，但**不可洩漏內部細節**（堆疊、SQL、機敏資訊）。

API 採 REST，由 NestJS 產生 OpenAPI：

- 資源用名詞複數（`/ledgers`、`/transactions`）；巢狀表達歸屬（`GET /ledgers/{ledgerId}/transactions`）。
- 狀態碼：200 / 201 / 204 成功；400 輸入錯誤；401 未認證；403 無權限；404 不存在；409 衝突。
- 列表端點支援**分頁、篩選、排序**（`?page=&limit=&from=&to=&categoryId=`）。交易量會成長，從一開始就設計好。
- 動作型操作務實處理，如 `POST /ai/parse-transaction`，不必為了純粹硬凹。
- 每個 controller 加 `@ApiTags`，DTO 完整標註型別，讓自動產生的文件正確。OpenAPI 是前後端契約。

---

## 8. 安全性（不可妥協）

- **授權檢查必做**：每個存取帳本 / 交易的端點都要驗證當前使用者對該帳本的權限。**預設拒絕（deny by default）。**
- **資料隔離**：使用者永遠不能讀寫不屬於自己帳本的資料。寫查詢時主動以帳本權限過濾。
- 密碼用強雜湊（bcrypt / argon2），絕不明文儲存或記錄。
- 機敏設定（DB 連線、JWT 密鑰、LLM API key）一律走環境變數，**禁止寫死或提交進版控**。新增環境變數同步更新 `.env.example`。
- 對外 API 套用 rate limiting，特別是認證與 AI 端點。
- 日誌**遮蔽機敏資訊**（密碼、token、API key）。

跨階段的安全基準見 `docs/specs/security-baseline.md`。

---

## 9. 測試

新增功能補測試。交易、授權及帳本隔離要有單元測試。測試位置見分層指引。需要資料庫或端對端測試時，先讀[測試環境](docs/operations/test-environment.md)。

## 10. Git / GitHub 流程

### 分支與 commit

從 `main` 開分支，禁止直接推送 `main`。用 `feature/`、`fix/`、`refactor/`、`docs/`、`test/` 或 `chore/` 前綴。每個 commit 聚焦一件事。

### Pull Request

每個工作用獨立 PR。commit 與英文 PR 標題用 Conventional Commits。PR 依 [pr](.agents/skills/pr/SKILL.md) 撰寫，連回規格章節並列對應驗證提交的結果。提交前自我審查。

### 自動化（不必逐次徵求同意）

在授權範圍內自動 commit、push、開 PR、監看 CI、修復並重推。落後 `main` 時用 `gh pr update-branch` 並等 CI 重跑。禁止用 `--admin` 繞過分支保護。全綠後 squash merge，由主工作區更新 `main`。

### CI

`.github/workflows/` 定義 PR 檢查，包含格式、lint、型別、單元測試、建置與兩套端對端測試。

## 11. Orca 工作環境

- 各獨立實作用自己的 worktree 與分支。已有合適的 worktree 就沿用。唯讀徵詢可用既有 worktree。新 worktree 先跑 `pnpm install`。禁止共用 `node_modules`。新增需複製的未版控檔案時更新 `.worktreeinclude`。建置與測試不得依賴 Orca。此專案維持 `CLAUDE.md`，不要新增 `AGENTS.md`。
- 端對端測試的共用限制見[測試環境](docs/operations/test-environment.md)。dev 部署由主工作區依[部署手冊](docs/operations/dev-deployment.md)執行。

### 多代理

- 主工作區指派任務。各區負責當地規劃、執行與驗收。先驗收 worker 成果才整合。
- 派工、規劃角色、交接或整理工作區時讀[多代理指南](docs/orca-multi-agent.md)。用 `orca skills get <名稱>` 取得操作所需的 Orca 說明。
- 接手既有工作區讀[交接入口](docs/handoff.md)與自己的交接檔。已派 worker 依 Task 指定章節與規格執行。

## 12. 程式碼檢索（codebase-memory-mcp）

工具用法由使用者層級的 SessionStart hook 注入。首次使用前查 `index_status` 並核對 HEAD。索引名為 `D-Projects-ledger-app`。過期先重建。結論以實際檔案為準。操作見[程式碼檢索](docs/README.md#程式碼檢索codebase-memory-mcp)。

## 13. 人可讀產出（HTML artifact）

Markdown 是規格、計畫與決策的唯一來源。HTML 只放 `docs/artifacts/`。禁止提交、帶入機敏資訊或主動掃描該目錄。產出前讀[HTML 產出](docs/README.md#html-產出docsartifacts)。

## 14. 界線總表

### Ask first（先說明、取得同意才做）

> commit / push / 開 PR / 合併**不在此列**，那些是自動的（見 §10）。

- 變更資料庫 schema / 資料模型。
- 變更 API 介面（並同步提醒前端 / App 受影響之處）。
- 新增相依套件。
- 修改 CI 設定或 GitHub workflows。
- 偏離已核可的 spec 或方案。
- 技術選型的替換建議（提出理由，不直接替換）。
- 破壞性或不可逆的 git 操作：`force push`、`reset --hard`、rebase 既有歷史、刪除非本次 PR 來源的遠端分支、改分支保護規則或 repo 設定。

### Never（絕不做）

- 直接 push `main`。
- 未經同意 `force push`、`reset --hard`、rebase 既有歷史、改分支保護或 repo 設定。
- 提交 `.env`、API key、密鑰等機敏資訊。
- 金額使用浮點數。
- 在前端實作業務邏輯。
- AI 解析結果未經使用者確認直接寫入帳本。
- 手動改資料庫（不走 migration）。
- 錯誤訊息或日誌洩漏內部細節。
- 把 HTML artifact 加入版控；用 HTML 取代 spec / plan / todo 的 Markdown。
- 讓 artifact 頁面帶入 `.env` 內容、DB 連線字串、`JWT_SECRET`、真實 email 或 token。
