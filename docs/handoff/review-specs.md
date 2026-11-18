# 交接：審查修正 spec（`review-specs`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-11-18）

- 來源：專案審查報告 [`docs/reports/2026-11-11-project-review.md`](../reports/2026-11-11-project-review.md) 的 R5、R6。
- **R6**：已完成（#227）。登入紀錄表、`POST /api/auth/logout`、網頁登出最多等 5 秒。spec [`r6-token-revocation.md`](../specs/r6-token-revocation.md)，plan 與 todo 已移到 `tasks/archive/`。合併後部署到 dev；部署後每個人要重新登入 1 次。
- **R5**：等開發者決定正式部署的位置。
- 編號：R6 用決策 373～384、W293～W296（W297～W299 保留）、`SC-TV1`～`SC-TV16`；R5 用決策 385～394、W300～W306、`SC-BK`。
- 測試資料庫：`ledger_review_test`，`apps/api/.env.test` 指向它。兩套 e2e 共用，不能同時跑。

## 下一步

1. R5：開發者決定部署位置後列假設清單，再寫 spec。

## 已知狀況

- 本機 Web Vitest 用預設並行數時，每輪有 4～13 條 5000ms 逾時，每輪是不同的測試，`main` 上也一樣。用 `pnpm --filter @ledger/web exec vitest run --maxWorkers=6` 全過。CI 不受影響。要改 Vitest 設定屬網頁範圍，派 Codex。

## 開發者的偏好

- 共用的偏好見入口檔。審查修正一律走 spec → plan → todo，核可才動工。
