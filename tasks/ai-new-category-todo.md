# 4a 補充任務清單：AI 提議新分類

plan：`tasks/ai-new-category-plan.md`；spec：`docs/specs/phase-4a-ai-new-category.md`。

- [ ] **T0 契約與隔離測試**（協調者）：plan §1.1。
      驗收：`pnpm --filter @ledger/shared build` 通過；`isDraftComplete` 測試綠（有提議算完整、兩者都沒有不完整）；隔離 e2e 紅燈，404／403／409 都有正向對照並斷言分類數不變；API／Web typecheck 通過。
- [ ] **T1 寫入 API**（依賴 T0；`ainc-api`，`backend`）：plan §1.2。
      驗收：SC-P14 第 1～5 項綠；隔離 e2e 轉綠；既有 API e2e 全綠；不帶 `newCategoryName` 的請求行為不變；`findOrCreateByName` 不用 `catch P2002`。
- [ ] **T2 解析**（依賴 T0；`ainc-parse`，`default`）：plan §1.3。
      驗收：SC-P13 單元測試涵蓋決策 283 (a)～(e)、同名轉換、51 字；提示詞拿掉「不能新增分類」「不要硬選相近的」；`ai-parse.e2e-spec.ts` 全綠（含改過的 SC-P6）。
- [ ] **T3 畫面**（依賴 T0；`ainc-web`，Codex）：plan §1.4。
      驗收：W240～W244 元件測試綠；改選現有分類不送 `newCategoryName`；寫入後分類查詢失效；Web 檢查全綠。
- [ ] **T4 Web e2e**（依賴 T1、T2、T3；`ainc-e2e`，Codex）：plan §1.5。
      驗收：3 個情境通過；兩套 Web e2e 全綠；Playwright 明設 `LLM_PROVIDER=fake`。
- [ ] **T5 整合、文件、PR、部署**（依賴 T1～T4；協調者）：plan §1.6。
      驗收：全部檢查與 e2e 綠；spec §9 的文件都改了；CI 全綠、squash merge；dev 走過 spec §1 第 2、3、6、7 步；worker 的 worktree、分支、終端機清掉。
- [ ] **T6 真的模型**（依賴 T5；協調者）：plan §1.7。
      驗收：SC-P17 的 15 格與回歸的 9 格全對，失敗也照記；模型、提示詞版本、token 用量記進實作紀錄。
