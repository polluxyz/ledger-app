# web-unslop 工作區交接

## 2026-11-25 協調者交接（2o 第 2 輪，待開發者挑選後合併）

### 現況

- 分支 `feature/web-unslop-pages`，HEAD 為本交接 commit（程式最後一次改動 `cb64115`）。PR #251 OPEN，**未合併**。開發者明確核可才可合併。
- CI 在 `dc5472c` 全綠（格式、lint、型別、單元、build、API E2E、Web E2E），[CI run](https://github.com/polluxyz/ledger-app/actions/runs/45541553898/job/138961038715)。PR 內文已含第 1～14 組、撤回順序、各組驗證數字與 SC-O23～O25。
- 第 2 輪 Run `run_2cc1c21e985d`：19 個 task 全部 completed，所有 dispatch 已 release，沒有待回訊息。
- 未追蹤的 `.agents/skills/unslop/` 不提交。`docs/artifacts/` 截圖不提交。

### 本 PR 的 14 組 commit

第 1～12 組見 PR 內文。11-25 追加：

- 第 13 組 `cb64115` 篩選面板多欄（決策 436、W328、SC-O23）：>900px 每組 4 欄、704px 寬；≤600px 2 欄。只改網頁，依附第 7 組。
- 第 14 組 `8abaa40` 6 個月移動平均（決策 435、W329、SC-O24、SC-O25）：趨勢每月新增 `movingAverageIncome`、`movingAverageExpense`、`movingAverageMonthCount`；圖改兩條折線。改 API、shared、網頁，只新增欄位，依附第 6、8、12 組。
- 撤回第 8 組前要先撤第 14、12 組；撤第 7 組前要先撤第 13 組。各組撤回驗證見 plan 執行紀錄。

### 開發者待決定（新 session 接手後第一件事就是問這兩題）

1. **點綴組去留（T10）**：第 9 組卡片層次（`0c45893`）、第 10 組帳冊線稿（`b70956d`）、第 11 組金色引導（`a64ddfe`＋`a781c12` 一起撤）。不留的組在合併前 `git revert`，各組可單獨撤回。
2. **結餘金色圓環要不要延伸**：開發者 11-25 說喜歡首頁結餘卡的裝飾（`HomeCard.module.css` 的 `.summaryDecoration::after`，main 上已有）。待問：是否延伸到其他地方，例如統計頁的結餘；或只留在首頁。若要延伸，屬新的網頁改動，照流程補 spec 決策後派 Codex。

開發者核可後：squash merge → `tasks/pages-unslop-plan.md`、`tasks/pages-unslop-todo.md` 封存到 `tasks/archive/` → 經同意清工作區、分支、測試資料庫（`ledger_web_unslop_test`、`ledger_web_unslop_demo_test`）、demo 伺服器，更新 README 的 2o 狀態。

### 開發者決定紀錄

- 11-24：修同色分類；「趨勢」改「每月收支」；拿掉成員分頁與帳本／我切換，改漏斗篩選；全站點綴三種方向都做，demo 時挑；同意改 API；全部留在 #251（決策 424～432）。
- 11-24 demo：先標明「已結 N 月均」（決策 433）。
- 11-25 demo：移動平均直接放 #251、窗口 6 個月、開帳後前 5 個月依實際月數；篩選面板改多欄；demo 資料要多、要多樣（決策 435～437）。

### 編號

web-unslop 用到決策 437、W329、SC-O25。下一個共用編號決策 438、W330。

### demo 伺服器（背景執行，勿動 5180）

- API 3200（`apps/api` 的 `dist/main.js`），以環境變數覆寫 `DATABASE_URL` 指向獨立資料庫 `ledger_web_unslop_demo_test`，並設 `CORS_ORIGIN=http://localhost:5190,http://localhost:5181`。新版 web 5190（本工作區，熱更新）、現版 web 5181（main 工作區）。PID 在 `$env:TEMP\unslop\demo-pids.txt`（api=42008、new=22616、old=22096）。
- 帳號 `demo-a@example.test`／`demo-b@example.test`／`demo-c@example.test`，密碼 `demo12345`，資料全為虛構。種子 `$env:TEMP\unslop\demo\seed2.mjs`：3 人、2025-04～2026-11 共 20 個月、457 筆交易。
- API e2e 用 `ledger_web_unslop_test`，不會清掉 demo 資料。本機仍不跑 web e2e。
- 本機跑 web 測試用 `vitest run --maxWorkers=8`，預設 worker 數會逾時。

### 本機證據（不提交）

- 截圖 `docs/artifacts/pages-unslop-2o-r2-after/`（含 `t23-filter-1280.png`、`t23-filter-1280-dark.png`、`t23-filter-390.png`）。
- advisor 交流紀錄 `$env:TEMP\unslop\advisor-exchange.md`、`advisor-exchange-2.md`。
