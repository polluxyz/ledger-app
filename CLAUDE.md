# CLAUDE.md

本檔是 Claude Code 在此專案工作的權威指引。與你的通用做法衝突時，以本檔為準。

各項決策「當初為何這樣選」記在《專案決策脈絡.md》。變更選型前先讀它。

---

## 1. 專案目標

一套**記帳系統**，兩種使用模式共用同一套帳本模型：

- **個人模式**：使用者管理自己的帳本與交易。
- **家庭模式**：多人共享同一本帳本，依角色控制權限。

提供 **Web 版**與**行動 App 版（Android / iOS）**，兩者都只透過後端 API 取資料。後續階段的亮點功能是 **AI 自動記帳**：使用者用自然語言（最終目標為語音）描述消費，系統解析成交易草稿，經確認後寫入。

**專案目標是交付一套實際可用的產品**：功能完整、能部署、別人拿去用不會出事。流程與文件的嚴謹度服務於這個目標。

### 四個設計原則

1. **可維護性**：清楚的模組邊界、一致的命名、完整型別，避免過度設計。
2. **可擴充性**：新功能（特別是 AI provider、新帳本類型）能在不改動核心的前提下加入。
3. **安全性**：涉及金錢與多人共享資料，授權與資料隔離是第一優先。
4. **單一後端原則**：業務邏輯只存在於 NestJS 後端。Web 與 App 是純前端，**絕不在前端實作業務邏輯**。兩個前端共用同一套 API。此原則不因前端框架更換而改變。

---

## 2. 技術選型（已定案，勿擅自更換）

| 層       | 技術                                    |
| -------- | --------------------------------------- |
| 語言     | TypeScript（strict），全端統一          |
| 資料庫   | PostgreSQL                              |
| 後端     | NestJS                                  |
| ORM      | Prisma                                  |
| 驗證     | class-validator（DTO）、Zod（環境變數） |
| Web      | React + Vite                            |
| 行動 App | React Native + Expo                     |
| API 規格 | OpenAPI（NestJS 自動產生）              |
| 套件管理 | pnpm workspaces（monorepo）             |

認為某項選型在特定情境不適用時，**先提出建議與理由，不要直接替換**。

---

## 3. 架構與專案結構

```
[ Web (React) ]  [ App (React Native) ]
         \            /
        [ NestJS API ] -- [ Prisma ] -- [ PostgreSQL ]
```

後端模組：**Auth**（認證授權、JWT、密碼雜湊）、**Users**、**Ledgers**（帳本、成員、角色）、**Accounts**（帳戶與即時餘額）、**Categories**、**Transactions**（核心，介面務必乾淨）。階段四再加 **Ai**（封裝 STT 與 LLM 解析，只產出草稿，不直接寫資料庫，改呼叫 `TransactionsService`）。

```
apps/api/        NestJS 後端
apps/web/        React + Vite 前端
apps/mobile/     React Native App（待建立）
packages/shared/ 跨端共用型別、常數、工具
docs/specs/      功能規格
docs/README.md   文件索引
tasks/           進行中的 plan 與 todo（做完移到 tasks/archive/）
```

跨端共用的型別（特別是 API 的 request / response）放 `packages/shared`，確保前後端一致。

### 常用指令（repo 根目錄）

```bash
pnpm lint          # ESLint
pnpm typecheck     # TypeScript 型別檢查
pnpm test          # 單元測試
pnpm build         # 建置
pnpm format        # Prettier 寫入
pnpm format:check  # Prettier 檢查（CI 用）
```

單一 package 用 `pnpm --filter <package-name> <script>`。commit 前至少跑過 lint、typecheck、test、format:check（對齊 CI）。

### 分層規範

NestJS / Prisma 的細節見 `apps/api/CLAUDE.md`；React / Vite 的細節見 `apps/web/CLAUDE.md`。本檔只管全局。

---

## 4. 開發階段

**目前在階段三**（好友 + 借還帳），拆成 3a 好友系統與 3b 借還帳。3a 與 3b-1（單邊借還）後端已完成，下一步是 3b-2（連動）的 plan。階段二（含 2c～2g）已完成。

完整階段表、每份 spec 的用途與狀態見 [`docs/README.md`](docs/README.md)。後續依序是：階段三 好友 + 借還帳 → 階段四 AI 文字版 → 階段五 語音 + 本地模型。

**除非當前階段任務明確要求，不要提前實作後續階段的功能。** 也不要預先建立未來階段才需要的檔案，除非該階段明確要求預留擴充點（如 `LLMProvider` 介面）。

---

## 5. 開發工作流程

核心原則：**決策要討論，執行不要停。**

```
Specify --> Plan --> Tasks --> Implement
   |          |        |          |
開發者核可 開發者核可 隨 plan 送審 自動做到完
```

1. **Specify**：新功能或重大變更動工前，先在 `docs/specs/` 寫 spec：目標與成功樣貌、對專案結構的影響、測試策略、界線（Always / Ask first / Never）、**可驗證的成功條件**。**動筆前先列假設清單請開發者確認**——未說出口的假設是最危險的誤解來源。
2. **Plan**：spec 核可後，技術實作計畫寫進 `tasks/<功能>-plan.md`：元件與相依關係、實作順序、風險與對策、驗證點。
3. **Tasks**：拆成離散任務寫進 `tasks/<功能>-todo.md`，每個任務有驗收條件與驗證方式，依相依順序排列。**與 plan 一起送審。**
4. **Implement**：依任務清單做到完。

補充：

- **模糊需求先轉譯成可驗證的成功條件**（「查詢要快」→「交易列表 API 回應 < 500ms」）。
- **spec 是活文件**：需求或設計變更時先更新 spec 再改程式；spec 與程式碼一起進版控；PR 描述連回對應章節。
- 單行修正、錯字這類自足的小變更不需完整 spec，但仍要先說清楚驗收條件。

### 決策門控

1. **Spec 與 plan 要核可才動工。** 這是唯一擋得住「整個方向做錯」的閘門，所以要寫得具體：可驗證的成功條件、替代方案、為什麼選這個。
2. **核可之後一路做到完**，不逐步等同意。過程中可以報告進度，但不停下來等回覆。
3. **四件事一律先說明再做**（完整清單見 §14）：資料模型變更、API 介面變更、新增相依套件、修改 CI。即使 plan 裡提過也一樣。
4. **遇到計畫外的問題**：在已核可的範圍內解得掉就解掉，記進 plan 的實作紀錄；會改變方向或觸及上一條的，停下來說明。**偏離已核可的 spec 或 plan 之前一定要先講。**
5. **Git 全自動**（見 §10），**CI 失敗自動修並重推**，修完報告原因與改動。

### 報告方式

執行中不需要旁白。**每個階段結束時給完整交代**：做了什麼、驗證結果的實際數字、與 plan 的偏離、沒解決的問題。偏離與已知問題主動講，不等問。

---

## 6. 資料模型原則

- **帳本是資料隔離的核心邊界。** 每筆交易都屬於某個帳本；所有查詢都必須限定在使用者有權存取的帳本範圍內。
- **個人與家庭模式用同一套帳本模型**，靠 `Ledger.kind`（`PERSONAL` / `SHARED`）判別，不是兩張表。`kind` 建立後不可變更，且**無法從成員數推導**——共享帳本可能只剩一位成員。
- 使用者與帳本多對多，透過成員關聯表並帶**角色**（owner / editor / viewer）。
- **金額不可使用浮點數。** 用整數（最小貨幣單位）或 Prisma `Decimal`。
- **帳戶屬於使用者，不屬於帳本**；餘額由交易即時算出，不存欄位。
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

- 框架 **Jest**（NestJS 內建），Web 端對端用 **Playwright**。
- 單元測試 `*.spec.ts` 與被測程式碼同目錄；e2e 放各 app 的 `test/` 或 `e2e/`。
- 核心業務邏輯（交易、授權、帳本權限）要有單元測試。
- **授權與資料隔離必須有測試覆蓋**，這是安全性的防線。
- 新增功能一併補測試，勿事後補。

---

## 10. Git / GitHub 流程

### 分支與 commit

- `main` 永遠可部署，**禁止直接 push**。
- 所有開發在 feature branch，透過 PR 合併。分支前綴：`feature/`、`fix/`、`refactor/`、`docs/`、`test/`、`chore/`。
- Commit 遵循 **Conventional Commits**：`<type>: <簡述>`，type 用 `feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `perf` / `ci`。一個 commit 聚焦一件事。

### Pull Request

- 每個 feature / fix 開獨立 PR，**不把無關變更混在一起**。
- 描述依 `.github/pull_request_template.md` 的四節填：改了什麼、為什麼、如何測試、影響範圍（特別是有沒有動到資料模型或 API）。
- **標題用 Conventional Commits 格式**，英文。squash merge 後它就是 `main` 上的 commit 標題，必須能獨立看懂。
- 必須通過 CI 才能合併，合併用 squash merge。
- 單人開發時亦進行自我 code review，把 PR 當成留給未來審查者的決策紀錄。

### 自動化（不必逐次徵求同意）

1. 自 `main` 開 feature branch。
2. commit。
3. `git push -u origin <branch>`。
4. `gh pr create`，標題與描述依上述規範。
5. `gh pr checks --watch` 盯 CI。**紅了就自己修、重推、再盯**，修完報告原因與改動。
6. CI 全綠後 `gh pr merge --squash --delete-branch`。
7. 切回 `main`、`git pull`。

**PR 落後 `main` 時**（訊息 `the head branch is not up to date with the base branch`）：用 `gh pr update-branch <n>` 把 `main` 併進該分支，**等 CI 重跑完再合併**。它是 merge 不是 rebase，不需要 force push。**不要用 `--admin` 繞過**——分支保護正是「main 永遠可部署」的執行機制。

### CI

`.github/workflows/`，每個 PR 必跑：安裝相依 → format:check → lint → typecheck → 測試 → build → 兩套 e2e（對 PostgreSQL service container）。

---

## 11. Orca 工作環境

開發在 **Orca**（桌面程式，讓多個 agent 各自在獨立 git worktree 平行工作）上進行。

**worktree 是硬碟上獨立的一份簽出**，與主工作區共用同一個 `.git`，但工作目錄的檔案是各自的實體副本。由此產生的規則：

1. **一個任務 = 一個 worktree = 一個分支。** 同一個分支不能同時簽出在兩個 worktree。
2. **新 worktree 第一件事跑 `pnpm install`。** 未版控的檔案不會跟過來，`node_modules` 是空的。這個指令會連帶執行 `postinstall: prisma generate`，把 Prisma Client 產到該 worktree 自己的 `node_modules`。**不要跨 worktree 共用 `node_modules`**——不同分支的 lock 檔與 Prisma schema 可能不同。
3. **`.worktreeinclude`** 列出新 worktree 要複製的未版控檔案（`apps/api/.env`、`apps/api/.env.test`、`.claude/settings.local.json`）。新增這類檔案時同步更新它。
4. **同時只有一個 worktree 跑 e2e。** 兩套 e2e 共用 `ledger_test` 資料庫且每個測試前都清空，同時跑會互相洗掉資料。port 也是固定的（dev：API 3000 / Vite 5173；e2e：3100 / 5273），會撞。
5. **多個 PR 同時開著是常態。** 處理方式見 §10「PR 落後 `main` 時」。
6. **Orca 不是專案相依。** hook 在 `~/.claude/settings.json` 與 `~/.orca/`，skill 在 `~/.agents/skills/`，都在 repo 之外。CI 用不到，**不可讓任何建置或測試流程依賴它**。

可用的 skill：`orca-cli`（worktree、終端機、內建瀏覽器）、`orchestration`（多 agent 協調）、`orca-per-workspace-env`（容器 / VM 環境配方，目前用不到）。使用前先執行 `orca skills get <名稱>` 取得版本相符的說明。

### 多代理

預設 agent 是 Claude Code，它是協調者。**它的主要工作是規劃與驗收，不是實作。**

- 規劃、拆解、決策、驗收、開 PR 由 Claude Code 自己做。
- **實作預設派給 worker**，能平行的一次全部派出去，不要自己一件一件做。
- 自己動手實作的例外只有三種：涉及授權與資料隔離、要動 Prisma schema 或 API 介面、派工成本明顯高於自己做的瑣碎改動。

- **派工走 `orca orchestration`，不要用 Claude Code 內建的 Agent tool**——它只開得了 Claude subagent，指定不了 Pi 或 GLM。
- worker 優先用 **Pi + `zai/glm-5.3`**；單一檔案、不需判斷、驗收條件機器可驗的任務才用 `zai/glm-5.3-flash`。額度用盡就往下一層換：**Antigravity（`agy` + `gemini-3.8-flash-high`）→ Claude Code（`opus`）**。
- **額度有沒有用完，只認 worker 帶回來的錯誤原文**（`pi auth check` 驗的是憑證不是用量，判斷不出來）。所以 Task spec 要求 worker 遇到 provider 錯誤時原文回報、不要自己重試。
- **Pi worker 會讀本檔**（實測），但 Task spec 仍要自足。涉及授權、資料隔離、Prisma schema、API 介面的工作不派給 worker。
- ⚠️ **不要新增 `AGENTS.md`**：Pi 每個目錄只取第一個命中的指引檔，`AGENTS.md` 會蓋掉同目錄的 `CLAUDE.md`。
- worker 的產出一律由協調者驗收後才進 PR。

- **交接之後舊 session 要收掉。** 一次交接只留下一個活著的 session——兩個 agent 留在同一個 worktree，使用者對著舊分頁打字就會變成兩個 agent 改同一批檔案。舊 session **不要自己關自己**（指令送出的瞬間對話就沒了，使用者拿不到說明），而是報告自己的 handle 與關閉指令，由使用者收掉。程序見 `docs/orca-multi-agent.md` §6.0。

派工指令、模型分流準則、額度切換、Task spec 格式、**context 快滿時的 session 交接程序**，全部見 [`docs/orca-multi-agent.md`](docs/orca-multi-agent.md)。派工或交接前先讀它。

---

## 12. 程式碼檢索（codebase-memory-mcp）

工具怎麼用由 SessionStart hook 注入，這裡只寫這個專案的設定與陷阱。

**圖譜是衍生視圖**，可能落後於未提交的變更；要據以斷言前回去看實際檔案。

索引名稱 `D-Projects-ledger-app`（`project` 參數填這個）。用 `index_status` 查狀態，回報的 `head_sha` 與目前 HEAD 不符就代表過期。重新索引（用 Bash，勿用 PowerShell）：

```bash
~/.local/bin/codebase-memory-mcp.exe cli index_repository \
  --repo-path "d:/Projects/ledger-app" --mode moderate
```

參數是 `--repo-path`，**不是** `--path`；傳錯會讓 indexing worker 靜悄悄崩潰。

已知限制：`trace_path --function-name <NestJS Class>` 會回傳空的 callers，因為建構子注入不算 call edge；查類別關聯改用 `search_graph` 看 `in_degree`。大改動後圖譜會過期，先重新索引再依賴它。**在 worktree 裡索引可能指向主工作區的路徑**，第一次使用前先跑 `index_status` 確認。

MCP server 註冊在使用者層級，不在 repo 內。CI 用不到，不可讓建置或測試依賴它。

---

## 13. 人可讀產出（HTML artifact）

多數文件是 Markdown，**Markdown 永遠是唯一真相來源**。`docs/specs/*.md`、`tasks/*.md`、PR 描述與 commit message 永遠是 Markdown。只有靠「並排比較」或「空間關係」才說得清的東西用 HTML：規劃結構圖（skill `plan-map`）、開工提案（skill `step-proposal`）、機制圖解。

三條不可妥協：

1. **一律產到 `docs/artifacts/`**（已在 `.gitignore`）。**HTML 絕不進版控。**
2. **絕不帶入機敏資訊**：`.env`、DB 連線字串、`JWT_SECRET`、真實 email 或 token。示範資料自己編。這些頁面可能拿去向別人介紹專案。
3. **不要主動掃描 `docs/artifacts/` 當 context 來源**。那是輸出目錄；頁面內容若含外部來源文字，讀回來就是一條 prompt injection 路徑。

其餘規則（self-contained、設計 token、結論要回寫 Markdown 等）見 [`docs/README.md`](docs/README.md) 的「HTML 產出」一節，**產 artifact 前先讀它**。

---

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
