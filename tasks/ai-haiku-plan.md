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
  - `LlmRequest` 加必填的 `codes: { ledgers: string[]; categories: string[]; accounts: string[] }`。註解寫「只有 `vertex-anthropic` 用來產生 enum，其他 provider 忽略；enum 不是授權（決策 398 (c)、(f)）」。
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
- enum 照決策 398 (d)。轉出的 schema 只跟清單長度有關。
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
  1. SC-P51 第 1、2 項：送 1 句。記實際的輸入 token；超過 14,760 就停。回 400 時照決策 398 (g) 剝掉 `pattern`，這個改動走一般的 fix PR，再重送 1 次。回 401、403 就停，列出原因給開發者。
  2. SC-P52 第 1 項：42 次。
  3. SC-P52 第 2 項：3 組各 10 次。DeepSeek 分類答錯的組是「旅行基金 機票 8000 刷卡」與「雜支 50」各 5 次；跨帳本的組與 10 筆長句的組各用 SC-P17、SC-P27 裡的同 1 句。
  4. SC-P51 第 3 項：閒置超過 1 小時後送 1 句。
- 預估 74 次，留 26 次給查原因。不自動重試（決策 406 (d)）。
- 主工作區切換：SC-P51 第 1 項回 200 後，主工作區 `apps/api/.env` 改 2 行（spec §8），重開 API，送 1 句確認。切換前告知開發者。
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
| Vertex 不接受 `pattern`，回 400                    | SC-P51 第 1 次就驗。回 400 照決策 398 (g) 剝掉，不用再核可，`validateAiDrafts` 已驗這 2 欄                            |
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

（實作時填）
