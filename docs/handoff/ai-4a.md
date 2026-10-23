# 交接：4a AI 文字記帳（`ai-4a`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-10-23）

- worktree `ai-4a`，測試資料庫 `ledger_ai_test`。`feature/phase-4a-ai` 已經 squash merge（#155，`f35485b`）並部署到 dev。
- T0～T5 完成，只宣稱假 provider 範圍。各任務的 commit、小瑕疵、dev 驗證結果見 `tasks/phase-4a-plan.md` §7。
- dev 的 a@a.com 在「test 的帳本」多了「早餐」「午餐」分類與「信用卡」帳戶，給假 provider 的固定句子用。
- 預覽頁（不進版控）：`docs/artifacts/step-4a-ai-draft-preview.html`。

## 下一步

1. T6：開發者確認 GLM 方案能給 App 使用後提供金鑰與模型，只寫進主工作區的 `apps/api/.env`。照 plan §1.7 跑 15 次的表，結果另開 docs PR 記錄。T6 做完把 plan、todo 移到 `tasks/archive/`，spec 改成已完成。
2. 費用控管之後再設。

## 已知問題

- 假 provider 遇到固定句子、但帳本裡沒有對應的分類或帳戶時回 500（plan 核可的行為）。劇本以外的句子回 0 筆草稿。
- `apps/web/e2e/debts.spec.ts:258`（還款）合併後失敗過 1 次，重跑都過。與 4a 無關。
