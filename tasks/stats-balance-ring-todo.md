# 2p 統計頁結餘小圓環：todo

依據 [spec 2p](../docs/specs/phase-2p-stats-balance-ring.md) 與 [plan](stats-balance-ring-plan.md)。每項完成後勾選並填驗收證據。

- [ ] **T0 文件（協調者）**：spec、plan、todo；`docs/README.md` 規格表加 2p；2o 決策 440 加註；`docs/handoff.md` 登記決策 441～442、W330。
  - 驗收：diff 只含 `docs/specs`、`docs/README.md`、`docs/handoff*`、`tasks`；本次檔案 `prettier --check` 通過。
- [ ] **T1 圓環樣式（W330、決策 441、442）**：只改 `apps/web/src/pages/StatsPage.module.css`。結餘格 `::before` 畫 72px 圓環，>600px 顯示、≤600px 隱藏；文字在圓環上方；不吃點擊；不撐出橫向捲動。`StatsPage.tsx` 不改。
  - 驗收：diff 只動這個 CSS 檔；`StatsPage.test.tsx` 照樣通過。
- [ ] **T2 e2e（SC-Q1、Q3）**：`apps/web/e2e/stats.spec.ts` 加 1 個測試。淺深主題下，1280px 量 `::before` 的尺寸、位置、`pointer-events`；收入、支出格沒有圓環；600、390、320px 量 `display: none`；601px `scrollWidth` 等於視窗寬。
  - 驗收：新測試通過；SC-R21 與既有統計 e2e 通過。
- [ ] **T3 驗證與截圖（SC-Q2、Q5）**：`pnpm format:check`（本次檔案）、`lint`、`typecheck`、`test`、web build、web e2e。截淺深 × 1280／601／390 共 6 張，結餘含 9 位數負數，放 `docs/artifacts/stats-balance-ring/after/`（不進版控）。
  - 驗收：所有指令結果與通過數；6 張截圖路徑。
- [ ] **T4 協調者驗收與 PR**：讀完整 `git status`、`git diff`；自己重跑 typecheck、lint、web 單元測試、統計 e2e；逐張看截圖確認 SC-Q2；開 PR、CI 全綠。
  - 驗收：PR 連結、CI 結果、截圖核對紀錄。
- [ ] **T5 收尾**：開發者看截圖確認後 squash merge；plan、todo 移到 `tasks/archive/`；spec 狀態改「已完成」；交接檔更新；清 worker 與測試資料庫。
  - 驗收：main 上的合併 commit；`tasks/archive/` 有兩個檔案。
