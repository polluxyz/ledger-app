# 4a 補充任務清單：語音記帳（桌機 Chrome，Web Speech API）

plan：`tasks/ai-voice-plan.md`；spec：`docs/specs/phase-4a-voice.md`。

- [x] **T0 假辨識器與先紅的隔離測試**（協調者）：plan §1.1。
      驗收：Web typecheck、lint 綠；`AiEntry.voice-isolation.test.tsx` 只因「找不到麥克風按鈕」而紅；既有測試全綠；沒有改正式程式。
- [ ] **T1 語音 hook 與畫面**（依賴 T0；`aiv-voice-ui`，`default` 的 Codex）：plan §1.2。
      驗收：SC-SR1～SR12 單元測試綠；T0 的隔離測試轉綠且斷言沒改；既有 AI 測試內容沒改且綠；`ai-voice.spec.ts` 寫好 SC-SR13 第 1～3 項；只改 `apps/web`；沒有新套件；語音流程沒有呼叫 `parse()`；沒有 log 或 `localStorage` 寫辨識文字。
- [ ] **T2 整合、文件、PR、部署**（依賴 T1；協調者）：plan §1.3。
      驗收：lint、typecheck、test、format:check、build 綠；全部 Web e2e 綠（含 SC-SR13）；2 處突變檢查都會變紅；spec §9 的上游加註與交接檔改好；CI 全綠、squash merge；主工作區 `git pull` 完成；worker 的 worktree、分支、終端機清掉。
- [ ] **T3 真實驗收**（依賴 T2；開發者現場，協調者記錄）：plan §1.4。
      驗收：SC-SR16 冒煙、SC-SR14 20 句、SC-SR15 6 種逆境的結果填進 plan §7，失敗也照記；最多 26 次解析；測前測後交易筆數相同；門檻結果照實報告。
- [ ] **T4 收尾**（依賴 T3；協調者）：plan §1.5。
      驗收：`專案決策脈絡.md`、`CLAUDE.md` §4 更新；plan 與 todo 移到 `tasks/archive/`；docs PR 合併。
