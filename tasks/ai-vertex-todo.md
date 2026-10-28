# 4a 補充任務清單：換模型到 Vertex AI 的 DeepSeek V4.1 Flash

plan：`tasks/ai-vertex-plan.md`；spec：`docs/specs/phase-4a-ai-vertex.md`。

- [x] **T0 契約與先紅的測試**（協調者）：plan §1.1。
      驗收：API typecheck 通過；既有測試行為不變；`ai-vertex-isolation.e2e-spec.ts` 的 Vertex 斷言紅、fake 對照綠；e2e 不連 Google。
- [x] **T1 provider 與認證**（依賴 T0；`aiv-provider`，`backend`）：plan §1.2。
      驗收：SC-P33～P37 單元測試綠；`vertex` 上限 60 秒、`glm` 25 秒；日誌最後面多 `tokenMs`、`headersMs`、`bodyMs`、`reasoningTokens`；`glm-llm.provider.spec.ts` 的斷言沒改且綠；隔離 e2e 轉綠；既有 API e2e 全綠；只新增 `google-auth-library` 一個套件；套件的重試與日誌設定寫進 plan §7；原始認證例外不往外傳。
- [ ] **T2 整合、文件、PR、部署**（依賴 T1；協調者）：plan §1.3。
      驗收：全部檢查與 API e2e 綠；spec §9 的文件都改了；CI 全綠、squash merge；dev 在原本的 `LLM_PROVIDER` 下照常啟動；worker 的 worktree、分支、終端機清掉。
- [ ] **T3 真的模型**（依賴 T2 與開發者的 GCP 設定；協調者）：plan §1.4。
      驗收：SC-P40 第 1～9 項的結果填進 plan §7，失敗也照記；傳輸、語意、用量與認證 3 組分開判定；語意照決策 345；決策 344 (e) 的核對項目都有記錄；第 9 項拿掉的權限已加回。
