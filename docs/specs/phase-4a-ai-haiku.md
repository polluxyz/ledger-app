# Spec：4a 補充：換模型到 Vertex AI 的 Claude Haiku 5.5

> 狀態：**已核可**（開發者 2026-11-18），實作中。
> 上游：[`phase-4a-ai-vertex.md`](phase-4a-ai-vertex.md)（Vertex 認證、60 秒上限、決策 337～345）、[`phase-4a-ai-text.md`](phase-4a-ai-text.md)（`LLMProvider` 介面，決策 247～253）、[`phase-4a-ai-quota.md`](phase-4a-ai-quota.md)（額度與用量紀錄，決策 292～299）。
> 依據：
>
> - 開發者 2026-11-18：「現在已經改成haiku 5.5了 你可以參考pollux的部分」。
> - 開發者 2026-11-18 確認 8 條假設（§0），並要求在 GCP 上的操作一律去識別化。
> - 另一個專案在同一個 GCP 專案用 `rawPredict` 呼叫 Haiku 5.5 成功（2026-11-08）。同一個專案 10-28 回 404，現在已經能用。那個專案也試過 Vertex 的 OpenAI 相容端點，回 400「not servable in region global」。
> - `advisor`（Codex，2026-11-18）2 輪。協調者與 advisor 在 10 個題目上都收斂，沒有留下分歧。第 7 題（enum）與第 8 題（實測規模）是收斂後的版本，細節見決策 398、406。
>
> 編號：決策 395～406，成功條件 SC-P41～P52（已在 `docs/handoff.md` 登記）。沒有畫面改動，不用 W 號。

---

## 0. 假設

開發者 2026-11-18 已確認以下 8 條。

1. 用同一個 GCP 專案。模型 `claude-haiku-5-5`，location 用 `global`。
2. 新增 provider `vertex-anthropic`，沿用現有的 token 來源（`google-auth-library`）。不新增套件。
3. thinking（模型先在內部推理再回答）固定關閉。
4. 對前端的 API 與資料庫 schema 都不變。只調整環境變數的允許值。
5. DeepSeek provider（`vertex`）保留。2026-11-28 前改回 `.env` 就能退回。11-28 之後沒有退回路線。
6. 換完後用真的模型重測 SC-P10、SC-P17、SC-P27，同時記延遲與 token 數。
7. 語音 T3 排在換模型之後。
8. 決策號從 395 開始，先在 main 登記號段。

以下是協調者補的，核可本 spec 時一併確認：

9. 不在 GCP 新建任何資源。沿用 Vertex spec 的服務帳戶與代理登入。如果第一次呼叫回 403，要在 GCP 加權限，動手前先把要改的項目列給開發者看。
10. 測試與 CI 照舊用假 provider，不連 Google，不需要 GCP 憑證。
11. 測試句子全部是編造的資料，不含真實姓名、email、帳號。

---

## 1. 目標與成功樣貌

DeepSeek V4.1 Flash 官方只保證供應到 2026-11-28。本步讓後端改用 Vertex AI 上的 Claude Haiku 5.5。記帳解析的行為維持不變，準確率照決策 345 的門檻。

成功樣貌：

- 主工作區的 `apps/api/.env` 改成 `LLM_PROVIDER=vertex-anthropic`、`VERTEX_MODEL=claude-haiku-5-5`，重開 API 後 AI 記帳能用。
- 模型回的 JSON 由 Vertex 的結構化輸出（structured outputs，要求模型照指定的 JSON schema 回答）約束。帳本、分類、帳戶只能回清單裡的代號。
- 模型拒答時，使用者看到 0 筆草稿，不是錯誤畫面。
- 真的模型重跑 SC-P10、SC-P17、SC-P27，照 SC-P52 的門檻。延遲與 token 數和 DeepSeek 的實測並列。
- 改回 2 個環境變數再重開，就能退回 DeepSeek（只到 11-28）。

### 範圍外

- 圖片、聲音、串流回應。
- prompt caching（提示快取，重複的輸入改用較便宜的快取價）。輸入很短，省不了多少，先不開。
- 開 thinking 或調 effort（思考強度）。
- 改 prompt 的文字。
- 多個 provider 自動切換、hedged request（第 1 個請求太慢就再送 1 個）。
- 網頁的等待提示。
- 刪掉 `vertex` 或 `glm` provider。

---

## 2. 決策

| #   | 決策                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 來源                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 395 | **provider 與設定**：<br>(a) `LLM_PROVIDER` 新增 `vertex-anthropic`。`glm`、`fake`、`vertex` 都保留，預設仍是 `fake`。<br>(b) 沿用 `VERTEX_PROJECT_ID`、`VERTEX_LOCATION`、`VERTEX_MODEL`、`GOOGLE_APPLICATION_CREDENTIALS`，不新增變數。dev 設 `VERTEX_MODEL=claude-haiku-5-5`。<br>(c) `ai.module.ts` 在 `vertex` 與 `vertex-anthropic` 時都建立 Google token 來源。<br>(d) `vertex-anthropic` 只支援 `global`。`VERTEX_LOCATION` 不是 `global`，或缺 `VERTEX_PROJECT_ID`、`VERTEX_MODEL` → `configured: false`，AI 請求回 503 `AI_NOT_CONFIGURED`，不扣額度，不阻止 API 啟動。<br>(e) `VERTEX_MODEL` 在 `vertex-anthropic` 時必須是單一路徑片段：只能有英文、數字、`.`、`_`、`@`、`-`。不合格同 (d)。組網址時再做一次網址編碼。<br>(f) 網址由程式組成，不提供改網址的設定：`https://aiplatform.googleapis.com/v1/projects/{project}/locations/global/publishers/anthropic/models/{model}:rawPredict`。rawPredict 是 Vertex 直接轉送 Anthropic 原生請求格式的端點。<br>(g) `descriptor` 是 `{ configured, provider: 'vertex-anthropic', model: VERTEX_MODEL }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 假設 1、2、4、`advisor`                          |
| 396 | **程式結構**：<br>(a) 從 `OpenAiCompatibleLlmProvider` 抽出共用的安全傳輸：拿 token、總期限、`fetch`、`redirect: 'error'`、64 KiB 回應上限、固定的錯誤轉換、3 段耗時。<br>(b) 先做「行為不變」的抽取，再加新 provider。`glm`、`vertex`、Google token 來源現有的單元測試不改內容、不放寬，全部照舊通過。<br>(c) 請求本文、用量、結束原因、JSON 解析留在各自的 provider，不抽成共用。<br>(d) 新增 `AnthropicVertexLlmProvider`，用共用傳輸送 rawPredict。<br>(e) `AiService` 仍只認得 `LLMProvider` 介面。它多做 2 件事：把代號清單放進請求（決策 398 (c)），以及處理拒答（決策 400）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `advisor`                                        |
| 397 | **請求內容**：<br>(a) 本文欄位只有：`anthropic_version: "vertex-2023-10-16"`、`max_tokens`（等於 `AI_PARSE_MAX_OUTPUT_TOKENS`，dev 是 2048）、`system`、`messages`（1 則 user，內容是句子）、`thinking: { type: "disabled" }`、`output_config.format`（決策 398）。本文不帶 `model`，模型由網址決定。<br>(b) 不送 `temperature`、`top_p`、`top_k`。Haiku 5.5 對非預設值回 400。<br>(c) 不用 prefill（預先填入 assistant 回答的開頭）。Haiku 5.5 一律回 400。<br>(d) 不送 effort。預設是 `medium`，和 `thinking: disabled` 相容。送 `xhigh` 或 `max` 會回 400。<br>(e) `system` 只放指示與清單（`catalog.system`），不再附上 schema 文字。schema 已經由結構化輸出傳給 Vertex，重複放只會多花輸入 token。<br>(f) prompt 的文字不改                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `claude-api` skill（Haiku 5.5 段落）、假設 3     |
| 398 | **結構化輸出與 schema 轉換**：<br>(a) 第 1 版就用 `output_config: { format: { type: "json_schema", schema } }`。Vertex 回 400 時不降級成沒有 schema 的請求，也不重送。<br>(b) 送出的 schema 由純函式從 `AI_WIRE_JSON_SCHEMA` 轉出，不修改原本的常數。函式只沿 schema 的節點遞迴，剝掉 Vertex 不支援的 `maxItems`、`minItems`、`maxLength`、`minLength`。遇到未知的關鍵字，測試要能攔下。<br>(c) 帳本、分類、帳戶的代號清單由 `LlmRequest` 新增的欄位傳入。只有 `vertex-anthropic` 使用，其他 provider 忽略。<br>(d) 轉換時加入 enum（列舉，只允許清單裡的值）：`ledger` 是 `L1..Ln` 加 `null`；`category` 是 `C1..Cn` 加 `null`；`account` 與 `toAccount` 是 `A1..An` 加 `"?"` 加 `null`。清單是 0 筆時：`ledger`、`category` 是 `[null]`，`account`、`toAccount` 是 `["?", null]`。<br>(e) schema 只跟 3 份清單的長度有關，和名稱無關。所以清單長度相同的使用者共用 Vertex 的 schema 編譯快取（第一次編譯較慢，之後 24 小時內重用）。<br>(f) enum 不取代授權。`validateAiDrafts` 照舊逐筆驗代號、金額、日期、筆數上限（`AI_MAX_DRAFTS`）與名稱長度。被剝掉的限制就由它把關。<br>(g) `amountYuan` 與 `date` 的 `pattern` 先保留。SC-P51 用 1 次真的請求確認 Vertex 接受這份 schema。如果 Vertex 因為 `pattern` 回 400，就改成剝掉 `pattern`，不用再核可，因為 `validateAiDrafts` 已經驗這 2 欄。<br>(h) 次選方案：`category` 的 enum 改成 `pattern: ^C[1-9][0-9]*$`。只在實測發現 enum 造成問題時才提出，不自動切換。<br>(i) 只有在實測看到結構化輸出仍包了 Markdown 圍欄（` ``` `）時，才另外加「整段只有 1 個圍欄就剝掉」的修復 | `advisor`、`claude-api` skill                    |
| 399 | **回應解析與結束原因**：<br>(a) 回應的 `content` 是多個 block（區塊）。只看 `type: "text"` 的 block，跳過 `thinking` block。剛好 1 個 text block 才解析成 JSON。0 個、2 個以上，或出現其他種類的 block，都算 `content: null`。<br>(b) `stop_reason`（模型停下的原因）：`end_turn` 的內容才能成為草稿。<br>(c) `max_tokens` 與 `model_context_window_exceeded` 算截斷（決策 297）：即使 JSON 完整也整份丟掉，回 0 筆，用量照記。日誌結果是 `truncated`。<br>(d) `refusal` 照決策 400。<br>(e) 其他值、缺值、未知值：`content: null`，用量照記。日誌結果是 `invalid`。<br>(f) 未知的 `stop_reason` 字串不寫進日誌，也不回前端                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `advisor`、`claude-api` skill                    |
| 400 | **拒答**：<br>(a) Haiku 5.5 的安全分類器可能拒答：HTTP 200，`stop_reason: "refusal"`。Haiku 沒有伺服器端的自動改用其他模型。<br>(b) provider 回 `content: null` 與內部的拒答標記，用量照記。<br>(c) `AiService` 回 200 與 `drafts: []`，和「看不懂句子」相同。前端不用改。<br>(d) 決策 298 (g) 的日誌結果分類新增 `refusal`。<br>(e) 拒答的文字與 `stop_details` 裡的類別不回前端、不進日誌                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `advisor`                                        |
| 401 | **用量對應（決策 298 (c)）**：<br>(a) `promptTokens` = `input_tokens` + `cache_creation_input_tokens` + `cache_read_input_tokens`。`completionTokens` = `output_tokens`。<br>(b) 2 個快取欄位不存在時算 0。欄位存在但不是非負的安全整數，整份用量算不明。<br>(c) 加總後也要是安全整數，否則整份用量算不明。<br>(d) 回應沒有思考 token 的欄位，`reasoningTokens` 省略，日誌記 `unknown`。<br>(e) 不啟用 prompt caching                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `advisor`                                        |
| 402 | **時間上限與失敗**：<br>(a) 沿用 Vertex 決策 341：上限 60 秒，涵蓋拿 token 與推論請求，不重試。<br>(b) 拿不到 token 回 503 `AI_UNAVAILABLE`，照扣額度，日誌結果 `auth`。<br>(c) HTTP 非 2xx（含 schema 被拒的 400）回 503 `AI_UNAVAILABLE`，照扣額度（決策 293），日誌記狀態碼。<br>(d) 決策 341 (h) 的逾時例外只適用 DeepSeek。Haiku 的實測重新計算，不沿用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Vertex 決策 341、`advisor`                       |
| 403 | **不洩漏與資料處理**：<br>(a) 沿用 Vertex 決策 342 與決策 252：token、金鑰內容、金鑰路徑、服務帳戶 email、句子、模型回應都不進日誌、錯誤訊息、API 回應或資料表。<br>(b) Vertex 回的錯誤本文不讀進日誌。<br>(c) 開放給其他使用者前，要核對 Anthropic 模型在 Vertex 上的資料處理、留存、告知與同意。<br>(d) 部署前核對 2 件 GCP 設定（§8）：Vertex 有沒有開請求與回應的記錄；組織政策有沒有限制結構化輸出                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `advisor`                                        |
| 404 | **換模型的核對（決策 298 (j)）**：<br>(a) 已查的（`claude-api` skill 的模型資料，2026-11-18）：context 長度 1M token；最大輸出 128K；單價在每次輸入 100K token 以下時，每 100 萬 token 輸入 US$0.10、輸出 US$0.50；超過 100K 時是 US$0.50 與 US$2.50。<br>(b) 本專案每次輸入遠低於 100K token，只適用較低的單價。DeepSeek 實測每次約 726～793 token，換 tokenizer 與加格式指示後仍是同一個量級。<br>(c) 最早的退役日期是 2027-10-07。<br>(d) 新的 tokenizer（把文字切成 token 的規則）讓同樣的文字比舊模型多約 30% token。結構化輸出也會由供應商加入格式指示。所以 provider 回報的輸入 token 會比 `promptBytes` 推算的多。<br>(e) Vertex 的實際單價以 GCP 帳單為準。T 階段結束後，開發者在 GCP 帳單看一次實際金額。<br>(f) 另一個專案的付費驗收還沒做完，不能當成本專案已通過的證據                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 額度 spec 298 (j)、`claude-api` skill、`advisor` |
| 405 | **退回路線**：<br>(a) 2026-11-28 前：同一次設定更新改回 `LLM_PROVIDER=vertex` 與 `VERTEX_MODEL=deepseek-ai/deepseek-v4.1-flash-maas`，重開 API。2 個變數一定要一起改。<br>(b) 部署手冊（§8）寫退回步驟，不放真實的專案 ID 或帳號。<br>(c) 11-28 之後 DeepSeek 不能當可靠的退路。Haiku 不能用時就關閉 AI 解析：拿掉 `VERTEX_MODEL` 再重開，AI 回 503 `AI_NOT_CONFIGURED`，一般記帳照常可用。這時另寫換模型 spec。<br>(d) Vertex 決策 344 (c) 的「11-21 前複查 DeepSeek 供應期限」由本 spec 取代                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 假設 5、`advisor`                                |
| 406 | **真的模型實測（SC-P51、SC-P52）**：<br>(a) 總上限 100 次、US$0.25。單價照 404 (a)，輸出上界 2048 token。由預算反推，每次輸入不超過 14,760 token 時，100 次最多 US$0.25。測試資料固定，所以每次的輸入大小可以事先確認。SC-P51 記下實際的輸入 token；任何一次超過 14,760 就停下，重算預算。<br>(b) 測試資料先凍結，跑的途中不改。<br>(c) 腳本累計嘗試次數，存在檔案，重啟不歸零。到上限就停。<br>(d) 不自動重試。回 400、401、403 就停止該情境，先查原因。<br>(e) 全部經過真的 API 與測試資料庫，不直接呼叫 provider。額度的提高只放在隔離的測試設定裡，不改 dev。<br>(f) 測試句子用編造的資料（假設 11）。報告裡專案 ID 遮掉                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `advisor`、開發者 2026-11-18（去識別化）         |

---

## 3. 資料模型

不改。

---

## 4. API

### 4.1 `POST /ai/parse-transaction`

請求、回應、錯誤碼都不變。拒答回 200 與 `drafts: []`，和現在「看不懂句子」一樣，前端不用改。

### 4.2 shared

不改。代號清單只在後端內部的 `LlmRequest` 傳遞，不進 `packages/shared`。

### 4.3 環境變數

不新增變數。`LLM_PROVIDER` 的允許值多一個 `vertex-anthropic`。`.env.example` 加 Haiku 的設定範例與退回說明。

### 4.4 新增套件

無。沿用 `google-auth-library`，推論請求用 Node 內建的 `fetch`。

---

## 5. 成功條件

SC-P41～P50 用 mock 或假的 token 來源驗證，進 CI。SC-P51、SC-P52 用真的模型，協調者手動跑。

- **SC-P41**（設定與 factory）：
  1. `LLM_PROVIDER=vertex-anthropic` 被接受。其他未知值照舊拋錯。
  2. 3 個必要值都有、location 是 `global`、model 合格 → `descriptor` 是 `{ configured: true, provider: 'vertex-anthropic', model }`。
  3. 缺 project 或 model、location 不是 `global`、model 含 `/`、`?`、`#`、`%`、空白 → `configured: false`。API 照常啟動，AI 請求回 503 `AI_NOT_CONFIGURED`，額度不變。
  4. `vertex-anthropic` 時有建立 Google token 來源；`glm`、`fake` 時沒有。
  5. `vertex`、`glm`、`fake` 的行為不變。
- **SC-P42**（schema 轉換）：
  1. 轉出的 schema 沒有 `maxItems`、`minItems`、`maxLength`、`minLength`。
  2. 原本的 `AI_WIRE_JSON_SCHEMA` 沒被修改（轉換前後深度比較相同）。
  3. enum 照決策 398 (d)，含 0 筆清單的情況。
  4. 清單長度相同、名稱不同 → 轉出的 schema 完全相同。
  5. schema 出現轉換函式不認得的關鍵字 → 測試失敗。
- **SC-P43**（請求內容，mock fetch）：
  1. 網址等於決策 395 (f)，model 有網址編碼。
  2. `Authorization` 是當下拿到的 token。`redirect: 'error'`。
  3. 本文欄位照決策 397 (a)。沒有 `model`、`temperature`、`top_p`、`top_k`、effort。`messages` 只有 1 則 user。
  4. `system` 不含 schema 文字。
- **SC-P44**（回應解析）：
  1. `end_turn` 加 1 個 text block → 解析出 JSON。
  2. thinking block 在前、text block 在後 → 照樣解析出 JSON。
  3. 0 個 text block、2 個 text block、出現 `tool_use` block → `content: null`。
  4. `max_tokens`、`model_context_window_exceeded`（JSON 完整也一樣）→ `truncated: true`，用量照記。
  5. 未知的 `stop_reason`、缺 `stop_reason` → `content: null`，日誌結果 `invalid`，日誌不含那個字串。
  6. text 不是 JSON → `content: null`，用量照記。
- **SC-P45**（拒答，API 層）：
  1. provider 回拒答 → API 回 200 與 `drafts: []`。
  2. 個人與全站的 `calls` 各加 1，token 照 provider 回報的記。
  3. 日誌結果是 `refusal`，不含拒答文字與類別。
- **SC-P46**（用量）：
  1. 3 個輸入欄位加總成 `promptTokens`。
  2. 快取欄位不存在 → 算 0。
  3. 任一欄位是負數、小數、字串、`null`（欄位存在）→ 用量不明。
  4. 加總超過安全整數 → 用量不明。
  5. `reasoningTokens` 在日誌是 `unknown`。
- **SC-P47**（共用傳輸）：
  1. `glm`、`vertex`、Google token 來源現有的單元測試不改內容，全部通過。
  2. `vertex-anthropic` 的 60 秒上限涵蓋拿 token；拿 token 卡住 → `timeout`，fetch 沒被呼叫。
  3. 回應超過 64 KiB → 不解析，用量不明。
  4. HTTP 400 → 503 `AI_UNAVAILABLE`，照扣額度，日誌記 `httpStatus=400`，不記錯誤本文。
- **SC-P48**（不洩漏）：讓假的 token 來源回特殊字串當 token，Vertex 的錯誤本文與拒答文字含特殊字串。
  1. 成功、拒答、HTTP 錯誤、拿不到 token 的情況，回應與所有日誌通道（Nest `Logger`、`console`）都不出現這些字串。
  2. 資料表裡也不出現。
- **SC-P49**（enum 不取代授權）：provider 回別人帳本的代號、不在清單裡的代號、超過 `AI_MAX_DRAFTS` 筆、超長的新分類名稱 → `validateAiDrafts` 照舊擋下或截掉，和其他 provider 相同。
- **SC-P50**（退回）：同一份設定改回 `vertex` 與 DeepSeek 模型名 → factory 產生 `vertex` provider，請求走 OpenAI 相容網址。用 mock 驗證，不連 Google。
- **SC-P51**（真的模型，第一次呼叫）：
  1. 經過 API 送 1 句，Vertex 接受轉出的 schema，回 200。回 400 時照決策 398 (g) 處理。
  2. 記這次的總耗時（含 schema 第一次編譯）。
  3. API 閒置超過 1 小時後再送 1 句 → 200，token 自動換新。
- **SC-P52**（真的模型，完整驗收）：在 worktree 用隔離的測試設定跑。全部經過 API 與資料庫。
  - **傳輸**：
    1. 4a SC-P10 五句各 3 次（15 次），加上 SC-P27 第 1～3 項各 3 次（27 次），共 42 次。全部在 60 秒內收到 200。
    2. 另加 3 組各 10 次：DeepSeek 分類答錯的句子、跨帳本的句子、10 筆長句。
    3. 列出中位數、p90、p95、最大值，以及超過 10、25、60 秒的次數。和 Vertex spec §1 的 DeepSeek 數字並列。
  - **語意**（門檻照決策 345）：4. 型別、金額、日期、帳本、帳戶、資料隔離 100%。5. 分類提議答錯的，逐筆列出句子、輪次、模型的答案、期望的答案。6. 拒答的次數。0 次以外要逐筆列出句子（句子是編造的，可以列）。
  - **用量**：7. SC-P27 第 5 項：兩張額度表的次數與 token 合計和 provider 回報一致。8. 每次的輸入與輸出 token。和 DeepSeek 的 726～793 輸入 token 並列。
  - 總次數與金額不超過決策 406 (a)。

---

## 6. 測試策略

- **先寫、先紅**（協調者）：SC-P45、SC-P48、SC-P49。這 3 條管額度、外洩與授權，屬於安全防線。
- 單元：設定與 factory（SC-P41）、schema 轉換（SC-P42）、請求與回應（SC-P43、SC-P44、SC-P46）、共用傳輸（SC-P47）、退回（SC-P50）。
- API e2e（對 PostgreSQL）：SC-P45、SC-P48 的資料表部分，用可替換的假 provider。
- 抽取共用傳輸時，`glm`、`vertex` 現有的測試不改內容，當成「行為沒變」的回歸測試。
- 手動：SC-P51、SC-P52，協調者跑，不放進 CI。
- CI 不需要 GCP 憑證，也不連 Google。

---

## 7. 界線

- **Always**：`thinking` 關閉；只送決策 397 (a) 列的欄位；`validateAiDrafts` 照舊驗每一份草稿；只有 `end_turn` 的內容能成為草稿；60 秒上限涵蓋拿 token；網址只能是 Google 的固定位址；GCP 操作與報告去識別化。
- **Ask first**：改模型或 location；開 thinking 或送 effort；改 prompt 文字；開 prompt caching；加自動切換或 hedged request；在 GCP 新建資源或加權限；給服務帳戶更多權限；超過決策 406 的次數或金額；category 改用 pattern（決策 398 (h)）；在 CI 連真的 Google API。
- **Never**：自動重試推論請求；Vertex 回 400 時降級成沒有 schema 的請求；把拒答文字、未知的 `stop_reason`、句子、模型回應、token、金鑰、專案 ID 寫進日誌或回應；送 prefill、`temperature`、`top_p`、`top_k`；把 enum 當成授權檢查；拿不到 token 或拒答時改用別的 provider。

---

## 8. 部署

GCP 端（開發者，程式不依賴）：

1. 不建新資源。沿用 Vertex spec 的服務帳戶。
2. 核對 Vertex 有沒有開請求與回應的記錄（決策 403 (d)）。
3. 核對組織政策有沒有限制結構化輸出（決策 403 (d)）。
4. SC-P51 回 403 時，協調者先列出要加的權限，開發者同意後才改。

開發者的電腦（主工作區）：

1. `apps/api/.env` 改 2 行，其他 Vertex 變數不動：
   ```bash
   LLM_PROVIDER=vertex-anthropic
   VERTEX_MODEL=claude-haiku-5-5
   ```
2. build shared 與 API，重開 API。沒有 migration，沒有新套件，網頁沒變。

退回（決策 405）：

- 11-28 前：2 行改回 `LLM_PROVIDER=vertex`、`VERTEX_MODEL=deepseek-ai/deepseek-v4.1-flash-maas`，重開 API。
- 關閉 AI 解析：拿掉 `VERTEX_MODEL`，重開 API。

---

## 9. 對既有文件的影響

- `phase-4a-ai-vertex.md`：
  - 決策 344 (c) 加註「由 Haiku 決策 405 取代」。
  - §7 Ask first 的「改用 `json_schema`」「新增 provider」加註「已在 Haiku spec 核可」。
  - §1 範圍外的「Claude 路線」加註連到本 spec。
- `phase-4a-ai-quota.md`：決策 298 (g) 加註「新增 `refusal`，見 Haiku 決策 400 (d)」；298 (j) 加註「Haiku 的核對見決策 404」。
- `phase-4a-ai-text.md`：決策 248 的 60 秒註記補上 `vertex-anthropic`。
- `docs/README.md`：spec 索引加本 spec。
- `docs/handoff.md`：ai-4a 列改成本步進度。
- `docs/handoff/ai-4a.md`：本步進度、實測結果、退回方式、已知問題。
- 根目錄 `.env.example`：Haiku 範例與退回說明。

---

## 10. 核可時確認的項目

1. **決策 395 (a)、(d)**：新值 `LLM_PROVIDER=vertex-anthropic`，只支援 `global`。不新增環境變數。
2. **決策 398 (a)**：用結構化輸出。Vertex 回 400 不降級、不重送。
3. **決策 398 (d)**：帳本、分類、帳戶用 enum 限制代號。授權檢查照舊。
4. **決策 397 (e)**：`system` 不再附 schema 文字（prompt 的指示文字不變）。
5. **決策 400**：拒答回 200 與 0 筆草稿，照扣額度，日誌多一種結果 `refusal`。
6. **決策 402 (a)**：60 秒上限、不重試，和 DeepSeek 相同。
7. **決策 406**：真的模型最多 100 次、US$0.25。
8. **決策 405**：11-28 前可退回 DeepSeek；之後 Haiku 不能用就關閉 AI 解析。
9. **§0 假設 9**：不在 GCP 新建資源。要加權限時先列給開發者看。
