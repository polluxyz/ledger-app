# 交接：4a AI 文字記帳（`ai-4a`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-10-21）

- 分支 `feature/phase-4a-ai`，worktree `ai-4a`，測試資料庫 `ledger_ai_test`。
- spec `docs/specs/phase-4a-ai-text.md` 只在這條分支上，還沒進 main。狀態：已核可（「AI 先這樣試試」）。
- 預覽頁（不進版控）：`docs/artifacts/step-4a-ai-draft-preview.html`。

## 下一步

寫 `tasks/phase-4a-plan.md`、`-todo.md` → 核可 → docs PR → 實作，先用假 provider。開發者確認 GLM 方案能給 App 使用後提供金鑰，金鑰只放 `apps/api/.env`；接上後跑 SC-P10。費用控管之後再設。
