# 交接：審查修正 spec（`review-specs`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-11-18，主工作區交接）

- 來源：專案審查報告 [`docs/reports/2026-11-11-project-review.md`](../reports/2026-11-11-project-review.md) 的 R5、R6。報告說這 2 項要先寫 spec 討論。
- R1 防重複送出已由主工作區完成（#222 spec、#223 實作），可參考它的 spec、plan、todo 寫法（`docs/specs/` 與 `tasks/archive/`）。
- 還沒有分支、spec 或測試資料庫。動工時再開 `docs/` 分支與測試資料庫（例如 `ledger_review_test`），`.env.test` 指向它，就能和其他工作區平行跑 API e2e。
- 編號：R6 用決策 373～384、W293～W299、`SC-TV`；R5 用決策 385～394、W300～W306、`SC-BK`。

## 下一步

1. **R6 登出讓憑證失效**（中優先）：`JWT_EXPIRES_IN` 預設 7 天，登出只清前端。報告建議「縮短效期」或「使用者資料加憑證版本欄位」。後者是資料模型變更，要先問。依 CLAUDE.md §5 先列假設清單給開發者確認，再寫 spec；拍板前先問 `advisor`。
2. **R5 備份與還原**：排程備份與還原演練文件。要先請開發者決定正式部署的位置（決定備份工具與排程方式），沒有答案前只能寫 dev 的人工程序。
3. 兩份 spec 都核可後，plan 與 todo 一起送審，再依 §5 做到完。

## 開發者的偏好

- 共用的偏好見入口檔。審查修正一律走 spec → plan → todo，核可才動工。
