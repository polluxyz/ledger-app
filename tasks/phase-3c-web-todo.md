# 3c 畫面任務清單

plan：`tasks/phase-3c-web-plan.md`；spec：`docs/specs/phase-3c-web.md`。

- [x] **W-A 箭頭**（worker）：`DebtArrow` 與 W84 的既有畫面替換。
      驗收：元件測試證明箭頭方向、金額、讀屏文字；SC-W78。
- [x] **W-B 記帳表單**（依賴 W-A；worker）：W62～W73、W78、W79、`use-splits.ts`。
      驗收：元件測試涵蓋 SC-W72～SC-W75 與送出的端點、body。
- [x] **W-C 列表、往來帳、待確認卡片、錯誤訊息**（依賴 W-A；worker）：W74～W77、W80、W81、W85～W88。
      驗收：元件測試涵蓋 SC-W76、SC-W77、SC-W79。
- [x] **W-D Web e2e**（依賴 W-B、W-C；worker 寫、協調者跑）：SC-W80；修既有 e2e。
      驗收：後端合併後 Web e2e 全綠（SC-W81）。
- [x] **W-E 手動驗收**（協調者）：dev 環境 5 個情境、截圖。
