# 3b-2 修訂 2 任務清單

plan：`tasks/phase-3b2-revision2-plan.md`；spec：`docs/specs/phase-3b2-web.md` §11。

- [ ] **T1 新增 `CounterpartyProfile`**：顯示 W52 的資料列與 W53 的按鈕；對話框從 `CounterpartyDetail` 搬來。
      驗收：元件測試證明已連動顯示帳號名稱、有暱稱才顯示暱稱列、沒有任何欠款文字（SC-W61）；未連動且無紀錄才有「刪除對象」。
- [ ] **T2 精簡 `CounterpartyDetail`**（依賴 T1）：只留帳（W55）。
      驗收：元件測試證明沒有五個管理按鈕、有餘額與記一筆（SC-W63）。
- [ ] **T3 改 `CounterpartiesPage`**（依賴 T1）：右側欄改放「對象」；不掛新增交易。
      驗收：頁面測試證明按叉叉後右側欄收起、沒有「新增一筆交易」（SC-W62）；W41 導覽仍打開指定的人。
- [ ] **T4 更新 e2e**（依賴 T1～T3）：管理動作改在對象頁；加叉叉收起的檢查。
      驗收：兩套 e2e 全綠（SC-W66）。
- [ ] **T5 全套檢查與手動驗證**（協調者）：lint、typecheck、test、build、format:check；dev 環境截圖。
