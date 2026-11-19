# review-specs 交接

R6 已合併並部署 dev。登出後使用舊憑證，dev 回應 401。[部署紀錄 #229](https://github.com/polluxyz/ledger-app/pull/229)

R5 的備份與還原方案取決於正式部署位置。等開發者在本區定案，再列假設並送審規格。[專案審查報告](../reports/2026-11-11-project-review.md)

2026-11-18 已向開發者列出 3 個選項。開發者還沒選，也還沒徵詢 advisor。開發者要建議時，先依 [§1.1](../orca-multi-agent.md) 徵詢 advisor，再並列雙方看法。

1. 自己的 Linux 主機：排程跑 `pg_dump`，備份複製到別處。最省錢，排程與監控要自己寫。
2. GCP 的 Cloud Run 加 Cloud SQL：內建每日備份與時間點還原，R5 只要寫還原演練。要付月費。
3. 先留在這台 Windows 電腦：用工作排程器跑 `pg_dump`，備份要另外複製到別處。

## 操作限制

- R5 保留的編號見[交接入口](../handoff.md)。 Start only after approval of the spec, then the plan and task list.
- Run this workspace’s two e2e suites separately. Both use `ledger_review_test`.
- For local Web unit tests use `pnpm --filter @ledger/web exec vitest run --maxWorkers=6`. 預設並行數曾使不同測試逾時。[歷史交接](https://github.com/polluxyz/ledger-app/blob/d190f4fd76c6f261e0bd84ff68d43eb46b2c4f25/docs/handoff/review-specs.md)
