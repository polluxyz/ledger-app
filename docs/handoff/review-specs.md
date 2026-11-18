# review-specs 交接

R6 已合併並部署 dev。登出後使用舊憑證，dev 回應 401。[部署紀錄 #229](https://github.com/polluxyz/ledger-app/pull/229)

R5 的備份與還原方案取決於正式部署位置。等開發者在本區定案，再列假設並送審規格。[專案審查報告](../reports/2026-11-11-project-review.md)

## 操作限制

- R5 保留的編號見[交接入口](../handoff.md)。規格、計畫與任務清單依序核可才動工。
- 本區兩套端對端測試共用 `ledger_review_test`，須分開跑。
- 本機 Web 單元測試使用 `pnpm --filter @ledger/web exec vitest run --maxWorkers=6`。預設並行數曾使不同測試逾時。[歷史交接](https://github.com/polluxyz/ledger-app/blob/d190f4fd76c6f261e0bd84ff68d43eb46b2c4f25/docs/handoff/review-specs.md)
