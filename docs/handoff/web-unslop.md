# web-unslop 工作區交接

## 2026-11-25 協調者交接（2o 已合併，下一步統計結餘小圓環 spec）

### 現況

- PR #251（2o 第 1～15 組）squash merge 進 main。plan 與 todo 已封存到 `tasks/archive/pages-unslop-plan.md`、`tasks/archive/pages-unslop-todo.md`。
- 第 2 輪 Run `run_2cc1c21e985d`：所有 task completed，所有 dispatch 已 release。
- 未追蹤的 `.agents/skills/unslop/` 不提交。`docs/artifacts/` 截圖不提交。

### 下一步：統計結餘小圓環（決策 440）

- 分支 `feature/web-stats-balance-ring`（從 main `a624686` 開），本工作區沿用。尚無 spec、無 PR。
- 概念：把首頁結餘卡的金色圓環（`apps/web/src/features/home/HomeCard.module.css` 的 `.summaryDecoration::after`，150px 細線圓＋16px 淡金外圈）縮小後，放到統計頁收支摘要的「結餘」格右下角（`apps/web/src/pages/StatsPage.tsx` 的 `styles.net`，`StatsPage.module.css` 的 `.summary dl > .net`）。純裝飾，`aria-hidden`。
- 開發者 11-25 看 mockup 後**偏好方案 A：72px**（首頁的一半，等比縮小位置與外圈：right -16px、bottom -30px、外圈 8px）。mockup 在 `docs/artifacts/stats-balance-ring/mockup.html`（不提交）。
- **待開發者決定**：手機 ≤600px 摘要三格改上下排列，結餘格變矮、金額靠右，72px 圓環會壓在數字後面。選項：縮小（mockup 用 56px）或手機隱藏。提問前照 §1.1 先問兩位 advisor（Codex，再 Gemini），並給開發者看 mockup ⑤。
- 接手步驟：
  1. 問完手機處理後，寫 spec（建議 `docs/specs/phase-2p-stats-balance-ring.md`，先確認 README 沒有 2p），含目標、只改網頁、深淺主題、390px 不擋數字、裝飾不吃點擊、測試策略、成功條件。
  2. spec 與 plan／todo 一起送開發者核可，再派 Codex `default` 實作。
  3. 驗收：讀完整 diff；typecheck、lint、web `vitest run --maxWorkers=8`、改動檔格式；淺深 × 1280／390 截圖確認結餘數字未被遮。
- 用新編號：決策從 441 起、W 從 W330 起，向 main 登記。

### 開發者決定紀錄

- 11-24：修同色分類；「趨勢」改「每月收支」；拿掉成員分頁與帳本／我切換，改漏斗篩選；全站點綴三種方向都做，demo 時挑；同意改 API；全部留在 #251（決策 424～432）。
- 11-24 demo：先標明「已結 N 月均」（決策 433）。
- 11-25 demo：移動平均直接放 #251、窗口 6 個月、開帳後前 5 個月依實際月數；篩選面板改多欄；demo 資料要多、要多樣（決策 435～437）。
- 11-25 點綴：第 9～11 組都留；首頁「＋ 新增交易」、分類頁「新增收入分類」維持金色主動作；危險區補回淡紅外框（決策 438、439，第 15 組 T26）；統計結餘小圓環另開 PR（決策 440）。
- 開發者偏好：先讓開發者看到比對畫面，並直接說明每組改了畫面哪裡，再請開發者選。

### 已清理（11-25 經開發者同意）

- 測試資料庫 `ledger_web_unslop_test`、`ledger_web_unslop_demo_test` 已刪；demo 伺服器 3200、5190、5181 已停；舊分支 `feature/web-unslop-pages` 本機與遠端都已刪。
- 新 PR 若需資料庫測試，重建 `ledger_web_unslop_test`（見 `docs/operations/test-environment.md`）。
