# 任務清單：AI 記帳入口改成圖示，首頁也能用

plan：[`tasks/ai-icon-entry-plan.md`](ai-icon-entry-plan.md)；spec：[`docs/specs/phase-4a-ai-text.md`](../docs/specs/phase-4a-ai-text.md) §2.4。

- [ ] **T0 spec 與通知**（協調者）：spec、plan、todo 送開發者核可；核可後開 docs PR 合併；照 plan §6 通知 stats-2j session。
      驗收：docs PR CI 全綠、squash merge；stats-2j 收到 3 個接點、3 條界線與給 PR3 的驗收需求。
- [ ] **T1 共用狀態、圖示入口、兩頁接線**（依賴 T0；ai-icon worktree，Codex `default`）：plan §2.1～§2.5。
      驗收：
  - `pnpm --filter @ledger/web lint`、`typecheck`、`test` 全綠。
  - 元件與單元測試涵蓋 W246～W254：圖示的 3 種狀態、W248 (a)～(e)、錯誤浮在輸入欄下方且橫條高度不變、4 種清除時機、世代號碼丟掉舊回應、解析鎖跨兩頁、寫入鎖與編輯占用、全部確認的候選名單、登出後停止、不能寫入的草稿。
  - `AiDraftInput.test.tsx:78` 的舊斷言已改成新的錯誤位置。
  - 不改 `PageToolbarSlotProvider` 的責任；`HomePage.tsx` 的改動限 plan §2.5 的 3 處；`apps/web` 以外沒有改動。
- [ ] **T2 Web e2e**（依賴 T1；同一個 worker）：plan §2.6。
      驗收：跑之前向協調者確認沒有其他 worktree 在跑 e2e；`pnpm --filter @ledger/web test:e2e` 全綠，含 SC-P28～P31 與首頁的 §1 第 1～4 步。
- [ ] **T3 驗收**（依賴 T2；協調者）：plan §5。
      驗收：逐行看 diff，特別看鎖與世代判斷；自己重跑 lint、typecheck、test、format:check、build、兩套 e2e，記實際數字；SC-P32 的 390／900／901px、右側欄開關、`backdrop-filter`、手機虛擬鍵盤逐項記結果；偏離寫進 plan §8。
- [ ] **T4 PR、部署、清理**（依賴 T3；協調者）：
      驗收：PR 照模板寫 3 節，CI 全綠、squash merge；主工作區部署 dev，提醒開發者 `Ctrl + Shift + R`；`docs/handoff.md`、`docs/handoff/ai-4a.md`、`CLAUDE.md` §4（如需要）併進這個 PR；worker 的 worktree、分支、終端機清掉；plan 與 todo 移到 `tasks/archive/`。
