# 3g 任務清單

plan：`tasks/phase-3g-plan.md`；spec：`docs/specs/phase-3g-debts-inline.md`。

- [x] **G0 整合分支、契約與隔離測試**（協調者）：從 `polluxyz/debts-inline` 開 `feature/debts-inline`；plan §1.1。
      驗收：`pnpm --filter @ledger/shared build` 通過；`debts-inline-isolation.e2e-spec.ts` 紅燈（端點或參數還不存在）；API／Web typecheck 只剩「新欄位未實作」的錯誤。
- [x] **G1 綁定差額**（依賴 G0；`di-bind`，與 G2～G5 平行）：plan §1.2 第 1 項。先把 migration SQL 列給開發者看，同意後才套用到 worker 資料庫以外的地方。
      驗收：`prisma migrate status` 無 pending；單元測試涵蓋少收、多收、剛好還清、沒綁定的舊差額、修改前後兩筆合計不變；SC-G3、G4、G5 的 API e2e 通過。
- [x] **G2 已還清與過濾**（依賴 G0；`di-history-api`）：plan §1.2 第 2 項。
      驗收：SC-G1、G2 的 API e2e 通過；不帶新參數時回應與現在相同；隔離測試的對象部分轉綠。
- [x] **G3 結清清單**（依賴 G0；`di-settlements-api`）：plan §1.2 第 3 項。
      驗收：SC-G6 的 API e2e 通過；隔離測試的帳本部分轉綠；沒標 `@LeftMemberAccess` 的路由行為不變。
- [x] **G4 借還畫面：總覽、個人、往來紀錄**（依賴 G0；`di-web-debts`）：plan §1.3 第一列。
      驗收：元件測試涵蓋個人分頁帶 `personalNonZero`、展開區帶 `section=outstanding`、載入更多、綁定差額沒有「⋯」；`debt-entry-history.ts` 已刪除；Web 檢查全綠。
- [x] **G5 借還畫面：共享、歷史**（依賴 G0；`di-web-history`）：plan §1.3 第二列。
      驗收：元件測試涵蓋已退出且未結清的唯讀卡片、已結清的已退出帳本不出現、歷史兩段改用 API、結清的修改與撤銷、已退出帳本的結清沒有「⋯」；Web 檢查全綠。
- [x] **G6 API e2e**（依賴 G1～G3；`di-api-e2e`）：`debts-inline.e2e-spec.ts` 一條情境走完 SC-G1～G6；既有 API e2e 回歸。
      驗收：新舊 API e2e 全綠；`hasHistory` 在 100 個對象、每個 20 筆時 < 500ms（數字記進 plan §6）。
- [x] **G7 Web e2e**（依賴 G1～G5；`di-web-e2e`）：受影響的 Web e2e 改成新版面；spec §6 的兩條主線。
      驗收：兩套 Web e2e 全綠。
- [x] **G8 整體驗收與 PR**（協調者）：plan §4。
      驗收：隔離測試由紅轉綠；前端捷徑 grep 無結果；`pnpm lint / typecheck / test / build / format:check` 與兩套 e2e 全綠；spec §8 的文件影響都改了（3f、3e-web 標「由 3g 取代」，原型筆記移到 `tasks/archive/`）；PR 依模板填寫、CI 全綠、squash merge。
- [x] **G9 部署與收尾**（協調者）：問開發者要不要部署到 dev；要的話先 `pg_dump` 備份 `ledger_dev` 再 `migrate deploy`。清 worker 與整合分支的 worktree、分支、終端機；測試資料庫的刪除清單先給開發者看，保留 `ledger_dev` 與 `ledger_test`。
      驗收：`orca worktree list` 沒有 `di-*` 與 `debts-inline`；`git branch` 沒有已合併的分支；memory「階段三進度」更新。
