# 2p 統計頁結餘小圓環：todo

依據 [spec 2p](../../docs/specs/phase-2p-stats-balance-ring.md) 與 [plan](stats-balance-ring-plan.md)。每項完成後勾選並填驗收證據。

- [x] **T0 文件（協調者）**：spec、plan、todo；`docs/README.md` 規格表加 2p；2o 決策 440 加註；`docs/handoff.md` 登記決策 441～442、W330。
  - 驗收：diff 只含 `docs/specs`、`docs/README.md`、`docs/handoff*`、`tasks`；本次檔案 `prettier --check` 通過。
- [x] **T1 圓環樣式（W330、決策 441、442）**：只改 `apps/web/src/pages/StatsPage.module.css`。結餘格 `::before` 畫 72px 圓環，>600px 顯示、≤600px 隱藏；文字在圓環上方；不吃點擊；不撐出橫向捲動。`StatsPage.tsx` 不改。
  - 驗收：Web 樣式只改此 CSS；`StatsPage.test.tsx` 包含 `結餘 -$1,000` 斷言，全套 Web 單元測試 1343/1343 通過。
- [x] **T2 e2e（SC-Q1、Q3）**：`apps/web/e2e/stats.spec.ts` 加 1 個測試。淺深主題下，1280px 量 `::before` 的尺寸、位置、`pointer-events`；收入、支出格沒有圓環；600、390、320px 量 `display: none`；601px `scrollWidth` 等於視窗寬。
  - 驗收：`pnpm --filter @ledger/web test:e2e stats.spec.ts` 6/6 通過，包含新測試、SC-R21；601px 沿用無橫向溢位檢查（Windows 垂直捲軸占 15px，`scrollWidth <= clientWidth`）。
- [x] **T3 驗證與截圖（SC-Q2、Q5）**：`pnpm format:check`（本次檔案）、`lint`、`typecheck`、`test`、web build、web e2e。截淺深 × 1280／601／390 共 6 張，結餘含 9 位數負數，放 `docs/artifacts/stats-balance-ring/after/`（不進版控）。
  - 驗收：`pnpm lint`、`pnpm typecheck`、Web build、Target `prettier --check` 通過；`pnpm test` shared 161/161、API 1270/1270、Web 1328/1343（15 筆逾時），依測試環境指南以 `pnpm --filter @ledger/web exec vitest run --maxWorkers=2` 重跑 1343/1343 通過；Web e2e 修正垂直捲軸判斷後全套重跑 146/146 通過（`ledger_web_unslop_test`）。
  - 截圖：`docs/artifacts/stats-balance-ring/after/` 的 `light-1280.png`、`light-601.png`、`light-390.png`、`dark-1280.png`、`dark-601.png`、`dark-390.png`。逐張確認 1280／601px 的結餘標籤與金額皆在圓環上方，390px 無圓環。
- [x] **T4 協調者驗收與 PR**：讀完整 `git status`、`git diff`；自己重跑 typecheck、lint、web 單元測試、統計 e2e；逐張看截圖確認 SC-Q2；開 PR、CI 全綠。
  - 驗收：[PR #252](https://github.com/polluxyz/ledger-app/pull/252)。協調者在 `f16f2b6` 重跑：typecheck、lint exit 0；Web 單元測試 1343/1343；`stats.spec.ts` 6/6；本次檔案 `prettier --check` 通過。CI run 45638732854 在 `f16f2b6` 全綠（含 API E2E、Web E2E）。6 張截圖逐張看過：1280、601 的「結餘」與 `-$123,456,789` 筆畫都在圓環上方；390 無圓環。
- [x] **T5 收尾**：開發者看截圖確認後 squash merge；plan、todo 移到 `tasks/archive/`；spec 狀態改「已完成」；交接檔更新；清 worker 與測試資料庫。
  - 驗收：開發者 2026-11-26 看 6 張截圖後同意合併，並表示手機版面暫定（記在 spec 決策 442）。本 PR 內完成封存、spec 與 `docs/README.md` 改「已完成（#252）」、交接檔更新。Codex dispatch `ctx_3bb63f349f23` succeeded，終端機已釋放。已刪除 `ledger_web_unslop_test`。squash merge 在 CI 全綠後執行。
