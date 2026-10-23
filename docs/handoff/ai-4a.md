# 交接：4a AI 文字記帳（`ai-4a`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-10-23）

- 分支 `feature/phase-4a-ai`，worktree `ai-4a`，測試資料庫 `ledger_ai_test`。
- T0～T4、T3b 完成，T5 的 PR #155（假 provider 範圍）。各任務的 commit 與小瑕疵見 `tasks/phase-4a-plan.md` §7。
- 預覽頁（不進版控）：`docs/artifacts/step-4a-ai-draft-preview.html`。

## 下一步

1. #155 合併後在主工作區部署（spec §8），用假 provider 在 dev 走 spec §1 第 1～4、8、9 步。寫入的交易事後刪掉。
2. T6：開發者確認 GLM 方案能給 App 使用後提供金鑰與模型，只寫進主工作區的 `apps/api/.env`。照 plan §1.7 跑 15 次的表，結果另開 docs PR 記錄。
3. 費用控管之後再設。
