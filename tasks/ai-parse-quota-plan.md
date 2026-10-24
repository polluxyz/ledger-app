# 4a 補充實作計畫：AI 記帳的每日額度與輸出上限

spec：`docs/specs/phase-4a-ai-quota.md`（決策 292～299、W245、SC-P18～SC-P27）。後端、畫面、e2e 合成一個 PR。

> 核可：開發者 2026-10-24 核可（含 spec §10 的 8 項）。假設 1～15 已於 2026-10-24 核可；`advisor` 4 輪意見已併入 spec 與本 plan。

## 0. 起點

- 先開 docs PR（本 spec、plan、todo、4a spec 的加註、交接檔），合進 `main`。
- 整合分支 `feature/ai-parse-quota`，從合併後的 `main` 開，用 `ai-4a` worktree，測試資料庫 `ledger_ai_test`。只有這個 session 寫這條分支。
- worker 各開自己的 worktree，從整合分支開子分支 `feature/aiq-<名>`，驗收後 merge 回整合分支。
- 角色：migration 與原子扣額度派 `backend`；provider 層派 `default`；網頁只派 Codex。模型看 `docs/orca-multi-agent.md` §0。
- **改 schema（2 張表，有 migration）**、**改 API（新錯誤碼）**、**加 3 個環境變數**。不加相依套件，不改 CI。

## 1. 元件與相依

### 1.1 協調者自己做（T0：契約與先紅的測試）

- `packages/shared/src/constants/error-codes.ts`：加 `AI_DAILY_LIMIT`，註解寫「超過每人每日的 AI 記帳解析次數（4a 額度決策 296）。429。」。跑 `pnpm --filter @ledger/shared build`。
- `apps/api/src/ai/llm-provider.ts`（介面，T1 用、T2 實作）：
  - `LlmRequest` 加 `maxOutputTokens: number`。
  - `LlmResponse` 加 `truncated: boolean`（決策 297 (b) 的統一狀態）。`usage` 的註解改成「只放驗證過的非負安全整數；不合格就不帶」。
  - `LLMProvider` 加 `readonly descriptor: { configured: boolean; provider: string; model: string | null }`。`AiService` 用 `configured` 在扣額度前判斷 `AI_NOT_CONFIGURED`，用另外兩欄寫日誌。
- `apps/api/src/ai/ai-quota.tokens.ts`（只有注入 token 與型別，讓測試能覆寫）：
  - `AI_QUOTA_LIMITS`：`{ perUserDaily: number; globalDaily: number; maxOutputTokens: number }`。
  - `AI_CLOCK`：`() => Date`。
- 為了讓 typecheck 過，T0 先把既有實作補上最少的欄位（GLM、fake、未設定的 provider 加 `descriptor`；回應帶 `truncated: false`；e2e 的 stub 加 `descriptor`）。行為不變，真正的實作在 T1、T2。
- 先紅的 e2e `apps/api/test/ai-quota-isolation.e2e-spec.ts`（`overrideProvider(AI_QUOTA_LIMITS)` 設小上限）：
  - SC-P18 第 1～3 項：第 3 次 429 `AI_DAILY_LIMIT`、provider 只被呼叫 2 次；跨帳本與換 token 合計；另一人不受影響。
  - SC-P19 第 2 項：被全站擋下時，個人次數不變。
  - SC-P21 第 1 項：403、404、400、`AI_NOT_CONFIGURED`、每分鐘限流 → 兩張表沒有變化。每條配正向對照：同一人換成合法請求 → 200，provider 被呼叫。
  - 兩張表還不存在，Prisma client 也還沒有這 2 個 model。查表一律用 `$queryRaw`，執行時才失敗，typecheck 照樣過。
  - 紅綠的分法：正向對照只斷言 200 與 provider 被呼叫，T0 就綠。次數與兩張表的斷言 T0 是預期的紅，T1 後轉綠。

### 1.2 後端 A：資料表與扣額度（T1，`backend`）

依賴 T0。

**schema 與 migration**：

- `apps/api/prisma/schema.prisma` 加 spec §3 的 2 個 model；`User` 加反向關聯 `aiParseDailyUsages AiParseDailyUsage[]`。
- migration `20261024120000_ai_parse_daily_usage`。`prisma migrate dev` 在 agent 的非互動環境不能跑（`apps/api/CLAUDE.md`），改用 `prisma migrate diff --from-schema <舊> --to-schema <新> --script` 產生 SQL。只對 `ledger_ai_test` 套用。逐行看 SQL：2 張表、主鍵、`AiParseDailyUsage.userId` 的外鍵 `ON DELETE CASCADE`。不手改資料庫。

**環境變數**（`apps/api/src/config/env.validation.ts`、根目錄 `.env.example`）：

- 3 個變數照決策 292 (a)～(c)。用 `z.preprocess` 把 `typeof v === 'string' && v.trim() === ''` 變成 `undefined`，再 `z.coerce.number().int().min().max().default()`。寫法同 `env.validation.ts:20` 的 `GLM_REASONING_EFFORT`。
- 單元測試：SC-P23 第 4 項。

**`AiQuotaService`**（新檔 `apps/api/src/ai/ai-quota.service.ts`）：

- `reserve(userId): Promise<{ day: string }>`：
  1. 用 `AI_CLOCK` 取現在，用 `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' })` 轉成 `YYYY-MM-DD`。
  2. 個人上限 0 → 丟 429 `AI_DAILY_LIMIT`；否則全站上限 0 → 丟 503 `AI_UNAVAILABLE`。不碰資料庫（決策 292 (d)）。這一步不能省：下面的 SQL 在 INSERT 那一支沒有上限條件，上限 0 時第一次呼叫會被放行。
  3. `prisma.$transaction(async (tx) => …, { isolationLevel: ReadCommitted, maxWait, timeout })` 裡依序執行 2 條帶條件的寫入，**順序固定先個人、後全站**，避免死結。`maxWait`、`timeout` 用短的固定值。不用 `Promise.all` 同時送：

     ```sql
     INSERT INTO "AiParseDailyUsage" ("userId", "day", "calls", "usageUnknownCalls", "updatedAt")
     VALUES ($userId, $day::date, 1, 1, now())
     ON CONFLICT ("userId", "day") DO UPDATE
       SET "calls" = "AiParseDailyUsage"."calls" + 1,
           "usageUnknownCalls" = "AiParseDailyUsage"."usageUnknownCalls" + 1,
           "updatedAt" = now()
       WHERE "AiParseDailyUsage"."calls" < $limit
     RETURNING "calls";
     ```

     全站列同樣寫法。用 `tx.$queryRaw` 的 tagged template 帶參數，不用 `$queryRawUnsafe`。這段 SQL 只能在第 2 步之後用，不要抽成接受任意上限的共用函式。

  4. 個人的寫入沒有回傳列 → 丟 429（資料庫交易自動取消）。全站沒有回傳列 → 丟 503，個人那次加 1 一起取消。
  5. 例外分兩種：額度不足丟 `AppException`，原樣往上。其他例外（資料庫錯誤）不原樣往上：記一行固定文字 `AI quota reserve failed`，再丟一個不帶原始例外的 `AppException(500, INTERNAL_ERROR)`（決策 294 (b)）。原因：`all-exceptions.filter.ts:50` 會把未知例外的完整 stack 寫進日誌。
- `record(userId, day, usage | null)`：`day` 用 `reserve` 回傳的值，不重新取時間。
  - 沒有 usage → 什麼都不寫（扣額度時已經把用量不明加 1）。
  - 有 usage → 同一個交易依序更新 2 列，**先個人、後全站**：token 用 SQL 加法累加，`usageUnknownCalls - 1`。不先讀再寫。
  - 失敗時記一行固定文字（`AI usage record failed`），不記例外內容，不丟例外，不重試（決策 298 (e)）。
- 單元測試：台灣日期換算（UTC 15:59:59 與 16:00:00）；上限 0 不碰資料庫。

**`AiService` 流程**（`apps/api/src/ai/ai.service.ts`）：

1. `requireLedgerAccess`（不變）。
2. `descriptor.configured` 是 `false` → 丟 `AI_NOT_CONFIGURED`。
3. `loadAiCatalog` 與預設帳戶（不變）。算清單筆數與 `promptBytes`（`Buffer.byteLength` 加總 `catalog.system`、`JSON.stringify(schema)`、句子；定義見決策 298 (h)）。
4. `quota.reserve(userId)`。被擋 → 記 `quota_user` 或 `quota_global` 的日誌，再丟出。
5. 計時，呼叫 `provider.complete`，帶 `maxOutputTokens`。
6. `truncated` → 0 筆草稿；否則照舊 `validateAiDrafts`。
7. `finally` 裡 `quota.record`，再記 1 行日誌（決策 298 (f)～(i)）。結果分類（決策 298 (g)）：
   - 結果變數的初始值是 `internal`，不是 `success`。
   - `truncated` 優先；`content` 不是物件或沒有 `drafts` 陣列 → `invalid`；0 筆 → `empty`；其他 → `success`。
   - `LlmProviderError` 用它的 `kind`；`http` 另記 provider 的 HTTP 狀態碼。
   - 其他例外 → `internal`，照舊回 500。
   - `record` 失敗不改變原本的回應（草稿或 503）。
8. `LlmProviderError` 照舊轉 503。

- 日誌用 `new Logger('AiUsage')`，一行 `key=value`，例如 `outcome=success provider=glm model=glm-5.3 durationMs=1830 promptTokens=980 completionTokens=64 drafts=2 ledgers=3 categories=27 accounts=4 promptBytes=7412`。不明的 token 寫 `unknown`。`outcome=http` 時加 `httpStatus=401` 這類數字。
- 不記 userId、帳本 id、句子、名稱、模型內容。

**controller**（`apps/api/src/ai/ai.controller.ts:19`）：OpenAPI 描述照 spec §4.1 修改，補 429、503 的 `@ApiResponse`。

**測試**：

- API e2e（新檔 `apps/api/test/ai-quota.e2e-spec.ts`）：SC-P18 第 4 項（`app.close()` 後重建）、SC-P19 第 1、3～6 項、SC-P20、SC-P21 第 2、3 項、SC-P22（覆寫 `AI_CLOCK`；第 3 項讓 stub 在回應前把時鐘推過午夜）、SC-P23 第 1～3 項、SC-P24（攔 Nest `Logger` 與 `console` 檢查不洩漏）。
- SC-P26：改 `ai-parse.e2e-spec.ts` 的 SC-P11。筆數比對排除 2 張用量表；另外斷言這 2 張表只增加數字；日誌行的欄位與分類照決策 298。
- 既有 API e2e 全綠。

### 1.3 後端 B：provider 層（T2，`default`）

依賴 T0。可以和 T1 平行。只改 provider 檔案與它們的測試，不碰 `AiService`。

- `apps/api/src/ai/glm-llm.provider.ts`：
  - 請求 body 加 `max_tokens: request.maxOutputTokens`。
  - 讀 `choices[0].finish_reason`，等於 `length` → `truncated: true`，即使 content 是完整合法的 JSON 也一樣。`false` 只代表沒有截斷訊號，不保證內容完整。
  - 先 parse 外層回應、讀 usage 與 `finish_reason`，再處理 content。content 不是 JSON 時也回 usage（決策 298 (d)）。外層不是 JSON、超過 64 KiB 時照舊丟錯，沒有 usage。
  - 64 KiB 的回應保護（`glm-llm.provider.ts:10`）保留，不因 `max_tokens` 提高而拿掉。
  - `LlmProviderError` 是 `http` 時帶 HTTP 狀態碼（數字），給日誌用。
  - `getUsage`：兩個欄位都必須 `Number.isSafeInteger` 且 ≥ 0，否則回 `undefined`。
  - `descriptor`：`{ configured: true, provider: 'glm', model }`。
- `apps/api/src/ai/llm-provider.factory.ts`：未設定的 provider 改成 `descriptor.configured = false`，`complete` 仍丟 `AI_NOT_CONFIGURED` 當保險。
- `apps/api/src/ai/fake-llm.provider.ts`：`descriptor` 是 `{ configured: true, provider: 'fake', model: null }`；加一句會回 `truncated: true` 的劇本，給 e2e 用。
- 單元測試（`glm-llm.provider.spec.ts`）：SC-P25 第 1～4 項。
- 所有測試裡的 provider stub 都補 `descriptor`。

### 1.4 畫面（T3，Codex）

依賴 T0（shared 的錯誤碼）。可以和 T1、T2 平行。

- `apps/web/src/features/ai/AiDraftInput.tsx:95` 的 `getParseErrorMessage`：在 429 的判斷之前加 `AI_DAILY_LIMIT` → 「今天的 AI 次數用完了」。
- 元件測試：`AI_DAILY_LIMIT` 顯示新訊息；`TOO_MANY_REQUESTS` 與沒有 errorCode 的 429 仍顯示「太頻繁了，等一分鐘再試。」。
- 不需要 Web e2e：只是一句錯誤訊息，元件測試已覆蓋。

### 1.5 整合、文件、PR、部署（T4，協調者）

- merge 各子分支；T0 的紅燈轉綠。
- 逐行看 migration SQL、`AiQuotaService` 的 SQL 與資料庫交易、`AiService` 的順序。
- 全部檢查：`pnpm lint / typecheck / test / build / format:check`，API e2e、兩套 Web e2e。
- 文件依 spec §9。
- PR 依模板，CI 全綠，squash merge。
- 部署 dev（主工作區）：`prisma migrate deploy`，build shared 與 API；請開發者重開 API 與 Vite、按 `Ctrl + Shift + R`。
- 用假 provider 在 dev 確認：送 1 句後兩張表各有 1 列、`calls = 1`；日誌有 1 行 `outcome=success`。
- 清掉 worker 的 worktree、分支、終端機。

### 1.6 真的模型（T5，協調者）

- 照 spec SC-P27。做法同 4a T6：暫時的 e2e（不進版控，跑完刪掉）對 `ledger_ai_test` 打真的模型。
- 10 筆消費的句子：「早餐 60、午餐 120、晚餐 200、咖啡 85、捷運 30、計程車 250、衛生紙 189、電影 320、停車 40、飲料 55」，全部現金。跑 3 次。
- 新分類 SC-P17 的 5 句各 3 次，門檻同 `phase-4a-ai-new-category.md` SC-P17。
- 4a SC-P10 的第 5、6、8 步各 3 次。
- 記錄：模型、提示詞版本（commit）、每次的草稿筆數、`truncated`、token、耗時、回應有沒有思考 token 的欄位。失敗也照記。
- 被截斷時：先把 `AI_PARSE_MAX_OUTPUT_TOKENS` 調到 4096 再跑一輪，記下結果，停下來報告，不自己改預設值。
- z.ai 只用到 2026-10-28。來不及就等換模型後跑。

## 2. 實作順序

1. docs PR 合併。
2. T0（協調者）。
3. T1、T2、T3 平行派出。
4. T4。
5. T5（10-28 前）。

## 3. 風險與對策

| 風險                                                                      | 對策                                                                                                                                                                                                     |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GLM 的 `max_tokens` 可能把思考 token 也算進去，2048 太少，10 筆句子被截斷 | SC-P27 專門驗；被截斷時照 §1.6 處理；上限是環境變數，調整不必改程式                                                                                                                                      |
| 2 條寫入的順序不一致會死結                                                | 固定先個人、後全站；SC-P19 第 3 項與 SC-P20 的併發 e2e                                                                                                                                                   |
| 全站列是熱點，所有扣額度與回寫都排隊等它                                  | 低負載假設：目前只有開發者自用。被拒絕的嘗試不受 500 次限制，上限也可調高，所以等待時間沒有驗證過。資料庫交易保持短、設 `maxWait`／`timeout`；併發 e2e 用真的資料庫。開放他人前重審，不先做 Redis 或分片 |
| raw SQL 寫錯造成注入或型別錯                                              | 只用 `$queryRaw` tagged template；`day` 明確轉 `::date`；T4 逐行看                                                                                                                                       |
| 回寫 token 失敗時錯誤訊息含參數                                           | 只記固定文字，不記例外內容（決策 298 (e)）                                                                                                                                                               |
| 扣額度時的資料庫例外經 filter 把 stack 寫進日誌                           | 在 `reserve` 邊界轉成不帶原始例外的 500（決策 294 (b)）；SC-P24 用特殊字串驗證                                                                                                                           |
| token 合計超過 `BigInt` 上限                                              | 正常用量到不了；超過時回寫失敗，照決策 298 (e)；不改 schema                                                                                                                                              |
| 多個 API 實例的設定不一致（例如滾動部署時）                               | 部署時用相同設定（決策 292 (g)）；同一天換 provider 不清計數                                                                                                                                             |
| `BigInt` 不能直接轉成 JSON                                                | 用量表不出現在任何 API 回應；測試用 `BigInt` 比對                                                                                                                                                        |
| T1 與 T2 同時改 `llm-provider.ts`                                         | 介面在 T0 由協調者先定好；T1、T2 都不改介面，要改先回報                                                                                                                                                  |
| SC-P11 改寫後漏掉「不記內容」的檢查                                       | SC-P26 保留特殊字串掃全部文字欄位與日誌；用量表只允許數字變化                                                                                                                                            |
| 扣額度後程序當掉，使用者被多扣 1 次                                       | 接受（決策 293 (c)）                                                                                                                                                                                     |
| z.ai 只用到 10-28                                                         | T5 排在 10-28 前；來不及就換模型後跑                                                                                                                                                                     |
| Codex 額度用完                                                            | 依 `docs/orca-multi-agent.md` §4 換層；網頁只等 Codex                                                                                                                                                    |

## 4. 驗證點

- T0 後：shared build 通過；API／Web typecheck 通過；`ai-quota-isolation.e2e-spec.ts` 的額度與兩張表斷言紅，正向對照（200、provider 被呼叫）綠。
- T1 後：隔離 e2e 綠；`ai-quota.e2e-spec.ts` 綠；SC-P26 綠；既有 API e2e 全綠；`prisma migrate diff` 沒有漂移。
- T2 後：SC-P25 單元測試綠；`ai-parse.e2e-spec.ts` 全綠。
- T3 後：W245 元件測試綠；Web 檢查全綠。
- T4 後：CI 全綠；dev 兩張表與日誌照預期。
- T5 後：SC-P27 的表填完。

## 5. 要開發者決定的事

見 spec §10。

## 6. 派工

| 任務 | worktree／分支                         | 角色      | 依賴       |
| ---- | -------------------------------------- | --------- | ---------- |
| T0   | `ai-4a`／`feature/ai-parse-quota`      | 協調者    | docs PR    |
| T1   | `aiq-api`／`feature/aiq-api`           | `backend` | T0         |
| T2   | `aiq-provider`／`feature/aiq-provider` | `default` | T0         |
| T3   | `aiq-web`／`feature/aiq-web`           | Codex     | T0         |
| T4   | `ai-4a`                                | 協調者    | T1、T2、T3 |
| T5   | `ai-4a`（`ledger_ai_test`）            | 協調者    | T4         |

## 7. 實作紀錄

### T0～T3（2026-10-24）

| 任務 | commit                                | 誰做               | 協調者重跑的結果                                                   |
| ---- | ------------------------------------- | ------------------ | ------------------------------------------------------------------ |
| T0   | `65338fc`                             | 協調者             | 隔離 e2e：額度與兩張表的斷言紅，正向對照綠                         |
| T3   | `ff77613`（ff 合併）                  | Codex（`default`） | Web lint、typecheck、test 全綠                                     |
| T2   | `9f102a0`（合併 `d898a00`）           | Codex（`default`） | API lint／typecheck 過；單元 863/863；`ai-parse.e2e-spec.ts` 43/43 |
| T1   | `b0406a9`（合併 `bd1c082`，沒有衝突） | Codex（`backend`） | 見下方「整合後」                                                   |

- T1 改了 `ai.controller.ts`，只加 429／503 的 OpenAPI 標註，路由、DTO、guard、回應格式都沒動。§1.2 本來就列了 controller，所以不算偏離。
- SC-P24 第 2 項「原本是 503 就仍回 503」：正常的 503 不會帶 usage，回寫只會收到 `null`。所以用故障注入（讓回寫的資料庫交易拋錯）驗證 503 仍是 503，另外斷言正常 503 時 `record` 收到 `null`、token 欄位不變。
- 這次的 schema 變更（2 張表）在核可 spec 與 plan 時已一併核可，沒有另外再提。
- `ai.module.ts` 讀上限時多了 `?? 50` 這類預設值。環境變數驗證已經保證有值，所以這幾個預設值不會生效，無害，沒有改。

### 整合後（`bd1c082`）

- `pnpm --filter @ledger/shared build`、`prisma generate` 後：format:check、lint、typecheck 全過。
- 單元：shared 126、API 56 suites 877、Web 122 files 1008，全綠。
- API e2e 56 suites 589/589。migration 已套用到 `ledger_ai_test`，`prisma migrate diff`（資料庫對 schema）沒有差異。

### T4 兩軸審查

implement-spec 要求由沒有實作的 reviewer 看兩軸：A 專案規範、B spec 的漏做／做錯／超出範圍。兩位都只讀，範圍是 `5520dd3..bd1c082`。

| reviewer                          | 範圍       | 軸 A                    | 軸 B                                                                                                                              |
| --------------------------------- | ---------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| R1（`default`，gpt-6-luna max）   | T1         | 通過                    | 中 1 項：`env.validation.spec.ts` 只驗 0，沒驗 255；下限誤寫成 1 也會綠                                                           |
| R2（`backend`，gpt-6.1-sol high） | T0、T2、T3 | 中 1 項（與 B1 同一件） | 中 2 項：B1 隔離 e2e 的「Eve 不影響 Bob」只比 `calls`，回寫寫錯人仍會綠；B2 GLM 測試只用 2048，實作寫死 `max_tokens: 2048` 也會綠 |

3 項都是「成功條件沒有真的測到」，實作本身沒有錯。協調者自己補測試，每項都做了突變檢查（故意改壞實作，確認新測試變紅，再還原）：

| 發現 | 修正 commit | 突變                                    | 結果                             |
| ---- | ----------- | --------------------------------------- | -------------------------------- |
| B1   | `ef409b0`   | 回寫的 `WHERE` 拿掉 `userId` 條件       | 新斷言抓到 Bob 的 token 欄位被改 |
| B2   | `ef409b0`   | `max_tokens` 寫死 2048                  | 256、3072、4096 三個案例紅       |
| R1   | `474fcb7`   | `AI_PARSE_MAX_OUTPUT_TOKENS` 下限改成 1 | 1 個測試紅                       |

B1 的修正同時補上：Eve 的回應只有 `{ drafts: [] }`；body 帶 `userId` 會被 DTO 擋下（400）；Eve 自己用滿 2 次後第 3 次才被擋。

### 修正後（`474fcb7`）

- 修正涉及的 3 個檔：GLM spec 34/34、隔離 e2e 14/14、env spec 12/12。
- format:check、lint、typecheck 全過；單元 shared 126、API 56 suites 880、Web 122 files 1008，全綠。
- Web e2e（Playwright，先 build shared 與 API）：92 passed。
