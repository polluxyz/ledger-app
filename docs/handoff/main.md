# 主工作區交接

## 現況與下一步

- R1、R6 已部署。主工作區已在 `5b82e4d` 建置共用程式與 API，並切換開發環境的 2 個模型設定。3200 暫時服務的第 81 次請求在 4,237 ms 回 200，取得 1 筆日期與金額正確的支出草稿。驗證未寫入交易，已登出並停止暫時服務。[Haiku 交接](ai-4a.md)
- R11 已啟用優雅關機，API 安全標頭已合併。[PR #245](https://github.com/polluxyz/ledger-app/pull/245)
- 主工作區在 `7e986d6` 以鎖定版本安裝套件，並建置共用程式與 API。3200 暫時服務的 `GET /api/users/me` 回 401，帶 `nosniff` 與 `no-referrer`。在 `5b82e4d` 的 3200 暫時服務再次確認 401 回應具備 R11 標頭。3000 常駐服務尚待確認。
- 10 月 L5 已完成 7 天觀察。平均 context 降至 85,352。快取讀取總量高於舊基準上限。[L5 實作紀錄](../../tasks/token-saving-plan.md#l5-觀察結果)

## 替開發者部署

For deployment read [部署手冊](../operations/dev-deployment.md#替開發者部署)。
