# 交接：2j 統計（`stats-2j`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-10-21）

- 分支 `feature/phase-2j-stats`，worktree `stats-2j`，測試資料庫 `ledger_stats_test`。
- spec `docs/specs/phase-2j-stats.md` 只在這條分支上，還沒進 main。狀態：核可中，§10 的 10 項要跟開發者確認。
- 預覽頁（不進版控）：`docs/artifacts/step-2j-stats-preview.html`（v2，首頁加資產趨勢圖）。
- 分期與口徑的研究：advisor（Codex gpt-6-astra high，開發者指定）的報告結論已寫進 spec。

## 下一步

跟開發者確認 spec §10（API、歸屬規則、固定分組、明細、期間上限、效能量法、資產定義、初始餘額、資產 API）→ 寫 `tasks/phase-2j-plan.md`、`-todo.md` → 核可 → docs PR → 實作。
