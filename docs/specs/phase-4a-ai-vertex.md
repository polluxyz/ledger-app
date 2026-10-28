# Spec：4a 補充：換模型到 Vertex AI 的 DeepSeek V4.1 Flash

> 狀態：**已核可**（開發者 2026-10-28）。同日改選 DeepSeek，改版內容（模型、Vertex 60 秒、決策 345 放寬分類門檻）與 §10 第 8～11 項，開發者同日連同 plan 回「同意」核可。
> 上游：[`phase-4a-ai-text.md`](phase-4a-ai-text.md)（`LLMProvider` 介面，決策 247～252）、[`phase-4a-ai-quota.md`](phase-4a-ai-quota.md)（額度與輸出上限，決策 292～299）、[`phase-4a-ai-new-category.md`](phase-4a-ai-new-category.md)（決策 281；§10 第 5 項延到本次）。
> 依據：
>
> - 開發者 2026-10-24：z.ai 只用到 10-28，之後換模型。
> - 開發者 2026-10-28：Claude Haiku 5.5 在這個 GCP 專案回 404，「haiku暫時不能用」。看完 Gemini 的實測結果後：「好 先換這個模型」。
> - 開發者 2026-10-28 回答 3 題：同意新增 `google-auth-library` 與 4 個環境變數；憑證「本機就代理登入 可是vm上應該只能用api」；拿不到 token 時照扣額度、回 503。
> - 開發者 2026-10-28 改選：「我還是決定用deepseek-v4.1-flash / gemini 3.5 flash-lite很笨」。
> - 開發者 2026-10-28 回「同意」：Vertex 時間上限 60 秒、不重試；放寬分類提議的驗收門檻。
> - `advisor`（Codex，2026-10-28）：
>   - 第 1 次：建議用 `google-auth-library` 的 ADC，並抽出通用的 OpenAI 相容 provider。
>   - 第 2 次：長尾延遲建議 Vertex 60 秒、不重試，並列出換 DeepSeek 後 spec 要改的 8 項。
>   - 第 3 次：同意放寬分類提議的門檻。
>   - 3 次協調者都同意，最後沒有分歧。
>
> 編號：決策 337～345，成功條件 SC-P33～P40。4a 原本的決策號已用完，本次接在 2l 用到的 336 後面，並在 `docs/handoff.md` 登記。沒有畫面改動，不用 W 號。

---

## 0. 假設

開發者 2026-10-28 已回答第 4、6、7 項，並選定第 1 項的模型。其餘在核可本 spec 時一併確認。

1. 模型：Vertex AI 的 `deepseek-ai/deepseek-v4.1-flash-maas`。MaaS（Model as a Service，Google 代管、按次計費）。這個模型**只能走 `global`**：用 `us-central1` 呼叫，Google 回 400。走 Vertex 的 OpenAI 相容端點（OpenAI 格式的 chat completions 網址）。
2. prompt、JSON schema、草稿驗證（`validateAiDrafts`）、額度、輸出上限 2048 都不改。實測時 prompt 沒改。
3. **時間上限**：Vertex 改成 60 秒，GLM 維持 25 秒（決策 341 (a)）。實測時有 14% 的請求超過 25 秒。
4. 新增套件 `google-auth-library`（Google 官方的認證套件）與 4 個環境變數。**開發者已同意。**
5. 推論請求（把句子送給模型的那次 HTTP 請求）仍用 Node 內建的 `fetch`。套件只負責拿 access token（短效的通行證，1 小時過期）。
6. 憑證：**開發者已回答。** 程式只用一種方式：ADC（Application Default Credentials，套件依固定順序自己找憑證）。環境不同，ADC 找到的憑證不同，程式不用改：
   - 開發者的電腦：用 gcloud 代理登入（impersonation，以自己的帳號暫時扮演服務帳戶）。不用下載金鑰檔。
   - GCP 上的 VM：附掛服務帳戶。不用金鑰檔。
   - 不在 GCP 的 VM：用服務帳戶金鑰檔，或 Workload Identity Federation（讓外部身分換成 GCP 憑證，不用金鑰檔）。
   - **開發者以為 VM 上只能用 API key，但 Vertex 的這個端點不收 API key**（Google 官方文件：只收 OAuth access token）。上面 3 種都能在 VM 上用，程式相同。
7. 拿不到 token：**開發者已回答。** 照扣額度，回 503 `AI_UNAVAILABLE`。
8. 保留 `glm` 與 `fake` 兩個 provider。`glm` 的行為不變，只把共用的 HTTP 與解析程式抽出來。
9. 不做圖片與聲音。模型能讀圖片（官方模型頁），留到匯入 spec 再用。
10. 測試與 CI 照舊用假 provider，不打外部 API，不需要 GCP 憑證。
11. 目前只有開發者自己用。Vertex 的條款與資料留存照舊列為「開放給其他人前」的阻擋項。
12. 開發者在 GCP 後台做的設定（§8）不在程式範圍。程式不依賴預算提醒。
13. 不送 `reasoning_effort` 或其他思考參數。官方模型頁說這個模型支援思考，但沒寫預設值與參數。所以「不送」不等於「沒思考」。

---

## 1. 目標與成功樣貌

z.ai 的 GLM 在 2026-10-28 到期。本步讓後端改用 Vertex AI 上的 DeepSeek V4.1 Flash。記帳解析的行為維持不變，準確率照決策 345 的門檻。

成功樣貌：

- 主工作區的 `apps/api/.env` 改成 `LLM_PROVIDER=vertex` 與 3 個 Vertex 變數，重開 API 後 AI 記帳能用。
- access token 由程式自動更新。API 閒置超過 1 小時，請求仍然成功。
- 真的模型重跑 SC-P10、SC-P17、SC-P27，照 SC-P40 的門檻。SC-P27 第 5 項（兩張額度表的數字和 provider 回報一致）這次經過 API 與資料庫驗。
- 日誌、錯誤訊息、回應都不出現 access token、金鑰內容、金鑰路徑。

已有的實測（直接呼叫 provider，不經 API 與資料庫，token 手動拿）：

| 模型                            | SC-P10 | SC-P27 第 1～4 項 | 延遲                                                                    |
| ------------------------------- | ------ | ----------------- | ----------------------------------------------------------------------- |
| DeepSeek V4.1 Flash（本次採用） | 15/15  | 26/27             | 42 次：中位數約 1.37 秒；超過 10 秒 9 次、超過 25 秒 6 次；最慢 54.2 秒 |
| Gemini 3.5 Flash-Lite（對照）   | 15/15  | 27/27             | 中位數約 0.85 秒；10 筆長句 2.3～2.6 秒                                 |
| glm-5.3（對照）                 | 15/15  | 27/27             | 1.3～11.8 秒                                                            |
| gpt-oss-120b                    | 5/15   | 沒跑              | 6 次逾時                                                                |

DeepSeek 實測的條件：`global`，暫時把逾時放寬到 90 秒，輸出上限 2048，不送 `reasoning_effort`。

- 答錯的 1 次：「旅行基金 機票 8000 刷卡」第 1 輪提議新分類「機票」，期望「交通」。另 2 輪答對。金額、日期、帳本、帳戶、型別都對。
- 長尾延遲和輸出長短無關：輸出 7 token 的也有 19 秒。判斷是 Google 端排隊，沒有證實。
- 10-27 同一模型用 25 秒逾時：23 次中 4 次逾時。
- 每次輸入約 726～793 token，輸出 7～512 token。usage 沒有思考 token 的欄位。

Gemini 的 27/27 不能當成 DeepSeek 的證據。開發者覺得 Gemini 分類判斷太差，所以改選 DeepSeek。

### 範圍外

- 圖片、聲音、串流回應。
- 多個 provider 自動切換（一家壞了換另一家）。
- hedged request（對沖請求：第 1 個請求太慢就再送 1 個，取先回來的）。會改決策 248 與額度記帳，日後另寫 spec。起點建議：8 秒後最多多送 1 次，總上限 60 秒。
- 網頁在等待超過 8～10 秒時顯示「還在處理」。要改網頁，另案。
- 改 prompt 或 JSON schema。
- 用量畫面、改額度數字。
- Claude 路線。開發者在 GCP 啟用 Claude 之後，另寫 spec。

---

## 2. 決策

| #   | 決策                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 來源                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 337 | **provider 與模型**：<br>(a) `LLM_PROVIDER` 新增 `vertex`，保留 `glm` 與 `fake`。預設仍是 `fake`。<br>(b) 模型由 `VERTEX_MODEL` 決定，dev 設 `deepseek-ai/deepseek-v4.1-flash-maas`，`VERTEX_LOCATION` 用 `global`。程式不寫死模型名稱。<br>(c) 不送 `reasoning_effort` 或其他思考參數。<br>(d) 其餘請求內容和 GLM 相同：`max_tokens`、`response_format: json_object`、`stream: false`、system 加 schema、user 是句子。JSON mode 只保證回傳的是 JSON，不保證符合 schema，所以 `validateAiDrafts` 不能省。這次不改成 `json_schema`。<br>(e) 截斷照決策 297：`finish_reason: "length"` 轉成統一的「被截斷」狀態                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 假設 1～3、8、13、`advisor`                  |
| 338 | **程式結構**：<br>(a) 把 `GlmLlmProvider` 的 HTTP、逾時、64 KiB 回應上限、`redirect: 'error'`、usage 解析抽成 `OpenAiCompatibleLlmProvider`。它接受一個「拿 Bearer token 的函式」，每次請求都呼叫一次。時間上限由建構參數決定。<br>(b) `glm`：拿 token 的函式固定回 `GLM_API_KEY`。時間上限 25 秒。對外行為與現有的單元測試結果不變。<br>(c) `vertex`：拿 token 的函式向 `google-auth-library` 要 token。時間上限 60 秒。`descriptor.provider` 是 `vertex`，`model` 是 `VERTEX_MODEL`。<br>(d) `AiService` 只在日誌那行加數字欄位（決策 341 (g)、344 (f)），仍只認得 `LLMProvider` 介面。額度、草稿驗證都不改                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `advisor`                                    |
| 339 | **環境變數**：<br>(a) `VERTEX_PROJECT_ID`：`vertex` 時必填。<br>(b) `VERTEX_LOCATION`：預設 `global`。<br>(c) `VERTEX_MODEL`：`vertex` 時必填。<br>(d) `GOOGLE_APPLICATION_CREDENTIALS`：選填，金鑰檔的路徑。只有「不在 GCP 的 VM 用金鑰檔」才需要。<br>(e) 不提供 `VERTEX_BASE_URL`。網址由程式組成：`global` 用 `https://aiplatform.googleapis.com`，其他 region 用 `https://{location}-aiplatform.googleapis.com`，路徑是 `/v1/projects/{project}/locations/{location}/endpoints/openapi/chat/completions`。這樣設定錯了也只會連到 Google，token 不會送到別的網址。<br>(f) `VERTEX_PROJECT_ID` 與 `VERTEX_LOCATION` 只接受小寫英文、數字、連字號（`-`），格式不對就讓 API 啟動失敗。這兩個值會組進網址，所以要擋掉 `/`、`?`、`@` 這類字元。<br>(g) `vertex` 但缺 `VERTEX_PROJECT_ID` 或 `VERTEX_MODEL`：照現有做法回 503 `AI_NOT_CONFIGURED`，不扣額度，不阻止 API 啟動。<br>(h) **4 個變數都要列進環境變數的 schema**。schema 沒列的變數會被丟掉，Nest 只把驗證後的值寫回 `process.env`。所以 `GOOGLE_APPLICATION_CREDENTIALS` 不列就會消失。程式從 `ConfigService` 讀出後，明確傳給套件（`keyFilename`），不依賴套件自己讀 `process.env`。<br>(i) 空字串或只有空白視同沒設定（同決策 292 (e)） | 假設 4、6、`advisor`                         |
| 340 | **憑證與 token**：<br>(a) 用 `google-auth-library` 的 `GoogleAuth`，scope 是 `https://www.googleapis.com/auth/cloud-platform`。整個 API 程序共用一個實例。<br>(b) 憑證來源照假設 6。程式不分環境，只看 ADC 找到什麼。<br>(c) token 的快取與到期前更新由套件處理。同時有多個請求要 token 時，只更新 1 次。<br>(d) 金鑰檔放在 repo 與所有 worktree 之外，不加進 `.worktreeinclude`。<br>(e) 後端用專用的服務帳戶，只給「Vertex AI User」角色，不給 Owner 或 Editor。這個角色不是最小權限，本期接受                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 假設 6、`advisor`                            |
| 341 | **時間上限與失敗**：<br>(a) `vertex` 的上限是 **60 秒**，從「開始拿 token」算到「讀完回應」，涵蓋拿 token 與推論請求。`glm` 維持 25 秒。這條覆寫上游決策 248 與 SC-P10、SC-P17、SC-P27 寫的「25 秒」，只適用於 `vertex`。<br>(b) 拿 token 超過上限 → 當成逾時，不送推論請求。<br>(c) 拿 token 失敗 → `LlmProviderError` 新增種類 `auth`，`AiService` 回 503 `AI_UNAVAILABLE`。額度在呼叫 provider 前就扣了，照扣不退；這次算用量不明（決策 298 (b)）。<br>(d) 推論請求不重試（決策 248）。套件拿 token 時的內建重試要明確設定：關掉，或限制在上限內。實作時看套件的設定項決定，寫進 plan，並用測試驗證「上限一到就停」。<br>(e) 決策 298 (g) 的結果分類新增 `auth`。日誌另外不記任何認證細節。<br>(f) 60 秒只是 provider 的上限。讀清單、扣額度、記用量在這段時間之外。將來部署時，反向代理與主機的等待上限要比 60 秒長，並留資料庫操作的時間。<br>(g) provider 分開量 3 段耗時：拿 token、收到回應標頭、讀完回應。`AiService` 的那行日誌在最後面加上 `tokenMs`、`headersMs`、`bodyMs`，既有欄位的順序不動。沒走到的段記 `unknown`。只記數字，用來判斷長尾出在哪一段                                                                                                                                | 假設 3、7、開發者 2026-10-28、`advisor`      |
| 342 | **不洩漏憑證**：<br>(a) 日誌、錯誤訊息、API 回應都不出現 access token、金鑰內容、金鑰路徑、服務帳戶 email。<br>(b) 套件丟的錯誤不往外傳，也不交給 exception filter。provider 只轉成固定的 `LlmProviderError('auth')`。<br>(c) 關掉套件自己的日誌與請求 interceptor（攔截器，可以在送出前後讀寫請求），避免它印出 token。<br>(d) 決策 252 照舊：句子與模型回應不寫資料庫、不寫日誌                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 假設 11、`advisor`                           |
| 343 | **`GLM_BASE_URL` 預設值改成 `https://api.z.ai/api/paas/v4`**。新分類 spec §10 第 5 項延到本次。z.ai 雖然到期，`glm` provider 仍保留，預設值要指向實際用過的端點                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 新分類 spec §8、`advisor`                    |
| 344 | **換模型的核對（決策 298 (j)）**：<br>(a) 已查的（官方模型頁，2026-10-28 查）：單價每 100 萬 token 輸入 US$0.30、輸出 US$1.20；context 長度 1,048,576；能讀圖片，不能讀聲音與影片；不支援 Provisioned Throughput（預購專用容量）。<br>(b) 標示不一致：模型頁標 experimental，官方文件標 Preview。照實記，連同模型 ID 與查核日期。<br>(c) **官方只保證供應到 2026-11-28**。2026-11-21 前人工複查一次。到期不續時的退場方案：另寫換模型 spec。已到期的 GLM 不算有效的回復路線，保留 `glm` provider 只代表程式能接其他 OpenAI 相容的供應商。<br>(d) `global` 沒有區域資料駐留保證（不保證資料留在某個地區）。開放給其他使用者前，核對這個 Google 代管開放模型的條款與資料留存，不沿用 Gemini 的假設。<br>(e) T3 要記的：dev 日誌觀測到的輸入大小、輸入太大時的拒絕方式、`completion_tokens` 與 `reasoning_tokens`（或 `completion_tokens_details`）、`total_tokens` 的關係、`max_tokens` 是否包含思考。沒有欄位就記「未知」，不記 0。<br>(f) 為了 (e)，usage 解析多讀 `completion_tokens_details.reasoning_tokens`。有合法的值就在日誌那行最後面加 `reasoningTokens`，沒有就記 `unknown`。只寫日誌，額度表不改                                                                                         | 額度 spec 298 (j)、假設 9、11、13、`advisor` |
| 345 | **SC-P40 的準確率門檻**：<br>(a) 型別、金額、日期、帳本、帳戶、資料隔離：100%。<br>(b) 分類提議（決策 281 的新分類名稱，以及選既有分類）允許偶爾答錯。每一次答錯都逐筆列出，不宣稱統計上可靠。<br>(c) 理由：分類只是提議，使用者確認前會看到，也能改。3 輪的樣本太少，硬要全對只會變成「重跑到剛好全對」。<br>(d)「旅行基金 機票 8000 刷卡」列為已知問題。之後換 prompt 或換模型時，優先重測這句                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 開發者 2026-10-28、`advisor`                 |

---

## 3. 資料模型

不改。

---

## 4. API

### 4.1 `POST /ai/parse-transaction`

請求、回應、錯誤碼都不變。拿不到 token 和其他 provider 錯誤一樣回 503 `AI_UNAVAILABLE`。

`vertex` 時，最慢要等約 60 秒才回應。網頁呼叫這個端點時沒有自己的逾時，會一直等到後端回應。

### 4.2 shared

不改。

### 4.3 環境變數

決策 339 的 4 個變數，同步寫進 `.env.example`，附 3 種憑證來源的說明。`GLM_BASE_URL` 的預設值照決策 343 改。

### 4.4 新增套件

`apps/api` 新增 `google-auth-library`（目前最新 11.3.1）。它的相依：`gaxios`、`gcp-metadata`、`jws`、`ecdsa-sig-formatter`、`base64-js`、`google-logging-utils`。**開發者 2026-10-28 已同意。**

---

## 5. 成功條件

SC-P33～P39 用 mock 或假的認證來源驗證，進 CI。SC-P40 用真的模型，協調者手動跑。

- **SC-P33**（環境變數）：
  1. `LLM_PROVIDER=vertex` 被接受。其他值照舊拋錯。
  2. `VERTEX_LOCATION` 沒設 → `global`。
  3. `VERTEX_PROJECT_ID` 或 `VERTEX_LOCATION` 含 `/`、`?`、`@`、`.`、大寫字母或空白 → `validateEnv` 拋錯。
  4. `GOOGLE_APPLICATION_CREDENTIALS` 經過驗證後仍在設定裡。
  5. 空字串、只有空白 → 視同沒設定。
- **SC-P34**（factory）：
  1. `vertex` 且 3 個必要值都有 → `descriptor` 是 `{ configured: true, provider: 'vertex', model }`。
  2. 缺 `VERTEX_PROJECT_ID` 或 `VERTEX_MODEL` → `configured: false`，`provider: 'vertex'`。API 照常啟動，AI 請求回 503 `AI_NOT_CONFIGURED`，額度不變。
  3. 有設 `GOOGLE_APPLICATION_CREDENTIALS` → 明確傳給認證套件。
  4. `vertex` 的時間上限是 60 秒，`glm` 是 25 秒。
  5. `glm`、`fake` 的行為不變。
- **SC-P35**（傳輸，mock fetch）：
  1. `global` 與 `us-central1` 各組出正確的網址。
  2. 每次請求的 `Authorization` 是當下拿到的 token。認證來源換了 token，下一次請求就帶新的。
  3. 請求不帶 `reasoning_effort`，`max_tokens` 等於設定，`response_format` 是 `json_object`，`redirect: 'error'`。
  4. GLM 現有的單元測試全部照舊通過，不改測試內容（SC-P25 的截斷、usage、非 JSON 情況都在裡面）。
- **SC-P36**（token 更新，用真的套件加假時鐘，不連網路）：
  1. token 到期前，連續 3 次請求只拿 1 次 token。
  2. 接近到期 → 下一次請求拿新 token。
  3. 同時 5 個請求遇到要更新 → 只更新 1 次。
  4. 更新失敗 1 次 → 那次回 `auth`。下一次請求能拿到新 token，恢復正常。
- **SC-P37**（時間上限，`vertex` 的 60 秒）：
  1. 拿 token 卡住超過 60 秒 → 回 `timeout`，fetch 沒被呼叫。
  2. 拿 token 花了大部分時間 → 推論請求只剩下剩餘的時間。總耗時不超過 60 秒加一點誤差。
  3. 套件的內建重試不會讓總耗時超過 60 秒。
  4. 推論請求在 59 秒回應 → 成功。超過 60 秒 → `timeout`。
  5. 日誌那行有 `tokenMs`、`headersMs`、`bodyMs`。拿 token 失敗時，`headersMs` 與 `bodyMs` 是 `unknown`。
  6. usage 有 `completion_tokens_details.reasoning_tokens` → 日誌有 `reasoningTokens` 的數字；沒有 → `unknown`。額度表的數字不受影響。
- **SC-P38**（拿不到 token）：API 層的測試。
  1. 回 503 `AI_UNAVAILABLE`。
  2. 個人與全站的 `calls` 各加 1，`usageUnknownCalls` 各加 1。
  3. 日誌有 1 行，結果分類是 `auth`。
- **SC-P39**（不洩漏）：讓假的認證來源回特殊字串當 token，丟出的錯誤訊息含特殊的金鑰路徑與服務帳戶 email。
  1. 成功與失敗的情況，回應與所有日誌通道（Nest `Logger`、`console`）都不出現這些字串。
  2. 資料表裡也不出現。
- **SC-P40**（真的模型，手動）：主工作區的 dev 環境，`LLM_PROVIDER=vertex`。全部經過 API 與資料庫，直接呼叫 provider 的結果不算。分 3 組驗：
  - **傳輸**：
    1. 4a SC-P10 五句各跑 3 次，加上 SC-P27 第 1～4 項（10 筆長句、SC-P17 五句、SC-P10 第 5、6、8 步）各跑 3 次。全部 42 次都在 60 秒內收到 200。
    2. 列出中位數、p90、p95、最大值，以及超過 10、25、60 秒的次數。
    3. 每次從日誌讀 3 段耗時（決策 341 (g)）。
  - **語意**（門檻照決策 345）：4. 型別、金額、日期、帳本、帳戶、資料隔離 100%。5. 分類提議答錯的，逐筆列出句子、輪次、模型的答案、期望的答案。
  - **用量與認證**：6. SC-P27 第 5 項：兩張額度表的次數與 token 合計和 provider 回報一致。7. 記錄每次的輸入與輸出 token。核對 `completion_tokens` 與思考 token 的關係，照決策 344 (e)。8. API 開著超過 1 小時沒有請求，之後再送 1 句 → 200，token 自動換新。9. 失敗分 2 種情況，都回 503、額度算用量不明、沒有洩漏，驗完恢復：
    - 強制重新拿 token 而失敗（例如拿掉憑證後重開 API）→ 日誌結果是 `auth`。
    - token 有效但推論被拒（例如拿掉服務帳戶的 Vertex AI User 角色）→ 日誌結果是 `http`，狀態 401 或 403。

---

## 6. 測試策略

- **先寫、先紅**（協調者）：SC-P38 與 SC-P39。這兩條管額度與憑證外洩，屬於安全防線。
- 單元：環境變數（SC-P33）、factory（SC-P34）、通用 provider 的傳輸（SC-P35）、token 更新（SC-P36，用真的套件，網路層用假的）、時間上限（SC-P37）。
- API e2e（對 PostgreSQL）：SC-P38。用可替換的認證來源，讓它失敗。
- GLM 現有的單元測試不改內容，當成「抽出共用程式後行為沒變」的回歸測試。
- 手動：SC-P40，協調者在主工作區跑，不放進 CI。
- CI 不需要 GCP 憑證，也不連 Google。

---

## 7. 界線

- **Always**：每次請求都向認證來源要 token；`vertex` 的 60 秒上限涵蓋拿 token；`glm` 維持 25 秒；拿不到 token 回 503 並照扣額度；網址只能是 Google 的固定位址；所有新環境變數列進 schema 並寫進 `.env.example`；`validateAiDrafts` 照舊驗每一份草稿。
- **Ask first**：改模型或 region；改時間上限；送 `reasoning_effort` 或其他思考設定；改 prompt；改用 `json_schema`；新增 provider；加自動切換或 hedged request；給服務帳戶更多權限；在 CI 連真的 Google API。
- **Never**：把 token、金鑰內容、金鑰路徑、服務帳戶 email 寫進日誌、錯誤訊息或回應；把金鑰檔放進 repo 或 worktree，或加進 `.worktreeinclude`；提供可以改推論網址的設定；自動重試推論請求；拿不到 token 時改用別的 provider 或假 provider。

---

## 8. 部署

開發者在 GCP 做的設定（程式不依賴，§0 假設 12）：

1. 建專用服務帳戶，給「Vertex AI User」角色。
2. 給開發者自己的帳號這個服務帳戶的「Service Account Token Creator」角色，才能代理登入。
3. 啟用 IAM Credentials API（代理登入要用）。
4. 設預算提醒。

開發者的電腦（主工作區）：

1. 執行 `gcloud auth application-default login --impersonate-service-account=<服務帳戶 email>`。
2. `apps/api/.env` 改成：
   ```bash
   LLM_PROVIDER=vertex
   VERTEX_PROJECT_ID=<GCP 專案 ID>
   VERTEX_MODEL=deepseek-ai/deepseek-v4.1-flash-maas
   ```
   `VERTEX_LOCATION` 用預設值 `global`。不設 `GOOGLE_APPLICATION_CREDENTIALS`。
3. 安裝新套件，build shared 與 API，重開 API。沒有 migration，網頁沒變，不用按 `Ctrl + Shift + R`。

將來部署到 VM：

- 照 §0 假設 6 選一種憑證來源。程式與環境變數相同，只差在 ADC 找到的憑證。
- 反向代理與主機的等待上限要比 60 秒長（決策 341 (f)）。

---

## 9. 對既有文件的影響

- `phase-4a-ai-text.md`：決策 248 加註「`vertex` 的時間上限是 60 秒，見 Vertex 決策 341 (a)」。
- `phase-4a-ai-quota.md`：決策 298 (g) 加註「新增 `auth`，見 Vertex 決策 341 (e)」。
- `phase-4a-ai-new-category.md`：§10 第 5 項加註「已在 Vertex 決策 343 處理」。
- `docs/README.md`：spec 索引加本 spec。
- `docs/handoff.md`：ai-4a 列改成本步進度；編號分段加「4a 換模型用決策 337～345、SC-P33～P40」。
- `docs/handoff/ai-4a.md`：
  - 換模型的實測結果：Haiku 404、gpt-oss-120b 5/15、Gemini 15/15 與 27/27、DeepSeek 15/15 與 26/27 與長尾延遲。
  - 開發者先選 Gemini，後改選 DeepSeek。
  - 本步進度。
  - 已知問題：「旅行基金 機票 8000 刷卡」分類提議不穩定（決策 345 (d)）；Web e2e SC-Y8（`apps/web/e2e/home.spec.ts:418`）時好時壞。
  - 2026-11-21 前複查 DeepSeek 的供應期限（決策 344 (c)）。
- `apps/api/CLAUDE.md`：如果實作時遇到 Zod 丟掉未列變數這個坑，寫一行提醒。

---

## 10. 核可時確認的項目

1. **§4.4 的新增套件**：`google-auth-library`。開發者 2026-10-28 已同意，這裡再列一次。
2. **決策 339 的 4 個環境變數**：`VERTEX_PROJECT_ID`、`VERTEX_LOCATION`（預設 `global`）、`VERTEX_MODEL`、`GOOGLE_APPLICATION_CREDENTIALS`。不提供改網址的變數。
3. **決策 339 (f)**：project 與 location 格式不對讓 API 啟動失敗；缺必填值只讓 AI 回 503。
4. **決策 341 (c)**：拿不到 token 照扣額度、回 503。開發者 2026-10-28 已同意。日誌多一種結果分類 `auth`。
5. **決策 343**：`GLM_BASE_URL` 預設值改成 z.ai 的網址。
6. **§0 假設 6**：VM 上不能用 API key，要用附掛的服務帳戶、金鑰檔，或 Workload Identity Federation。程式相同。
7. **決策 337 (a)**：保留 `glm`。到期後仍保留，方便之後換其他 OpenAI 相容的供應商。
8. **決策 337 (b)、341 (a)**：模型改 DeepSeek V4.1 Flash；`vertex` 時間上限 60 秒、不重試。開發者 2026-10-28 已同意。
9. **決策 345**：分類提議允許偶爾答錯，其餘 100%。開發者 2026-10-28 已同意。
10. **決策 344 (c)**：DeepSeek 官方只保證供應到 2026-11-28，GLM 已不能當回復路線。到期前要再換模型。
11. **決策 341 (g)、344 (f)**：日誌那行最後面多 4 個數字欄位（`tokenMs`、`headersMs`、`bodyMs`、`reasoningTokens`）。不記句子與模型回應。這是 advisor 建議、本次新增的，請一起確認。
