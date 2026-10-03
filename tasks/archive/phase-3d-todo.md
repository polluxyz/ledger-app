# 3d 任務清單

plan：`tasks/phase-3d-plan.md`；spec：`docs/specs/phase-3d-tx-list.md`。

- [x] **D0 shared 契約**（協調者）：`CATEGORY_ICONS`、`Category.icon`、交易 `category.icon`、預設分類的 `icon`。
      驗收：shared build、typecheck 通過。
- [x] **D1 後端**（依賴 D0；`backend`）：schema、migration 回填、分類 DTO、預設分類、交易回應。
      驗收：API 單元測試與 e2e 全綠；不在清單裡的代號 → 400；回填後既有預設分類有圖示；`prisma migrate status` 無 pending。
- [x] **D2 前端**（依賴 D0；`default`）：`lucide-react`、`CategoryIcon`、交易列、篩選、刪除移到面板、分類彈窗、總覽最近交易、e2e 調整。
      驗收：Web 單元測試全綠，涵蓋 SC-T1、T5、T6、T7；e2e 已寫好（協調者跑）。
- [x] **D3 合併與驗收**（協調者）：全套檢查、兩套 e2e、截圖驗 SC-T2～T4、PR、部署 dev。
      驗收：spec §4 全部通過；實作紀錄寫進 plan §6。
