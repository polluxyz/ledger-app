# 交接：2j 統計（`stats-2j`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-10-23）

- worktree `stats-2j`，測試資料庫 `ledger_stats_test`。
- spec `docs/specs/phase-2j-stats.md`、plan `tasks/phase-2j-plan.md`、todo `tasks/phase-2j-todo.md` 都已核可，並以 docs PR 合進 `main`。plan 經 advisor 審過一輪並依意見修訂（plan §6）。
- 寫 spec 時協調者自己補的 3 個細節，已在送審時向開發者說明並一起核可：`people` 不列收入與支出都是 0 的人；同一個回應讀同一份資料快照；新增成功條件 SC-R27～R29。
- 實作在整合分支 `feature/phase-2j-stats-impl`（從 docs PR 合併後的 `main` 開）。進度看 todo 的勾選與 plan §6 實作紀錄。
- 產出（不進版控）：`docs/artifacts/stats-ia/`（版面比較頁、圖型切換原型 `claude-4.html`、`advisor/round1.md`、`round2.md`）。
- Orca run：資訊架構提案 `run_404efb59895f`（已結束）；實作 `run_524feab581d4`。
- D0、S1a、S1b、S2、S3、W1～W5 都已合併到整合分支，沒有進行中的 worker。W5 是 D1 截圖對照時追加的圖表畫面修正。

## 下一步

D1 整體驗收（plan §4、todo 的 D1）：整合分支重跑全套檢查與兩套 e2e、重截 390px 與桌面截圖對 W220～W225、開 PR 合併、dev 照 plan §4 點一次、清 worktree 與 worker 測試資料庫。完成後 plan 與 todo 移到 `tasks/archive/`。
