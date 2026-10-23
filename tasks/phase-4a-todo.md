# 4a 任務清單

plan：`tasks/phase-4a-plan.md`；spec：`docs/specs/phase-4a-ai-text.md`。

- [x] **T0 契約與隔離測試**（協調者）：plan §1.1。
      驗收：`pnpm --filter @ledger/shared build` 通過；`isDraftComplete` 單元測試綠（含名稱 null 不擋、轉帳同帳戶不完整）；`ai-parse-isolation.e2e-spec.ts` 紅燈，404／403／409 都有正向對照，SC-P7 斷言帳本等於目前帳本；API／Web typecheck 通過。
- [ ] **T1 `AiModule` 與解析**（依賴 T0；`ai4a-api`，`backend`）：plan §1.2。
      驗收：plan §1.2「測試」的單元與 API e2e 全部通過；隔離測試轉綠；既有 API e2e 全綠（`LedgerAccessGuard` 行為不變）；同一人換 token／IP／帳本共用 10 次、兩人同 IP 各 10 次。
- [ ] **T2 GLM provider**（依賴 T0；`ai4a-glm`，`default`）：plan §1.3。
      驗收：mock `fetch` 的單元測試涵蓋網址、逾時（含讀 body）、4xx／5xx、網路錯誤、轉址、`content` 缺漏或不是 JSON；錯誤物件與日誌不含句子、回應、金鑰；沒有新增套件。
- [ ] **T3 畫面**（依賴 T0；`ai4a-web`，Codex）：plan §1.4。
      驗收：plan §1.4 列的 W208～W214 元件測試全部通過；草稿只呼叫既有的新增交易 API、用草稿的帳本；表單 `draft` 模式不自動補空欄位；Web 檢查全綠。
- [ ] **T4 Web e2e**（依賴 T1、T3；`ai4a-e2e`，Codex）：plan §1.5。
      驗收：`ai-draft.spec.ts` 的三個斷言通過；兩套 Web e2e 全綠；Playwright 明設 `LLM_PROVIDER=fake`；跑之前確認埠沒被 2j 占用。
- [ ] **T5 整合、文件、PR、部署**（依賴 T1～T4；協調者）：plan §1.6、§4。
      驗收：GLM provider 接進 factory；隔離測試紅轉綠；`pnpm lint / typecheck / test / build / format:check` 與兩套 e2e 全綠；spec §9 的文件都改了；PR 依模板、CI 全綠、squash merge；dev 用假 provider 走過 spec §1 第 1～4、8、9 步；worker 的 worktree、分支、測試資料庫清掉。只宣稱假 provider 範圍驗收完。
- [ ] **T6 真的模型**（依賴 T5、開發者給金鑰；協調者）：plan §1.7。
      驗收：plan §1.7 的表 15 格全對，失敗也照記；模型、指示版本、token 用量記進實作紀錄。
