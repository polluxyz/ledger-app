# 4a 補充任務清單：換模型到 Vertex AI 的 Claude Haiku 5.5

plan：`tasks/ai-haiku-plan.md`；spec：`docs/specs/phase-4a-ai-haiku.md`。

- [ ] **T0 契約與先紅的測試**（協調者）：plan §1.1。
      驗收：API typecheck 通過；既有測試行為不變；`ai-haiku-isolation.e2e-spec.ts` 的 SC-P45、SC-P48、SC-P49 斷言紅、fake 對照綠；e2e 不連 Google。
- [ ] **T1 共用傳輸與 provider**（依賴 T0；`aih-provider`，`backend`）：plan §1.2。
      驗收：第 1 步的抽取單獨 commit，`openai-compatible-llm.provider.spec.ts`、`glm-llm.provider.spec.ts`、`google-access-token-source.spec.ts` 內容沒改且綠；SC-P41～P47、SC-P50 單元測試綠；隔離 e2e 轉綠且內容沒改；既有 API e2e 全綠；沒有新套件；未知的 `stop_reason` 與拒答文字不進任何回傳值與日誌。
- [ ] **T2 整合、文件、PR、部署**（依賴 T1；協調者）：plan §1.3。
      驗收：全部檢查與 API e2e 綠；spec §9 的文件都改了；CI 全綠、squash merge；dev 在原本的 `LLM_PROVIDER=vertex` 下照常啟動；worker 的 worktree、分支、終端機、資料庫清掉。
- [ ] **T3 真的模型**（依賴 T2 與開發者核對 GCP 設定；協調者）：plan §1.4。
      驗收：SC-P51、SC-P52 的結果填進 plan §7，失敗也照記；總次數 ≤100、每次輸入 ≤14,760 token；傳輸、語意、用量 3 組分開判定；語意照決策 345；主工作區 `.env` 已切到 Haiku 且送 1 句確認；報告不含專案 ID 與帳號資訊。
