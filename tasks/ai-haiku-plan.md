# 4a 補充實作計畫：換模型到 Vertex AI 的 Claude Haiku 5.5

spec：`docs/specs/phase-4a-ai-haiku.md`（決策 395～406、SC-P41～P52）。後端與 e2e 合成一個 PR。

> 核可：開發者 2026-11-18 核可 spec（含 §10 的 9 項）、本 plan 與 todo。

## 0. 起點

- 先開 docs PR（spec、plan、todo、交接檔），合進 `main`。決策號已由 PR #226 登記。
- 整合分支 `feature/ai-haiku`，從合併後的 `main` 開，用 `ai-4a` worktree，測試資料庫 `ledger_ai_test`。只有這個 session 寫這條分支。
- worker 開自己的 worktree，從整合分支開子分支 `feature/aih-provider`，驗收後 merge 回整合分支。worker 的 e2e 用自己的資料庫 `ledger_aih_provider_test`。
- 角色：共用傳輸、時間上限、用量與不洩漏屬於高準確的工作，派 `backend`。模型看 `docs/orca-multi-agent.md` §0。
- §14 的 4 件事：不改 schema，不改 API，不新增套件，不改 CI，不改網頁。環境變數只多一個允許值（`LLM_PROVIDER=vertex-anthropic`），不新增變數。

## 1. 元件與相依

### 1.1 協調者自己做（T0：契約與先紅的測試）

- `apps/api/src/ai/llm-provider.ts`：
  - `LlmRequest` 加選填的 `codes?: { ledgers: string[]; categories: string[]; accounts: string[] }`。註解寫「只有 `vertex-anthropic` 用來產生 enum，其他 provider 忽略；enum 不是授權（決策 398 (c)、(f)）」。`vertex-anthropic` 收到沒有 `codes` 的請求時當成空清單（見 §7 T0）。
  - `LlmResponse` 加選填的 `refused?: true`。註解寫「模型拒答（決策 400）。`content` 一定是 `null`，用量照記；拒答文字與類別不放進來」。
- `apps/api/src/ai/ai.service.ts`：`complete` 的參數多帶 `codes`，值是 `catalog.ledgers`、`catalog.categories`、`catalog.accounts` 的 key（`L1`、`C1`、`A1`…）。拒答的處理留給 T1，T0 的 e2e 才會先紅。
- 既有的測試 stub 不用改：多一個請求欄位不影響它們。`FakeLlmProvider` 忽略 `codes`。
- 先紅的 e2e `apps/api/test/ai-haiku-isolation.e2e-spec.ts`：
  - 寫法照 `ai-vertex-isolation.e2e-spec.ts`：覆寫 `ConfigService`，設 `LLM_PROVIDER=vertex-anthropic`、`VERTEX_PROJECT_ID`（編造的值）、`VERTEX_LOCATION=global`、`VERTEX_MODEL=claude-haiku-5-5`。覆寫 `VERTEX_TOKEN_SOURCE` 成假的。`jest.spyOn(global, 'fetch')` 回 Anthropic 格式的假回應，不連 Google。
  - SC-P45：fetch 回 `stop_reason: "refusal"`，text 含特殊字串 → API 200、`drafts: []`；個人與全站的 `calls` 各加 1，token 等於假回應的 usage；日誌 1 行，結果分類 `refusal`，不含特殊字串與 `stop_details` 的類別。
  - SC-P48：假 token 是特殊字串；HTTP 400 的錯誤本文與拒答文字含特殊字串。成功、拒答、HTTP 400、拿不到 token 各送 1 次 → 回應、Nest `Logger`、`console`、所有資料表文字欄位都沒有這些字串。成功那次的 fetch 網址等於決策 395 (f)，帶 `Authorization: Bearer <特殊字串>`。
  - SC-P49：fetch 回 `end_turn` 的 JSON，內容含別人帳本的代號、不在清單裡的代號、超過 `AI_MAX_DRAFTS` 筆、超長的新分類名稱 → 回應裡沒有別人的資料，筆數與名稱長度被擋下或截掉，結果和 `ai-parse-isolation.e2e-spec.ts` 對其他 provider 的預期相同。另開第 2 個使用者的帳本當「別人的帳本」。
  - 紅綠的分法：T0 時 factory 不認得 `vertex-anthropic`，會落到 GLM 的分支，回 503 `AI_NOT_CONFIGURED`，這是預期的紅。T1 後轉綠。正向對照用 `LLM_PROVIDER=fake` 跑同一個流程，T0 就綠。

### 1.2 共用傳輸與 provider（T1，`backend`）

依賴 T0。順序照下面寫，每步後跑 `pnpm --filter @ledger/api test`。

**1. 抽出共用傳輸**（新檔 `apps/api/src/ai/llm-http-transport.ts`，決策 396 (a)～(c)）：

- 從 `OpenAiCompatibleLlmProvider` 搬出：token 與總期限的 `Promise.race`、`auth` 與 `timeout` 的錯誤轉換、`fetch` 帶 `redirect: 'error'` 與 signal、非 2xx 轉成 `LlmProviderError('http')`、64 KiB 回應上限、3 段耗時。
- 介面大致是：輸入網址、本文、`getBearerToken`、`timeoutMs`；輸出 HTTP 狀態與已讀完的回應文字（或「超過上限」的標記）與 `timings`。請求本文、usage、結束原因、JSON 解析留在各自的 provider。
- 這一步是「行為不變」的抽取：`openai-compatible-llm.provider.spec.ts`、`glm-llm.provider.spec.ts`、`google-access-token-source.spec.ts` 不改內容，全部通過（SC-P47 第 1 項）。非改不可時先停下回報，不自行放寬斷言。
- 單獨 commit，方便驗收時分開看 diff。

**2. 環境變數**（`apps/api/src/config/env.validation.ts`、根目錄 `.env.example`）：

- `LLM_PROVIDER` 的 enum 加 `vertex-anthropic`。
- `.env.example`：Haiku 的範例（`LLM_PROVIDER=vertex-anthropic`、`VERTEX_MODEL=claude-haiku-5-5`），註明只支援 `global`；退回 DeepSeek 要 2 行一起改，11-28 之後拿掉 `VERTEX_MODEL` 就是關閉 AI。不放真的專案 ID。
- 單元測試：SC-P41 第 1 項。

**3. schema 轉換**（新檔 `apps/api/src/ai/anthropic-output-schema.ts`，決策 398 (b)、(d)、(e)、(g)）：

- 純函式：輸入 `AI_WIRE_JSON_SCHEMA` 與 `codes`，回新的物件，不修改原本的常數。
- 只沿 `properties`、`items` 遞迴。剝掉 `maxItems`、`minItems`、`maxLength`、`minLength`。保留 `pattern`。
- 認得的關鍵字列成白名單。遇到白名單以外的關鍵字就丟錯，讓單元測試攔下（SC-P42 第 5 項）。
- 4 個代號欄位依決策 398 (d) 用 enum 取代重複的 `type`。轉出的 schema 只跟清單長度有關。
- 單元測試：SC-P42。

**4. provider**（新檔 `apps/api/src/ai/anthropic-vertex-llm.provider.ts`，決策 396 (d)、397、399、401）：

- 用共用傳輸送 rawPredict。本文只有決策 397 (a) 的欄位。`system` 只放 `request.system`。
- 回應解析照決策 399：只看 text block；剛好 1 個才 `JSON.parse`；`end_turn` 才回 `content`；`max_tokens` 與 `model_context_window_exceeded` 回 `truncated: true`；`refusal` 回 `content: null` 與 `refused: true`；其他值回 `content: null`。未知的 `stop_reason` 字串不放進任何回傳值。
- 用量照決策 401。`reasoningTokens` 不帶。
- 單元測試（mock fetch）：SC-P43、SC-P44、SC-P46、SC-P47 第 2～4 項。

**5. 組裝與拒答**（`llm-provider.factory.ts`、`ai.module.ts`、`ai.service.ts`）：

- factory 加 `vertex-anthropic` 分支，照決策 395 (d)～(g)。model 的字元檢查用 `^[A-Za-z0-9._@-]+$`，組網址時 `encodeURIComponent`。`timeoutMs` 60000。
- `ai.module.ts`：`vertex` 與 `vertex-anthropic` 都建 `GoogleAccessTokenSource`（決策 395 (c)）。
- `ai.service.ts`：`response.refused` 為真時，結果分類 `refusal`，回 `{ drafts: [] }`。判斷放在 `truncated` 之前。用量照記。
- 單元測試：SC-P41 第 2～5 項、SC-P50。`ai.service.spec.ts` 補拒答的單元測試。
- T0 的 `ai-haiku-isolation.e2e-spec.ts` 轉綠，內容不改。

### 1.3 整合、文件、PR、部署（T2，協調者）

- 合併 T1，逐行看 diff：共用傳輸的抽取是否真的行為不變、本文欄位、enum 的產生方式、拒答與未知 `stop_reason` 的流向、用量加總、`.env.example`。
- 重跑：根目錄 lint、typecheck、test、format:check、build；API e2e 全部（對 `ledger_ai_test`）。Web 沒改，Web e2e 交給 CI。
- spec §9 的文件：Vertex spec、額度 spec、文字 spec 加註；`docs/README.md`；交接檔。
- 用 `pr` skill 開 PR，盯 CI，squash merge。
- 部署 dev（主工作區）：`pnpm install`，build shared 與 API。`.env` 先不改，維持 DeepSeek，等 T3 的 SC-P51 通過才切。

### 1.4 真的模型（T3，協調者）

依賴 T2，以及開發者完成 spec §8 GCP 端第 2、3 項的核對。

- 做法照 Vertex plan §7 T3：在 ai-4a worktree 用暫時的 API e2e 跑真的 app，資料庫 `ledger_ai_test`，`LLM_PROVIDER=vertex-anthropic`、真的 ADC（Application Default Credentials，gcloud 登入後本機存的 Google 憑證）。暫時的 e2e 不進版控。
- 腳本與嘗試次數檔放 repo 外的 `orca/scratch/haiku-test/`。名稱不含姓名與專案名。每送 1 次先加計數再送，到 100 次就停（決策 406 (c)）。
- 測試資料照額度 plan T5：帳本「日常」與「旅行基金」，帳戶現金、信用卡、儲蓄，`today=2026-10-24`。句子沿用 SC-P10、SC-P17、SC-P27，跑之前凍結（決策 406 (b)）。
- 順序：
  1. SC-P51 第 1、2 項：送 1 句。記實際的輸入 token；超過 14,760 就停。回格式 400 時停止該情境，查明原因後照決策 398 (g) 處理。回 401、403 就停，列出原因給開發者。
  2. SC-P52 第 1 項：42 次。
  3. SC-P52 第 2 項：3 組各 10 次。DeepSeek 分類答錯的組是「旅行基金 機票 8000 刷卡」與「雜支 50」各 5 次；跨帳本的組與 10 筆長句的組各用 SC-P17、SC-P27 裡的同 1 句。
  4. SC-P51 第 3 項：閒置超過 1 小時後送 1 句。
- 預估 74 次，留 26 次給查原因。不自動重試（決策 406 (d)）。
- 主工作區切換：SC-P51 與 SC-P52 驗收通過、格式修正合併後，主工作區 `apps/api/.env` 改 2 行（spec §8），重開 API，送 1 句確認。切換前告知開發者。
- 報告與 §7 的紀錄裡，專案 ID 一律遮掉，不寫服務帳戶 email。

## 2. 實作順序

1. docs PR（spec、plan、todo、交接檔）→ 合進 `main`。
2. T0（協調者）→ 整合分支 commit。
3. T1（`backend`）。
4. T2（協調者）→ PR → 合併 → 部署 dev（不切模型）。
5. 開發者核對 GCP 設定 → T3（協調者）→ 切換主工作區的 `.env`。

T1 只有一個 worker：共用傳輸、provider、factory 會碰到同一組檔案，拆開會互相衝突。

時程：DeepSeek 只保證到 2026-11-28。第 4 步要在 11-28 之前合併，第 5 步的切換才有退路。

## 3. 風險與對策

| 風險                                               | 對策                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 抽出共用傳輸時改壞 `glm` 或 `vertex`               | 先單獨做抽取並 commit，既有 3 份單元測試不改內容。驗收時分開看這個 commit 的 diff                                     |
| Vertex 不接受 `pattern`，回 400                    | 已用對照確認 Vertex 接受保留 `pattern` 的修正格式。SC-P51 再用正式程式驗證。                                          |
| 第一次編譯 schema 較慢，第 1 次請求接近 60 秒      | SC-P51 第 2 項記總耗時。超過 60 秒照 503 處理，記下來，不放寬上限                                                     |
| enum 讓模型在對不到時硬選一個代號，而不是回 `null` | enum 都含 `null`（帳戶另含 `"?"`）。SC-P52 第 5 項逐筆列出答錯的；若集中在 enum 造成的錯，再提決策 398 (h) 的次選方案 |
| 拒答被當成錯誤，使用者看到錯誤畫面                 | 決策 400：回 200 與 0 筆。SC-P45 先寫先紅                                                                             |
| 未知的 `stop_reason` 或拒答文字進日誌              | provider 不把字串放進回傳值。SC-P44 第 5 項、SC-P45 第 3 項、SC-P48 驗                                                |
| 新 tokenizer 與格式指示讓輸入比預期大，預算超過    | 決策 406 (a)：SC-P51 記實際輸入，超過 14,760 token 就停                                                               |
| 服務帳戶沒有呼叫 Anthropic 模型的權限，回 403      | 停下。列出要加的權限給開發者看，同意後才改（spec 假設 9）                                                             |
| 11-28 前沒合併，DeepSeek 停止供應時沒有可用的模型  | 本 PR 優先。來不及時照決策 405 (c) 關閉 AI 解析，一般記帳不受影響                                                     |
| 真的模型測試的請求與報告帶出可辨識的資訊           | 句子用編造資料；scratch 目錄與檔名不含姓名、專案名；報告遮專案 ID                                                     |
| 日誌新的結果分類 `refusal` 破壞既有的格式檢查      | 只是 `outcome=` 的新值，欄位與順序不變。`ai-parse.e2e-spec.ts` 照跑                                                   |

## 4. 驗證點

- T0 後：`ai-haiku-isolation.e2e-spec.ts` 的 Haiku 斷言紅、fake 對照綠；typecheck 綠；既有測試行為不變。
- T1 第 1 步後：既有 3 份單元測試內容沒改且綠。
- T1 後：SC-P41～P47、SC-P50 單元測試綠；隔離 e2e 轉綠；既有 API e2e 全綠；沒有新套件。
- T2 後：CI 全綠；dev 在原本的 `LLM_PROVIDER=vertex` 下照常啟動。
- T3 後：SC-P51、SC-P52 的結果填進 §7；主工作區已切到 Haiku。

## 5. 要開發者決定的事

- 沒有新的。核可 spec §10 的 9 項時一起確認。
- T3 前，開發者要核對 spec §8 GCP 端第 2、3 項。協調者也可以用 gcloud 唯讀查詢代為核對，開發者同意才做。

## 6. 派工

- T1 用 `orca orchestration` 派給 `backend` 角色，Task spec 照 `docs/orca-multi-agent.md` 的格式，附本 plan §1.2 全文與 spec 決策 395～403。
- 驗收：協調者逐行看 diff，自己重跑 `ai-haiku-isolation.e2e-spec.ts`、`ai-vertex-isolation.e2e-spec.ts` 與 API e2e。
- worker 驗收合併後，立刻清 worktree、分支、終端機、資料庫 `ledger_aih_provider_test`。

## 7. 實作紀錄

### T0（2026-11-18，協調者）

- **偏離 §1.1：`codes` 改成選填。** 設成必填後，`fake-llm.provider.spec.ts`、`glm-llm.provider.spec.ts`、`openai-compatible-llm.provider.spec.ts` 呼叫 `complete` 都缺這個欄位，typecheck 失敗。改這 3 份測試會違反 T1 驗收「內容不改」。`AiService` 一律會帶 `codes`；T1 的 `vertex-anthropic` 收到沒帶的請求時當成空清單，enum 只剩 `null` 與 `"?"`，不會放寬限制。
- 新增 `apps/api/test/ai-haiku-isolation.e2e-spec.ts`。對 `ledger_ai_test` 跑：fake 正向對照綠；SC-P45、SC-P48、SC-P49 共 3 條紅，都停在 503（factory 落到 GLM 分支，`GLM_API_KEY` 設成空字串）。
- 其他 AI e2e 88 條綠；API 單元測試 70 個 suite、1,084 條綠；API typecheck、lint、format:check 綠。

### T1（2026-11-18，`backend` 實作，協調者驗收）

- 5 個 commit 照 §1.2 的順序：`24a1dc3` 抽出共用傳輸、`e03a286` 環境變數、`fe68e64` schema 轉換、`38eb51e` provider、`c8a1e67` 組裝與拒答。沒有偏離。
- 驗收：
  - 逐行看了全部程式 diff。抽取前後的邏輯一致；第 1 個 commit 只動 `llm-http-transport.ts`、它的測試與 `openai-compatible-llm.provider.ts`。
  - 受保護的 5 份檔案（3 份既有 provider 測試、T0 e2e、`llm-provider.ts`）對 `cc60730` 沒有差異。
  - enum 用長度產生 `L1..Ln` 成立的前提：`ai-catalog.ts` 的代號從 1 起連號。wire schema 的 4 個代號欄位都允許 `null`。
  - 專案 ID 直接組進網址，靠 `env.validation.ts` 的格式 regex 把關；model 另做字元檢查與網址編碼。
- 協調者重跑：typecheck、lint、format:check 綠；API 單元測試 74 個 suite、1,175 條綠；API e2e 66 個 suite、745 條綠（含 Haiku 隔離 4 條）。
- 協調者補上 `llm-http-transport.ts` 的檔頭總述（`9ade7c1`）。

### T2（2026-11-18，協調者）

- spec PR #228 合併（`9477734`）。main 的 R6（#227）併進來後，`docs/handoff.md` 與 plan 各衝突 1 次，都只在文件。shared 的 `dist` 過期造成 `sid` 型別錯誤，重建後通過。
- 在 `c94b1ec` 重跑：lint、typecheck、format:check、build 綠；API 單元測試 75 個 suite、1,213 條綠；API e2e 68 個 suite、765 條綠（在 R6 的真實登入規則下）；shared 160 條綠。
- Web 單元測試用預設平行數時，本機有 16 條 jsdom 測試超過 5 秒逾時；`--maxWorkers=8` 時 143 個檔、1,311 條全過。本步沒改 `apps/web`。
- 上游 spec 照 spec §9 加註，README、交接檔、`CLAUDE.md` §4 已更新。
- PR #230 CI 全綠（head `52b89a7`），squash merge 為 `d190f4f`。
- 部署 dev：主工作區 `git pull`，build shared 與 API。沒有 migration。`.env` 維持 `LLM_PROVIDER=vertex`；用 3200 埠暫時啟動，正常啟動、沒有錯誤。

### T3（2026-11-19，協調者）

- 唯讀核對：Haiku 全域端點的請求與回應記錄未設定，採預設關閉。專案無上層組織，結構化輸出的組織政策限制不適用。
- 實測版本 `c3f3356`。使用已設定的 Google 預設憑證，經實際 API 與 `ledger_ai_test` 執行。測試程序沿用舊工作區的隔離測試庫設定。兩份 `.env` 檔皆未改。74 次的測試資料已凍結，嘗試次數與去識別的結果存於 repo 外的 `orca/scratch/haiku-test/`。
- **SC-P51 第 1 項未通過**。Vertex 回 400，應用程式回 503。第 2 項已量到首筆耗時 4,139 ms。錯誤分類指向請求格式，未能確認是 `pattern`。原始錯誤本文只在記憶體判讀，未留存。決策 398 (g) 的修正條件尚未確認。
- **資料隔離通過 1 項**。存取他人帳本回 404，模型呼叫 0 次。首筆驗收失敗後，個人與全站額度表各增加 1 次，2 張表各有 1 次用量未知。Vertex 未回 token 用量。實際費用待對帳。
- 開發者核可重送 1 次相同請求。沿用同一批測試資料與第一筆輸入。耗時 3,712 ms，Vertex 回 400，應用程式回 503。診斷只留下 `invalid_request_error` 與欄位名 `output_config`、`format`、`schema`。未定位到 `pattern`。個人與全站額度表各再增加 1 次，2 張表各再記 1 次用量未知。
- 開發者核可 1 次最小格式對照。沿用首筆測試資料，只在測試程序將輸出格式換成含 1 個字串欄位的物件。Vertex 回 200，耗時 4,145 ms，回應符合最小格式。輸入 1,025 token、輸出 234 token，與個人及全站額度表的增量一致。應用程式回 200、0 筆草稿，符合對照測試的預期。原格式中的觸發條件仍待隔離。
- 開發者核可 1 次 `pattern` 對照。沿用正式格式與首筆輸入，只在測試程序移除 `amountYuan` 與 `date` 的 `pattern`。耗時 2,821 ms，Vertex 仍回 400，應用程式回 503。錯誤代碼仍為 `invalid_request_error`，指向 `output_config.format.schema`。個人與全站額度表各增加 1 次用量未知的請求。單獨移除 `pattern` 未能通過。
- 開發者核可最多 2 次等價格式對照。以無 `pattern` 的版本為基準，移除 `ledger`、`category`、`account`、`toAccount` 的重複 `type` 宣告。4 欄的 `enum` 保留原值與 `null`。Vertex 與應用程式都回 200，耗時 4,937 ms。2 筆草稿符合預期。輸入 1,504 token、輸出 156 token，與 2 張額度表的增量一致。首個對照已通過，未送第 2 個 `anyOf` 對照。
- 累計送出 5 次，其中 3 次用量未知。通過的格式只套用於測試程序。正式程式的 SC-P51 與 SC-P52 尚未通過。未切換 dev，切換期限維持 2026-11-28。

### T3（2026-11-21，續跑）

- 已實際連線核對，兩份 API 環境檔都指向 `ledger_ai_test`。沿用凍結的 74 筆案例與原計數檔。
- 第 6 次是保留金額與日期 `pattern` 的對照。只移除 4 個代號欄位的重複 `type`。Vertex 與 API 都回 200，耗時 19,866 ms，2 筆草稿符合預期。輸入 1,563 token、輸出 156 token，與個人及全站額度表增量一致。
- 正式程式採用第 6 次對照的格式。4 欄仍保留原本的 enum 與 `null`，帳戶欄也保留 `"?"`。共用格式與草稿檢查維持原樣。
- SC-P51 第 1、2 項通過。正式程式首筆在 22,679 ms 內回 200。輸入 1,563 token，輸出 156 token。越權檢查回 404，模型呼叫 0 次。
- SC-P52 傳輸通過。原定 42 筆全部在 60 秒內回 200。分類、跨帳本、10 筆長句各 10/10。延遲採中位數，p90 與 p95 取排序後對應百分位的第 1 筆。

| 請求                      | 筆數 | 中位數（ms） | p90（ms） | p95（ms） | 最大（ms） | 超過 10／25／60 秒 |
| ------------------------- | ---: | -----------: | --------: | --------: | ---------: | ------------------ |
| Haiku SC-P52 基準         |   42 |        1,192 |     2,036 |     2,910 |      3,275 | 0／0／0            |
| Haiku SC-P52 全部         |   72 |        1,166 |     2,873 |     3,052 |      3,275 | 0／0／0            |
| DeepSeek T3（同為 60 秒） |   42 |        4,210 |    37,234 |    56,197 |     60,052 | 12／8／1           |

- SC-P52 語意通過。72/72 筆的型別、金額、日期、帳本、帳戶符合預期。分類錯誤、拒答或截斷各 0 次。
- SC-P52 每筆輸入 1,549～1,610 token，輸出 10～751 token。DeepSeek 每筆輸入 726～793 token。每筆紀錄在 `orca/scratch/haiku-test/results.jsonl`。

- SC-P51 第 3 項通過。兩筆請求相隔 3601.272 秒。Google 憑證已自動更新，憑證取得耗時 164 ms。Vertex 與 API 都回 200，總耗時 2,666 ms。輸入 1,563 token，輸出 156 token。
- 正式驗收 74/74 筆。個人與全站額度表各增加 74 次，輸入 115,864 token、輸出 14,941 token、用量未知 0 次。與模型回報一致。SC-P52 的 72 筆合計輸入 112,738 token、輸出 14,629 token。
- 累計 80/100 次，包含前 5 次、第 6 次對照與正式 74 次。全程沒有自動重送。已知用量估算 US$0.01974。前 3 次格式錯誤未回用量，實際費用待 Google Cloud 帳單核對。
- 正式程式的 SC-P51 與 SC-P52 均通過。格式修正合併後，由 main 切換 Haiku，再送 1 句確認。該句仍須納入 100 次總額。
- 本機 lint、型別與格式檢查通過。共用程式、後端、網頁單元測試各通過 161、1,233、1,323 個。網頁測試分兩次跑，避免首頁測試碰到本機開發 API，也保留其他測試預期的網址。
