# 主工作區交接

## 現況與下一步

- R1、R6 已部署。主工作區已在 `5b82e4d` 建置共用程式與 API，並切換開發環境的 2 個模型設定。3200 暫時服務的第 81 次請求在 4,237 ms 回 200，取得 1 筆日期與金額正確的支出草稿。驗證未寫入交易，已登出並停止暫時服務。[Haiku 交接](ai-4a.md)
- R11 已啟用優雅關機，API 安全標頭已合併。[PR #245](https://github.com/polluxyz/ledger-app/pull/245)
- 主工作區在 `7e986d6` 以鎖定版本安裝套件，並建置共用程式與 API。3200 暫時服務的 `GET /api/users/me` 回 401，帶 `nosniff` 與 `no-referrer`。在 `5b82e4d` 的 3200 暫時服務再次確認 401 回應具備 R11 標頭。其後已在 3000 埠實測同一路徑，回 401 且兩個標頭齊全。
- 10 月 L5 已完成 7 天觀察。平均 context 降至 85,352。快取讀取總量高於舊基準上限。[L5 實作紀錄](../../tasks/token-saving-plan.md#l5-觀察結果)

## 工作區追蹤

- [Web 規劃者](web-unslop.md) 已在原工作區接手。R5 已選自管 Linux。[審查線](review-specs.md) 和 [AI 線](ai-4a.md) 分別追蹤借還與語音驗收。
- 文件用量、安全標頭、Haiku 工作用 [#243](https://github.com/polluxyz/ledger-app/pull/243)、[#245](https://github.com/polluxyz/ledger-app/pull/245)、[#247](https://github.com/polluxyz/ledger-app/pull/247) 保存。本輪已釋放對應工作區，保留分支。

### 2026-11-21 整理紀錄

已從 5 個保留工作區的兩份 API 設定實際連線，10 次均回傳各區專屬測試庫。資料庫分配見[測試環境](../operations/test-environment.md)。

開始時共 10 個工作區。核對 Git、派工與對話後，未發現同一份交付物有 2 個執行中的寫入者。首頁的問題是對話角色錯置。借還先核對歷史證據，再做隔離補驗。語音也沿用原任務。工作區上下層調整不會轉移進行中的派工。

| 工作區           | 整理前上層 | 整理前分支                | 任務與對話狀態                                              | 負責人與處置或重查時機                            |
| ---------------- | ---------- | ------------------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| main             | 無         | main                      | 跨線協調，對話執行中                                        | 主區協調者，每週日補查                            |
| web-unslop       | main       | feature/web-unslop        | 舊規劃回合結束，已交給新規劃者                              | Web 規劃者，首頁規格送審時                        |
| ai-4a            | main       | docs/ai-haiku-t3          | AI 線，無開啟對話                                           | 主區聯絡 AI 線，語音現場與匯入規劃銜接時          |
| voice-acceptance | main       | polluxyz/voice-acceptance | 語音 worker 回合結束，派工等開發者；有未提交記錄表          | 移至 ai-4a，語音負責人約到現場時                  |
| review-specs     | main       | docs/r5-backup-restore    | R5 規劃等 3 項回答；舊 F12 唯讀對話已結束，仍保留原因待確認 | 審查線協調者，收到 R5 回答或週日                  |
| debt-f12-close   | main       | polluxyz/debt-f12-close   | F12 補驗已保存於 #246，worker 已釋放                        | 移至 review-specs，人工驗收及誤建處理有結果時重查 |
| docs-usage-close | main       | polluxyz/docs-usage-close | #243 結案，worker 由 Orca 保留                              | 主區已釋放對話並移除工作區                        |
| r11-headers      | main       | fix/r11-headers           | #245 結案，worker 由 Orca 保留                              | 主區已釋放對話並移除工作區                        |
| ai-4a-haiku-t3   | ai-4a      | docs/close-haiku-t3       | #247 結案，對話已釋放，工作區仍在的原因待確認               | 主區已移除工作區                                  |
| agent-input      | main       | docs/agent-input          | #241 結案，無開啟對話，原保留原因待確認                     | 主區沿用本區修改派工文件；本次合併後移除          |

## 替開發者部署

For deployment read [部署手冊](../operations/dev-deployment.md#替開發者部署)。
