# 交接：4a AI 文字記帳（`ai-4a`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 4a 現況（2026-10-23）

- worktree `ai-4a`，測試資料庫 `ledger_ai_test`。`feature/phase-4a-ai` 已經 squash merge（#155，`f35485b`）並部署到 dev。
- T0～T6 完成。T6 用真的模型 `glm-5.3`（z.ai）跑 SC-P10，15 次全對。各任務的 commit、6 輪實測、dev 驗證結果見 `tasks/archive/phase-4a-plan.md` §1.7、§7。
- 主工作區的 `apps/api/.env` 設了 `LLM_PROVIDER=glm`、z.ai 端點、`GLM_REASONING_EFFORT=low`。金鑰只在那裡。
- dev 的 a@a.com 在「test 的帳本」多了「早餐」「午餐」分類與「信用卡」帳戶，給假 provider 的固定句子用。
- 預覽頁（不進版控）：`docs/artifacts/step-4a-ai-draft-preview.html`。

## 新分類提議（2026-10-24 核可，#161 合併，已部署並驗完真的模型）

- spec `docs/specs/phase-4a-ai-new-category.md`，plan 與 todo 在 `tasks/archive/ai-new-category-*.md`。T0～T6 都做完；實作紀錄見 plan §7。
- T5：dev 已重新 build（沒有 migration）。a@a.com 的「test 的帳本」與「tttest」各多一個「日用品」分類，測試交易已軟刪除。
- T6：glm-5.3 跑 SC-P17 與 4a SC-P10 第 5、6、8 步，24/24。保留預設分類的對照輪，分類 9/9 對，1 次 25 秒逾時。
- 會改 API：草稿與新增交易都多一個 `newCategoryName`。不改 schema。
- 開發者原話：「z.ai只會用到28號 之後就會換其他模型喔 先暫時用這個」。所以：
  - 不做 z.ai 專屬的工作。`GLM_BASE_URL` 的預設值（bigmodel.cn）先不改。`advisor` 建議現在改成 `https://api.z.ai/api/paas/v4`，開發者核可 spec §10 第 5 項時同意延到換模型那次處理。
  - 換模型時提示詞可能要重調，SC-P10、SC-P17 要重測。做法照 plan §7 T6（暫時的 e2e 對 `ledger_ai_test`）。
- z.ai 條款：`advisor` 2026-10-24 讀過官方條款與 DPA。結論是開放給其他人前要補告知與同意、並向供應商確認用途；現在只有開發者自己用，不必先做。阻擋項見 `../handoff.md`。
- Jev：開發者想之後把分類交給 Jev。`advisor` 建議先用 GLM 做完，Jev 另寫評估 spec，達標才換（spec §2.4）。這次不建任何 Jev 的檔案。

## 每日額度與輸出上限（2026-10-24 核可，#166 合併，已部署並驗完真的模型）

- spec `docs/specs/phase-4a-ai-quota.md`（決策 292～299、W245、SC-P18～P27），plan 與 todo 在 `tasks/archive/ai-parse-quota-*.md`。
- 開發者在 dev 試過 4a 與新分類提議：「目前測試看起來沒甚麼問題」，費用控管「先繼續做」。
- 每人每日 50 次、全站每日 500 次，台灣日曆日；呼叫模型前扣額度，扣了不退。新增 2 張表，要跑 migration。
- `advisor` 給了 4 輪意見，都已併入 spec 與 plan，雙方沒有留下分歧。
- T0～T5 都做完。T4 兩軸審查找到 3 個測試缺口，已補並做過突變檢查。各任務 commit、驗證數字、審查結果見 plan §7。
- 部署：dev 已套用 migration `20261024120000_ai_parse_daily_usage`，部署前的備份在 `/tmp/aiq/backup/ledger_dev-before-aiq.dump`。冒煙測試用 a@a.com 送了 2 句，所以 a@a.com 10-24 已用 2 次額度。
- T5：glm-5.3 跑 SC-P27（10 筆 3 次，加 SC-P17、4a SC-P10 第 5、6、8 步各 3 次），27/27，都沒有被截斷。10 筆最多用 609 個輸出 token，所以上限維持 2048。思考 token 算在輸出 token 裡。表的次數與 token 和 provider 回報一致。
- 新的環境變數：`AI_PARSE_DAILY_LIMIT_PER_USER`（50）、`AI_DAILY_LIMIT_GLOBAL`（500）、`AI_PARSE_MAX_OUTPUT_TOKENS`（2048）。空白就用預設值。

## AI 入口改成圖示（2026-10-26 完成，#180 合併，已部署）

- 定案：1 號星芒圖示；B 案（輸入欄從圖示向左展開，有動畫）；首頁承接用丁案（兩頁都能送出、編輯、確認，草稿放在路由外層共用）。advisor 兩輪交流後定案，開發者 10-26 回「1 採用丁案 / 2 可以」，spec、plan、todo 回「好」核可。
- 文件：spec `docs/specs/phase-4a-ai-text.md` §2.4（W246～W256、SC-P28～P32），plan 與 todo 在 `tasks/archive/ai-icon-entry-*.md`。實作紀錄見 plan §8。docs PR #178 已合併（`679a0f2`）。
- T0：已通知 stats-2j（它在做 2l PR3）首頁 3 個接點、W256 的 3 條界線，以及 PR3 要加「拖曳中 AI 結果到達，草稿區長高後落點仍正確」的驗收。
- T1、T2：Codex 做完，只改 `apps/web`（22 個檔）。T3 退回 1 次（解析成功時焦點不該被搶走），Codex 修正後通過。
- T3 驗收：lint、typecheck、format:check、build 通過；單元測試 2,113 個全過；API e2e 611 個、Web e2e 99 個全過；SC-P32 的 12 種版面都通過。手機虛擬鍵盤沒有實機驗證，要請開發者部署後用手機確認。
- T4：PR #180 開出後，`main` 合併了 2l PR3（#179），`HomePage.tsx` 衝突。Codex 用 merge 解衝突，並補 4 個首頁整合 e2e（編輯模式下的草稿操作、拖動中 AI 回應到達的落點），這是 2l plan §3.5 要求後合併一方做的。協調者重跑：單元測試全過，API e2e 611 個、Web e2e 133 個全過。
- #180 squash merge 為 `9f6597c`。只改前端，主工作區 `git pull` 就完成部署，不必重 build API。
- 已清掉：ai-icon worktree、分支 `feature/ai-icon-entry`（本地與遠端）、`ledger_aiicon_test`、本地分支 `docs/ai-4a-handoff-icon`。
- 10-26 派工曾被 Claude Code 的 auto mode 擋下（`Create Unsafe Agents`）。用 bypass permissions 模式開 session 就不受影響。
- Orca run：`run_b0d1069e24d7`（協調者 `term_90de4fdd-cdc6-43f0-9db9-9d3f878cba4a`）。舊的 `run_8a5582ad901e`、`run_50f41e6dc0fb` 不再用，Orca 沒有關閉指令所以還留著。

## 語音輸入與匯入（2026-10-27 開發者提出）

開發者要加語音輸入，以及照片、檔案匯入（銀行或發票的交易紀錄）。

- 語音（10-29 改，spec 已核可）：頁面上的麥克風按鈕，用瀏覽器內建的 Web Speech API 辨識，只驗桌機 Chrome＋localhost，後端不改。取代 10-27 的「錄音送後端 STT」。辨識完只填進輸入欄，使用者確認或改字後自己按送出。
  - spec `docs/specs/phase-4a-voice.md`（決策 346～357、W257～W259、SC-SR1～SR16），plan 與 todo 在 `tasks/ai-voice-*.md`。
  - 手機網頁可用 Android、iOS 的內建辨識（要 HTTPS），App 要接原生 API，後端 STT 只是備案（決策 346）。
  - 不加開放前的告知（開發者 10-29「這個應該沒那麼重要 不用加」）。台幣沒有小數，20 句的金額一律整數。
- 匯入來源 4 種都要：雲端發票匯出的 CSV、照片或截圖（紙本發票、收據、銀行 App）、銀行對帳單 CSV／Excel、銀行對帳單 PDF。開發者說「也許還有其他的」，所以來源要做成可擴充的介面。
- 資料外送：可以送外部模型，但後端送出前先遮掉卡號與帳號。
- 順序：換模型（已完成）→ 語音 → 匯入。匯入還沒寫 spec，結果一律是草稿，要使用者確認才寫入。

## 換模型到 Vertex AI 的 DeepSeek V4.1 Flash（2026-10-28 完成，#192、#195）

- spec `docs/specs/phase-4a-ai-vertex.md`（決策 337～345、SC-P33～P40），plan 與 todo 在 `tasks/archive/ai-vertex-*.md`。開發者 10-28 回「同意」核可 spec 改版、plan、todo。
- 經過：Claude Haiku 5.5 在這個 GCP 專案回 404（「haiku暫時不能用」）；gpt-oss-120b 只對 5/15；Gemini 3.5 Flash-Lite 15/15 與 27/27 → 先選 Gemini 3.5 Flash-Lite → 開發者改選 DeepSeek：「我還是決定用deepseek-v4.1-flash / gemini 3.5 flash-lite很笨」。各候選的實測表見 spec §1。
- 模型 ID `deepseek-ai/deepseek-v4.1-flash-maas`，只能走 `global`；用 `us-central1` 回 400。
- 10-28 實測（global、逾時 90 秒）：SC-P10 15/15；SC-P27 26/27。42 次中位數約 1.37 秒，超過 25 秒 6 次，最慢 54 秒。
- 因長尾延遲，Vertex 時間上限改 60 秒、不重試，GLM 維持 25 秒（決策 341）。分類提議允許偶爾答錯、逐筆列出（決策 345）。advisor（Codex，`run_105770a2c589`）2 輪後雙方一致。
- 實測腳本在 repo 外：`C:\Users\Administrator\orca\scratch\vertex-test\`（`vertex-smoke.mjs`、`vertex-p27.mjs`，用 `vertex.env` 執行；`vertex.env` 含帳號資訊，不要分享）。腳本依賴 `apps/api/dist`，改了 `apps/api/src/ai` 要先 build。gcloud 在 `C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin`，舊終端機要先加進 PATH。
- T0（`72381f6`）：契約與先紅的隔離 e2e。T1：Codex（`backend`）做完 provider 與認證，協調者逐行看 diff 並重跑全部檢查。T2：上游 spec 加註、本 PR。各任務的數字、套件重試與日誌的調查結論、已核可的偏離見 plan §7。
- 新的環境變數：`LLM_PROVIDER=vertex`、`VERTEX_PROJECT_ID`、`VERTEX_LOCATION`（預設 `global`）、`VERTEX_MODEL`、`GOOGLE_APPLICATION_CREDENTIALS`（選填，金鑰檔放 repo 外）。`GLM_BASE_URL` 預設值改成 z.ai。部署時不要開 `GOOGLE_SDK_NODE_LOGGING`。
- 不要部署專用 GPU 機器（`model.deploy()`），只用按次計費 API。花費在 Console「帳單 → 報表」看，gcloud 查不到金額。
- GLM 10-28 到期。主工作區 `apps/api/.env` 已改成 `LLM_PROVIDER=vertex`（改之前的備份在 `$TEMP/ledger-api-env.bak`）。
- T3（10-28，#195）：在 worktree 用暫時的 e2e 跑 SC-P40 第 1～9 項。語意、用量、認證都過；第 1 項 41/42（1 次 60 秒逾時），第 8 項 token 有換新但推論逾時。數字見 plan §7。
- 開發者 10-28 回「好 核可」：2 項逾時照實接受，只在自用期間有效，不算 SC-P40 全部通過（spec 決策 341 (h)）。「雜支 50」回「到時候有遇到問題再說」，不調 prompt（決策 345 (e)）。advisor 與協調者意見一致。
- **11-21 前複查**：官方只保證 DeepSeek V4.1 Flash 供應到 2026-11-28（決策 344 (c)）。

## 下一步

1. 語音：T0、T1 已完成，T2 已合併部署（見 `tasks/ai-voice-plan.md` §7）。接下來是 T3：開發者在自己的 Chrome 現場測，協調者記錄；之後 T4 收尾。
2. 2026-11-21 前複查 DeepSeek V4.1 Flash 的供應期限（決策 344 (c)）。
3. 長尾延遲（偶爾超過 25 秒、少數超過 60 秒）可另案改善：先做等待提示與讓使用者自己重送，再考慮 hedged request。開放給其他使用者前要重新評估這個例外。
4. 之後：匯入，走 spec → plan → todo（範圍見「語音輸入與匯入」一節）。開放給其他使用者前的阻擋項見 `../handoff.md`。
5. 請開發者用手機確認虛擬鍵盤彈出時 AI 輸入欄的位置（SC-P32 唯一沒驗的項目）。

## 已知問題

- 假 provider 遇到固定句子、但帳本裡沒有對應的分類或帳戶時回 500（plan 核可的行為）。劇本以外的句子回 0 筆草稿。
- DeepSeek V4.1 Flash 的長尾延遲：T3 中位數 4.2 秒、p95 56 秒，42 次中 1 次超過 60 秒回 503，使用者重送。慢在收到回應開頭之前。
- DeepSeek 對「雜支 50」偶爾分類空著或提議「雜支」，空著時草稿不能確認，使用者要自己選。
- glm-5.3 關不掉思考。`low` 時轉帳句偶爾要 16～19 秒，超過 25 秒回 503，使用者重送。
- `low` 時名稱（title）常是 null，使用者要自己補。
- `apps/web/e2e/debts.spec.ts:258`（還款）合併後失敗過 1 次，重跑都過。與 4a 無關。
- `apps/web/e2e/home-layout-edit.spec.ts:299`（2l 的 SC-Y15 right 側）在 #180 驗收時失敗 1 次：放開拖曳後立刻點「完成」，沒有送出儲存。單獨重跑 4 個方向各 10 次都過。與 4a 無關。
- DeepSeek 在 SC-P27「旅行基金 機票 8000 刷卡」3 次中 1 次提議新分類「機票」，期望「交通」（決策 345 列為已知問題）。換 prompt 或模型時優先重測。
- `apps/web/e2e/home.spec.ts:418`（SC-Y8）時好時壞，與 4a 無關。
- `TransactionForm.tsx` 共享帳本送出路徑（約 1209 行）沒有帶 `newCategoryName` 的元件測試；API e2e 有覆蓋共享帳本寫入。
