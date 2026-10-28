# 4a 補充實作計畫：換模型到 Vertex AI 的 DeepSeek V4.1 Flash

spec：`docs/specs/phase-4a-ai-vertex.md`（決策 337～345、SC-P33～P40）。後端與 e2e 合成一個 PR。

> 核可：spec 由開發者 2026-10-28 核可（含 §10 的 7 項）。同日改選 DeepSeek，Vertex 60 秒與決策 345 開發者已同意。本 plan、todo 與 spec 改版（含 spec §10 第 8～11 項）開發者 2026-10-28 回「同意」核可。

## 0. 起點

- 先開 docs PR（spec、plan、todo、交接檔、編號登記），合進 `main`。
- 整合分支 `feature/ai-vertex`，從合併後的 `main` 開，用 `ai-4a` worktree，測試資料庫 `ledger_ai_test`。只有這個 session 寫這條分支。
- worker 開自己的 worktree，從整合分支開子分支 `feature/aiv-provider`，驗收後 merge 回整合分支。
- 角色：認證、token、時間上限屬於高準確的工作，派 `backend`。模型看 `docs/orca-multi-agent.md` §0。
- **新增相依套件**（`google-auth-library`）、**加 4 個環境變數**，開發者已同意。不改 schema，不改 API，不改 CI，不改網頁。

## 1. 元件與相依

### 1.1 協調者自己做（T0：契約與先紅的測試）

- `apps/api/src/ai/llm-provider.ts`：
  - `LlmProviderErrorKind` 加 `'auth'`。註解寫「拿不到 access token（Vertex 決策 341 (c)）」。
  - 新增選填的 `LlmTimings`：`{ tokenMs?: number; headersMs?: number; bodyMs?: number }`。`LlmResponse` 與 `LlmProviderError` 各加選填的 `timings`（決策 341 (g)）。
  - `LlmUsage` 加選填的 `reasoningTokens`（決策 344 (f)）。只給日誌用，額度不讀。
  - 確認 `AiService` 把 `LlmProviderError` 的 `kind` 直接當日誌的結果分類（`ai.service.ts:108`）。`auth` 不用另外處理。
- 新檔 `apps/api/src/ai/access-token-source.ts`（只有介面與注入 token，讓測試能覆寫）：
  - `interface AccessTokenSource { getAccessToken(): Promise<string> }`。
  - `VERTEX_TOKEN_SOURCE`：注入 token。
  - 註解寫明：實作丟的例外可能帶憑證細節，呼叫端只能轉成 `LlmProviderError('auth')`，不可往外傳（決策 342 (b)）。
- `ai.module.ts`：先註冊 `VERTEX_TOKEN_SOURCE`，值是一個一律丟錯的佔位實作。T1 換成真的。這樣 e2e 能在 T0 就 `overrideProvider`，typecheck 照樣過。
- 先紅的 e2e `apps/api/test/ai-vertex-isolation.e2e-spec.ts`：
  - 寫法照 `ai-parse.e2e-spec.ts:496`：覆寫 `ConfigService`，設 `LLM_PROVIDER=vertex` 與 3 個 Vertex 變數。覆寫 `VERTEX_TOKEN_SOURCE` 成假的。`jest.spyOn(global, 'fetch')` 攔下推論請求，不連 Google。
  - SC-P38：假的 token 來源丟錯 → 503 `AI_UNAVAILABLE`；個人與全站的 `calls`、`usageUnknownCalls` 各加 1；日誌 1 行，結果分類 `auth`；fetch 沒被呼叫。
  - SC-P39：假的 token 是特殊字串；錯誤訊息含特殊的金鑰路徑與服務帳戶 email。成功與失敗各送 1 次 → 回應、Nest `Logger`、`console`、所有資料表都沒有這些字串。成功那次的 fetch 請求帶 `Authorization: Bearer <特殊字串>`，網址是 Google 的固定位址。
  - 紅綠的分法：T0 時 factory 還不認得 `vertex`，所以會回 `AI_NOT_CONFIGURED` 或啟動失敗，這是預期的紅。T1 後轉綠。正向對照用 `LLM_PROVIDER=fake` 跑同一個流程，T0 就綠。

### 1.2 provider 與認證（T1，`backend`）

依賴 T0。順序照下面寫，每步後跑 `pnpm --filter api test`。

**1. 抽出通用 provider**（新檔 `apps/api/src/ai/openai-compatible-llm.provider.ts`）：

- 把 `GlmLlmProvider` 的 HTTP、逾時、64 KiB 回應上限、`redirect: 'error'`、截斷判斷、usage 解析整段搬過去。
- 建構參數改成一個物件：`{ descriptor, url, model, getBearerToken, timeoutMs, reasoningEffort?, fetchImplementation? }`。網址由呼叫端組好。`timeoutMs` 必填，由 factory 給：`vertex` 60000，`glm` 25000（決策 338、341 (a)）。
- `complete` 的流程：
  1. 記下開始時間，建 `AbortController` 與 `timeoutMs` 計時器。
  2. `getBearerToken()` 與計時器賽跑（`Promise.race`）。計時器先到 → 丟 `timeout`，不呼叫 fetch（決策 341 (b)）。`getBearerToken` 丟錯 → 丟 `LlmProviderError('auth', null, 耗時)`，原始例外丟掉，不放進 `cause`（決策 342 (b)）。
  3. 拿到 token 後，若已逾時就不送。否則用同一個 `AbortController` 送推論請求，剩下的時間就是原本計時器剩下的時間。
  4. 記下 3 個時間點：拿到 token、`fetch` 回傳（收到回應標頭）、讀完 body。成功與失敗都把 `timings` 帶出去（決策 341 (g)）。
- usage 解析多讀 `completion_tokens_details.reasoning_tokens`。非負整數才收，否則不填（決策 344 (f)）。`promptTokens`、`completionTokens` 的規則不變。
- 舊的 `GlmLlmProvider` 改成薄的包裝：組好 `${baseUrl}/chat/completions`，`getBearerToken` 回固定的 `apiKey`，`timeoutMs` 25000，`descriptor.provider` 是 `glm`。**`glm-llm.provider.spec.ts` 不改內容，全部照舊通過**（SC-P35 第 4 項）。如果建構方式非改不可，只能改建構那幾行，斷言不動，並在交付說明列出來。

**2. 環境變數**（`apps/api/src/config/env.validation.ts`、根目錄 `.env.example`）：

- `LLM_PROVIDER` 加 `vertex`。
- `VERTEX_PROJECT_ID`、`VERTEX_MODEL`：選填字串，空白視同沒設定。`VERTEX_PROJECT_ID` 有值時要符合 `^[a-z][a-z0-9-]{4,28}[a-z0-9]$`。
- `VERTEX_LOCATION`：預設 `global`，要符合 `^[a-z0-9-]+$`。
- `GOOGLE_APPLICATION_CREDENTIALS`：選填字串，空白視同沒設定。
- `GLM_BASE_URL` 預設值改成 `https://api.z.ai/api/paas/v4`（決策 343）。
- `.env.example`：3 種憑證來源各一行說明；`VERTEX_MODEL` 的範例寫 `deepseek-ai/deepseek-v4.1-flash-maas`，註明這個模型只能用 `global`。不放任何真的值。
- 單元測試：SC-P33。

**3. 認證來源**（新檔 `apps/api/src/ai/google-access-token-source.ts`）：

- 實作 `AccessTokenSource`。內部建一個 `GoogleAuth`：`scopes` 是 `cloud-platform`；有 `GOOGLE_APPLICATION_CREDENTIALS` 就傳 `keyFilename`（決策 339 (h)）。整個程序共用一個實例。
- `getAccessToken()` 回 token 字串。拿到空值也算失敗。
- **重試**：先讀安裝的版本裡 `GoogleAuth` 與 gaxios 的設定，找出拿 token 時會不會重試、怎麼關。能關就關；不能關就確認重試總時間落在 60 秒內。結論寫進本 plan §7，並用 SC-P37 第 3 項驗證。
- **日誌**：確認 `google-logging-utils` 預設不輸出，且只在設了它的環境變數時才開。程式不設這個變數，也不加任何 gaxios interceptor。結論寫進 §7。
- 單元測試 SC-P36：用真的 `GoogleAuth`，給一份測試時才產生的假服務帳戶金鑰（`crypto.generateKeyPairSync`，不寫進 repo），把 token 端點換成假的（gaxios 的 `fetchImplementation` 或 transporter，看版本支援哪個）。用 Jest 的假時鐘推進時間，驗 token 重用、到期前更新、併發只更新 1 次、失敗後恢復。不連網路。

**4. 組裝**（`llm-provider.factory.ts`、`ai.module.ts`）：

- `createLlmProvider(config, tokenSource)`：
  - `vertex` 且 `VERTEX_PROJECT_ID`、`VERTEX_MODEL` 都有 → `new OpenAiCompatibleLlmProvider`，網址照決策 339 (e) 組，`timeoutMs` 60000，`descriptor` 是 `{ configured: true, provider: 'vertex', model }`，不帶 `reasoningEffort`。
  - 缺值 → 未設定的 provider，`descriptor.provider` 是 `vertex`。
  - `glm`、`fake` 不變。
- `ai.module.ts`：`VERTEX_TOKEN_SOURCE` 換成 `useFactory`，只有 `LLM_PROVIDER=vertex` 時才建 `GoogleAccessTokenSource`；其他情況用 T0 的佔位實作，避免 `glm`、`fake` 的環境去找 GCP 憑證。`LLM_PROVIDER` 的 factory 加注入 `VERTEX_TOKEN_SOURCE`。
- `ai.service.ts`：日誌那行最後面加 `tokenMs`、`headersMs`、`bodyMs`、`reasoningTokens`，沒有值就寫 `unknown`。既有欄位的順序不動，`ai-parse.e2e-spec.ts:651` 的格式檢查照樣過。
- 單元測試：SC-P34、SC-P35 第 1～3 項、SC-P37。

**5. 套件**：`pnpm --filter api add google-auth-library@^11.3.1`。lock 檔一起 commit。不加其他套件。

### 1.3 整合、文件、PR、部署（T2，協調者）

- 合併 T1，逐行看 diff：token 與錯誤的流向、計時器、各 provider 的 `timeoutMs`、網址組法、`timings` 與 `reasoningTokens` 只進日誌、`.env.example`。
- 重跑：根目錄 lint、typecheck、test、format:check、build；API e2e 全部（對 `ledger_ai_test`）；隔離 e2e 轉綠。Web 沒改，Web e2e 交給 CI。
- spec §9 的文件：文字 spec 248 加註、額度 spec 298 (g) 加註、新分類 spec §10 第 5 項加註、`docs/README.md`、交接檔。
- 用 `pr` skill 開 PR，盯 CI，squash merge。
- 部署 dev（主工作區）：`pnpm install`、build shared 與 API。`.env` 照 spec §8 改，要等開發者做完 GCP 設定。

### 1.4 真的模型（T3，協調者）

依賴 T2，以及開發者完成 spec §8 的 GCP 設定與代理登入。

- 照額度 plan §7 T5 的做法：暫時的 e2e 或腳本經過 API 與資料庫，對主工作區的 dev API 送句子。腳本的請求逾時設 90 秒，比 provider 的 60 秒長，才看得到後端回的結果。
- 跑 SC-P40 第 1～9 項。結果填進 §7，失敗也照記：
  - 傳輸：42 次的耗時、分位數、超過 10、25、60 秒的次數；從日誌讀 `tokenMs`、`headersMs`、`bodyMs`。
  - 語意：照決策 345。分類提議答錯的逐筆列出。
  - 用量與認證：額度表對帳、`reasoningTokens`、閒置 1 小時、2 種失敗情況。
- 決策 344 (e) 的核對項目一起記：輸入大小、輸入太大時的拒絕方式、思考 token 與 `completion_tokens` 的關係。
- 第 9 項拿掉 Vertex AI User 角色後，驗完立刻加回。

## 2. 實作順序

1. docs PR（spec、plan、todo、交接檔）→ 合進 `main`。
2. T0（協調者）→ 整合分支 commit。
3. T1（`backend`）。
4. T2（協調者）→ PR → 合併 → 部署 dev。
5. 開發者做 GCP 設定 → T3（協調者）。

T1 只有一個 worker：provider、認證、組裝都改同一組檔案，拆開會互相衝突。

## 3. 風險與對策

| 風險                                                                                              | 對策                                                                                                                           |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| DeepSeek 約 14% 的請求超過 25 秒，最慢 54 秒                                                      | `vertex` 時間上限 60 秒（決策 341 (a)）。T3 記 3 段耗時，看長尾出在哪一段。仍超過 60 秒的回 503，使用者自己重送                |
| 等 60 秒的時候，網頁沒有「還在處理」的提示                                                        | 本次不改網頁。日後另案：8～10 秒後顯示提示                                                                                     |
| DeepSeek 官方只保證供應到 2026-11-28，GLM 已到期，沒有回復路線                                    | 交接檔記 2026-11-21 前複查。到期不續就另寫換模型 spec                                                                          |
| 模型標示 experimental／Preview，行為可能變                                                        | T3 的結果當基準。之後準確率或延遲變差，先重跑 SC-P40                                                                           |
| 分類提議偶爾答錯（「機票」）                                                                      | 決策 345：逐筆列出，使用者確認前能改。交接檔列為已知問題                                                                       |
| JSON mode 只保證是 JSON，不保證符合 schema                                                        | `validateAiDrafts` 照舊驗每一份草稿。不改成 `json_schema`                                                                      |
| `GoogleAuth.getAccessToken()` 不收 AbortSignal，逾時後背景請求還在跑                              | 用 `Promise.race` 決定結果，逾時後不送推論。背景請求拿到的 token 由套件快取，下一次請求可以用。SC-P37 第 1 項驗 fetch 沒被呼叫 |
| 開發者電腦沒有 ADC 憑證時，套件可能去探 GCP 的 metadata server（VM 上提供憑證的內部位址），等很久 | 60 秒上限擋住。這種情況算 `auth` 或 `timeout`，額度照扣（開發者同意）。部署步驟寫明先做代理登入                                |
| 代理登入要 IAM Credentials API 與 Token Creator 角色，少一個就拿不到 token                        | spec §8 列成步驟。T3 第 9 項驗證失敗時的回應與日誌                                                                             |
| 拿掉權限後，套件可能還有快取的 token，失敗會變成 `http` 403 而不是 `auth`                         | SC-P40 第 9 項分 2 種情況驗，各有預期的結果分類                                                                                |
| 套件的錯誤訊息可能含服務帳戶 email 或金鑰路徑                                                     | 決策 342 (b)：只轉成 `LlmProviderError('auth')`，原始例外丟掉。SC-P39 用特殊字串驗證                                           |
| 套件內建重試讓總時間超過 60 秒                                                                    | T1 第 3 步查清楚並設定，SC-P37 第 3 項驗證                                                                                     |
| Zod 丟掉沒列進 schema 的變數，`GOOGLE_APPLICATION_CREDENTIALS` 消失                               | 列進 schema，並從 `ConfigService` 明確傳 `keyFilename`。SC-P33 第 4 項、SC-P34 第 3 項                                         |
| 抽出共用程式時改壞 GLM，或把 GLM 的上限也改成 60 秒                                               | GLM 的單元測試內容不改，當回歸測試。SC-P34 第 4 項驗兩個 provider 的上限不同                                                   |
| 日誌新欄位破壞既有的格式檢查                                                                      | 新欄位只加在最後面。`ai-parse.e2e-spec.ts:651` 照跑                                                                            |
| 將來部署時，反向代理的等待上限比 60 秒短，請求先被切斷                                            | 決策 341 (f) 寫進 spec §8。部署時核對                                                                                          |
| GLM 今天到期，合併前 dev 的 AI 記帳不能用                                                         | 優先做這個 PR。開發者在這段期間不用 AI 記帳，其他功能不受影響                                                                  |

## 4. 驗證點

- T0 後：隔離 e2e 的 Vertex 斷言紅、fake 對照綠；typecheck 綠。
- T1 後：SC-P33～P37 單元測試綠；GLM 單元測試內容沒改且綠；隔離 e2e 轉綠；既有 API e2e 全綠。
- T2 後：CI 全綠；dev 在 `LLM_PROVIDER=glm` 或 `fake` 時照常啟動。
- T3 後：SC-P40 的表填完。

## 5. 要開發者決定的事

- 沒有新的。開發者要做的 GCP 設定見 spec §8；T3 要等它完成。
- spec §10 第 11 項（日誌多 4 個數字欄位）是本次新增，核可本 plan 時一起確認。

## 6. 派工

- T1 用 `orca orchestration` 派給 `backend` 角色，Task spec 照 `docs/orca-multi-agent.md` 的格式，附本 plan §1.2 全文與 spec 決策 337～344。
- 驗收：協調者逐行看 diff，自己重跑 SC-P38、SC-P39 與 API e2e。
- worker 驗收合併後，立刻清 worktree、分支、終端機。

## 7. 實作紀錄

### 換模型前的實測（2026-10-27～10-28，直接呼叫 provider）

- 腳本在 repo 外（`orca/scratch/vertex-test/`），token 用 `gcloud auth print-access-token` 手動拿，不經 API 與資料庫。
- DeepSeek V4.1 Flash（`global`，暫時放寬到 90 秒）：SC-P10 15/15；SC-P27 第 1～4 項 26/27。42 次中位數約 1.37 秒，超過 10 秒 9 次、超過 25 秒 6 次，最慢 54158ms。
- 答錯的 1 次：「旅行基金 機票 8000 刷卡」第 1 輪提議新分類「機票」，期望「交通」。
- `us-central1` 回 400：這個模型只能走 `global`。
- Gemini 3.5 Flash-Lite：15/15、27/27，中位數約 0.85 秒。開發者覺得分類判斷太差，沒選。

### T1 provider 與認證（2026-10-28）

- 抽出 `OpenAiCompatibleLlmProvider`，保留 64 KiB 上限、禁止 redirect、JSON mode、usage 與截斷防線。Vertex 的固定 Google 網址由 factory 組成，推論不重試；每次呼叫都向來源取得當下 token。
- `google-auth-library` 安裝版本 **11.3.1**；其 transporter 使用 **gaxios 8.3.2**，logging 使用 **google-logging-utils 2.1.0**。查核依據是這次 lockfile 對應的已安裝程式碼：`auth/authclient.js`、`auth/googleauth.js`、`auth/oauth2client.js`、`auth/impersonated.js`、`gtoken/getToken.js`，以及 gaxios 的 `gaxios.js` / `retry.js`。
- **認證重試**：官方認證請求會指定 `retry: true` 或 POST 的 `retryConfig`；gaxios 預設最多重試 3 次（無回應預設 2 次），且預設沒有可依賴的總期限。以公開 `clientOptions.transporterOptions` 設 `retryConfig: { retry: 0, noResponseRetries: 0 }` 與單次 `timeout: 60000`；gaxios 深層合併設定，所以服務帳戶金鑰的 token 交換即使 HTTP 503 也只送一次，SC-P36.4 已以真的 GoogleAuth 與假 fetch 驗證。
- **代理登入例外**：11.3.1 的 `GoogleAuth.fromImpersonatedJSON` 建立來源 client 時沒有傳入 `clientOptions`，來源 OAuth 與 IAM Credentials 請求仍可能按套件預設重試；ADC 的 metadata 探測也使用套件自己的傳輸。協調者確認採決策 341 (d) 的第二條路：不覆寫套件內部方法，以共用 provider 從開始拿 token 起的 **60000ms 外層期限**限制呼叫者等待，涵蓋所有認證路徑。逾時立刻回 `timeout`、不送推論；GoogleAuth 不收 AbortSignal，背景工作可繼續，但 token promise 的晚到 rejection 有接住且不記錄。SC-P37.1、P37.3 驗證卡住與 90 秒才失敗的來源都在 60 秒回應、fetch 為 0 次、沒有 unhandled rejection。
- **套件日誌**：`google-logging-utils` 預設回傳空 logger；只有設 **`GOOGLE_SDK_NODE_LOGGING`**（namespace filter，例如 `*`）才建立預設輸出 backend，或外部主動呼叫 `setBackend` 時輸出。本程式不設此變數、不呼叫 `setBackend`、不新增 gaxios interceptor，並在可傳入設定的 client 上用公開 `useAuthRequestParameters: false` 關閉套件預設的認證攔截器；SC-P34.3 驗其 request / response interceptor 集合皆為空。代理登入來源未沿用此選項，仍依賴預設 logging 關閉；部署勿開此 debug 變數。
- **已核可偏離**：GLM 現有成功回應的精確比對測試禁止修改，加入 enumerable `timings` 會破壞既有形狀。協調者同意 GLM 薄包裝只在成功回應移除 `timings`，日誌三段時間為 `unknown`；錯誤仍帶計時，通用 provider 與 Vertex 的成功、失敗都保留已走到的計時。新增回歸測試直接驗 GLM 成功不帶、Vertex 成功帶計時；`glm-llm.provider.spec.ts` 完全未改。
- **已核可的併發補強**：套件的 `Impersonated.refreshToken` 未沿用 OAuth2Client 合併更新的 map。協調者同意認證來源共用 in-flight promise，成功／失敗 settle 時清除；不自行管理 token 或 expiry。共用工作滿 60 秒後，新請求重新呼叫底層，避免永久卡住；舊工作的 finally 不得清掉新的共用工作。補測試驗 5 次併發合併、失敗恢復、卡住 60 秒後重開及舊工作晚到隔離。
- 日誌為讀取 provider 計時，除最後一行外，僅新增 `timings` 的區域變數及成功／失敗賦值；既有欄位順序、API 形狀與額度規則維持原樣。僅新增 `google-auth-library@^11.3.1` 一個直接相依。
- **驗證結果**：`pnpm --filter @ledger/api test --runInBand` **60 suites / 952 tests 通過**（7.462 秒）；`pnpm --filter @ledger/api test:e2e -- ai-vertex-isolation` **1 suite / 3 tests 通過**；`pnpm --filter @ledger/api test:e2e` 對專屬 `ledger_aiv_provider_test` **59 suites / 614 tests 通過**（357.240 秒）。根目錄 `pnpm lint`、`pnpm typecheck`、`pnpm format:check` 與 API `build` 皆通過；`git diff --check` 無問題。未改 GLM 回歸測試與隔離 e2e，未跑 Web e2e、未連 Google。真實模型與部署屬 T2／T3，留給協調者。

### T2 整合與文件（2026-10-28）

- 協調者逐行看完 T1 的 diff（`3305849`），沒有退回。T1 以 fast-forward 併進 `feature/ai-vertex`。
- 協調者在 worker 的 worktree 重跑：typecheck、lint、format:check 通過；API 單元測試 60 suites／952 tests；API e2e 59 suites／614 tests。
- 整合分支在 `3305849` 重跑：根目錄 lint、typecheck、format:check、build 通過；API 單元測試 60／952、shared 160、Web 1121 全過；API e2e 對 `ledger_ai_test` 59 suites／614 tests，含隔離 e2e 3 條。Web e2e 交給 CI。
- spec §9 的上游文件已加註：文字 spec 決策 248、額度 spec 決策 298 (g)、新分類 spec §10 第 5 項。交接檔已更新。
- 沒遇到 Zod 丟掉未列變數的問題，所以 `apps/api/CLAUDE.md` 不加提醒。
- 已清掉：worker 終端機、`aiv-provider` worktree、分支 `feature/aiv-provider`、資料庫 `ledger_aiv_provider_test`。
