# web-unslop 工作區交接

## 2026-11-25 協調者交接（2o 已合併，下一步統計結餘小圓環）

### 現況

- PR #251（2o 第 1～15 組）squash merge 進 main。plan 與 todo 已封存到 `tasks/archive/pages-unslop-plan.md`、`tasks/archive/pages-unslop-todo.md`。
- 第 2 輪 Run `run_2cc1c21e985d`：所有 task completed，所有 dispatch 已 release。
- 未追蹤的 `.agents/skills/unslop/` 不提交。`docs/artifacts/` 截圖不提交。

### 下一步：統計結餘小圓環（決策 440）

- 開發者 11-25 選：把首頁結餘卡的金色圓環（`apps/web/src/features/home/HomeCard.module.css` 的 `.summaryDecoration::after`，150px）縮小後放到統計頁摘要的結餘格。
- 另開 spec 與 PR。照流程：從新 main 開分支 → spec 寫目標、尺寸、深淺主題、390px 不擋數字、減少動態 → 經開發者核可 → 派 Codex。
- 用新編號：決策從 441 起、W 從 W330 起，向 main 登記。

### 開發者決定紀錄

- 11-24：修同色分類；「趨勢」改「每月收支」；拿掉成員分頁與帳本／我切換，改漏斗篩選；全站點綴三種方向都做，demo 時挑；同意改 API；全部留在 #251（決策 424～432）。
- 11-24 demo：先標明「已結 N 月均」（決策 433）。
- 11-25 demo：移動平均直接放 #251、窗口 6 個月、開帳後前 5 個月依實際月數；篩選面板改多欄；demo 資料要多、要多樣（決策 435～437）。
- 11-25 點綴：第 9～11 組都留；首頁「＋ 新增交易」、分類頁「新增收入分類」維持金色主動作；危險區補回淡紅外框（決策 438、439，第 15 組 T26）；統計結餘小圓環另開 PR（決策 440）。
- 開發者偏好：先讓開發者看到比對畫面，並直接說明每組改了畫面哪裡，再請開發者選。

### 待清理（需開發者同意）

- 測試資料庫 `ledger_web_unslop_test`、`ledger_web_unslop_demo_test`。
- demo 伺服器：API 3200、新版 web 5190、現版 web 5181。PID 在 `$env:TEMP\unslop\demo-pids.txt`。勿動 5180。
- 本工作區與分支 `feature/web-unslop-pages`。若下一個 PR 沿用本工作區，先切到新分支再清舊分支。
