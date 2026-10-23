# 交接：4a AI 文字記帳（`ai-4a`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-10-23）

- 分支 `feature/phase-4a-ai`，worktree `ai-4a`，測試資料庫 `ledger_ai_test`。
- spec `docs/specs/phase-4a-ai-text.md` 已核可（「AI 先這樣試試」）。plan `tasks/phase-4a-plan.md`、todo `tasks/phase-4a-todo.md` 2026-10-23 核可，連同 spec 的修正（plan §5）走 docs PR 進 main。
- 預覽頁（不進版控）：`docs/artifacts/step-4a-ai-draft-preview.html`。

## 下一步

docs PR 合併後把 main 併回分支 → T0（協調者）→ 平行派 T1、T2、T3 → T4 → T5，先用假 provider。開發者確認 GLM 方案能給 App 使用後提供金鑰，金鑰只放 `apps/api/.env`；接上後跑 SC-P10。費用控管之後再設。
