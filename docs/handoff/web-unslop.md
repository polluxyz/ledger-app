# web-unslop 工作區交接

## 2026-11-25 協調者交接（2p 統計結餘小圓環：spec 待核可）

### 現況

- PR #251（2o）已合併。plan 與 todo 已封存到 `tasks/archive/pages-unslop-*.md`。
- 分支 `feature/web-stats-balance-ring`（從 main `a624686` 開），本工作區沿用。尚無 PR。
- 2p 文件已寫好，待開發者核可：[spec](../specs/phase-2p-stats-balance-ring.md)、[plan](../../tasks/stats-balance-ring-plan.md)、[todo](../../tasks/stats-balance-ring-todo.md)。編號：決策 441～442、W330、SC-Q1～Q5。
- 手機處理徵詢 Run `run_7dac744bf093`：Codex（`ctx_9b2ec55ee385`）與 Gemini（`ctx_a32283f56725`）都建議 ≤600px 隱藏，兩個 dispatch 都 succeeded。開發者 11-25 選隱藏。
- 未追蹤的 `.agents/skills/unslop/` 不提交。`docs/artifacts/` 截圖不提交。

### 下一步

1. 開發者核可後，在 spec §8 記核可、README 狀態改「進行中」，派 Codex `default` 做 todo T1～T3（同一個 Task，本工作區）。
2. 驗收照 todo T4：讀完整 diff；自己重跑 typecheck、lint、web 單元測試、統計 e2e；逐張看 6 張截圖。
3. e2e 需要 `ledger_web_unslop_test`（11-25 已刪，需重建，見 `docs/operations/test-environment.md`）。

### 開發者決定紀錄

- 11-25 2p：桌機 72px 圓環（決策 441）；手機 ≤600px 隱藏（決策 442）。
- 11-24：修同色分類；「趨勢」改「每月收支」；拿掉成員分頁與帳本／我切換，改漏斗篩選；全站點綴三種方向都做，demo 時挑；同意改 API；全部留在 #251（決策 424～432）。
- 11-24 demo：先標明「已結 N 月均」（決策 433）。
- 11-25 demo：移動平均直接放 #251、窗口 6 個月、開帳後前 5 個月依實際月數；篩選面板改多欄；demo 資料要多、要多樣（決策 435～437）。
- 11-25 點綴：第 9～11 組都留；首頁「＋ 新增交易」、分類頁「新增收入分類」維持金色主動作；危險區補回淡紅外框（決策 438、439，第 15 組 T26）；統計結餘小圓環另開 PR（決策 440）。
- 開發者偏好：先讓開發者看到比對畫面，並直接說明每組改了畫面哪裡，再請開發者選。

### 已清理（11-25 經開發者同意）

- 測試資料庫 `ledger_web_unslop_test`、`ledger_web_unslop_demo_test` 已刪；demo 伺服器 3200、5190、5181 已停；舊分支 `feature/web-unslop-pages` 本機與遠端都已刪。
- 新 PR 若需資料庫測試，重建 `ledger_web_unslop_test`（見 `docs/operations/test-environment.md`）。
