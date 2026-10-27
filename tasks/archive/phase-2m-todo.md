# 首頁風格實裝任務

依據：[spec](../../docs/specs/phase-2m-home-visual-refresh.md)、[plan](phase-2m-plan.md)。Codex 負責 Web 設計與實裝，Claude Code 依使用者要求負責最後驗收。

- [x] V1 財務趨勢與動畫（Codex）：切換左資產／右結餘、整數分原值、零線與正負柱、錯誤狀態、鍵盤、快速切換與動畫開關。驗證 SC-V1～V4、V7。
- [x] V2 借還與視覺（Codex，可與 V1 介面獨立）：雙端頭像、正確付款方向、兩清、零錢、長名稱，首頁層次與清單。驗證 SC-V5、V6。
- [x] V3 整合檢查（Codex，依賴 V1／V2）：format、lint、typecheck、test、build；首頁與版面編輯 e2e，記錄實際數字、畫面與偏離。
- [x] V4 獨立驗收（Claude Code，依賴 V3）：讀完整 diff 與 spec，自行重跑必要檢查、驗收自訂版面與動畫，再依 repo 流程處理 PR。Codex 交接後停止寫入。
