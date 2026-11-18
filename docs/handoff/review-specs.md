# 交接：審查修正 spec（`review-specs`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-11-18）

- 來源：專案審查報告 [`docs/reports/2026-11-11-project-review.md`](../reports/2026-11-11-project-review.md) 的 R5、R6。
- **R6**：開發者核可 10 條假設與 3 項先問事項（新表、登出端點與憑證多 `sid`、`JwtPayload` 加 `sid`）。`advisor` 談 2 輪，沒有分歧。spec [`r6-token-revocation.md`](../specs/r6-token-revocation.md) 開發者 2026-11-18 核可（含登出最多等 5 秒）。plan 與 todo 在分支 `docs/r6-token-revocation` 送審中。
- **R5**：等開發者決定正式部署的位置。
- 編號：R6 用決策 373～384、W293～W296（W297～W299 保留）、`SC-TV1`～`SC-TV16`；R5 用決策 385～394、W300～W306、`SC-BK`。
- 測試資料庫：還沒建。R6 動工時建 `ledger_review_test`，`apps/api/.env.test` 指向它。

## 下一步

1. R6 plan 與 todo 核可後，開 docs PR（spec、plan、todo）合進 `main`。
2. 核可後依 CLAUDE.md §5 做到完：授權測試先寫先紅（SC-TV1、2、5、6）；auth 與 migration 派 `backend`；網頁派 Codex。
3. R5：開發者決定部署位置後列假設清單，再寫 spec。

## 開發者的偏好

- 共用的偏好見入口檔。審查修正一律走 spec → plan → todo，核可才動工。
