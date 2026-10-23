# 交接：2j 統計（`stats-2j`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-10-23）

- 2j 實作完成，以 PR #154 合進 `main`。spec `docs/specs/phase-2j-stats.md`；plan 與 todo 已移到 `tasks/archive/phase-2j-plan.md`、`tasks/archive/phase-2j-todo.md`，驗收數字與每次退回的原因都在 plan §6。
- Orca run：資訊架構提案 `run_404efb59895f`、實作 `run_524feab581d4`，沒有進行中的 worker。worker 的 worktree、分支、測試資料庫都已清掉。
- 已知限制（spec §1）：交易頁的日期篩選用瀏覽器時區換算，統計用台灣時間。
- 效能（SC-R13）：統計端點 p95 約 260～310ms，機器有其他負載時曾量到 907～967ms。之後若變慢，先看三組查詢依序執行的時間（plan §6 S3 紀錄）。

## 下一步

- 部署到 dev 並照 plan §4 點一次（只讀不寫）。shared 與 API 都有改，照 [main](main.md)「替開發者部署」做；沒有 migration。
- 2j 沒有剩下的工作。這個工作區與 `ledger_stats_test` 可以收掉。
