# web-unslop 工作區交接

## 2026-11-24 規劃者交接（2o 第 2 輪）

### 現況

- 分支 `feature/web-unslop-pages`。PR #251 OPEN，**未合併**。開發者 demo 後明確核可才可合併。
- 開發者 2026-11-24 核可 spec §9、plan「第 2 輪修訂」、todo T12～T21。T12 已提交並併入 main（#250）。未追蹤的 `.agents/skills/unslop/` 不提交。
- 第 1 輪與 advisor 的 Orca Run `run_c12ee42f7028` 已全部 succeeded（綁舊對話）。第 2 輪 Run `run_2cc1c21e985d`：T13（`1f077b5`）、T14（`0e69f58`）、T15（`1b671e6`）、T16（`d57dd65`）、T17（`0c45893`）、T18（`b70956d`）、T19（`a64ddfe`）已驗收，demo 種子已在 T14 後重跑，API 3200 已換成含 T14 的版本；測試穩定性另補 `0d93305`；下一步 T20 全套驗證。本機跑 web 測試用 `vitest run --maxWorkers=8`，預設 worker 數會逾時（見 plan 執行紀錄）。

### 開發者決定（2026-11-24 看 demo 後）

- 修同色分類；「趨勢」改掉；拿掉成員分頁與帳本／我切換，改在支出／收入右側加漏斗篩選（成員、分類、帳戶）；全站加點綴；全部留在 #251。
- 漏斗＝錨點面板＋標籤。圖表＝收入、支出加兩條月均線（每月收支）。點綴三種方向都做，demo 時挑。同意改 API。
- 規格寫成 spec §9，決策 424～432、W321～W327。下一個編號 433／W328 由 main 分配。

### advisor 結論

Codex sol xhigh 與 Antigravity hydrogen 已交流到定案：

- 無效或無權的 id 回統一 400；網址失效條件要使用者按「清除失效條件」才清。
- 顏色依帳本同方向分類穩定排序配色，同畫面撞色才補未用色。
- 平均線分母合併兩方意見（已結束的月份、含 0 月，見決策 430）。Codex 原本主張 v1 不做，開發者選擇要做。
- Antigravity 建議拆 PR，開發者選擇留在 #251。

### demo 伺服器（背景執行，勿動 5180）

- API 3200（資料庫 `ledger_web_unslop_test`）、新版 web 5190（本工作區，熱更新）、現版 web 5181（從 main 工作區）。PID 記在 `/tmp/unslop/demo-pids.txt`。
- 帳號 `demo-a@example.test`，資料全為虛構，種子腳本 `/tmp/unslop/demo/seed.mjs`。
- 本機不要跑 web e2e，會清掉 demo 資料庫。API e2e 跑完要重跑種子並通知開發者。

### 下一步

1. 派 Codex default worker 甲做第 5～8 組（一組一張 task），第 8 組完成後派 worker 乙做第 9～11 組。
2. T20、T21 驗證，T10 再 demo，開發者挑點綴組。
3. 合併後經同意才清 worker、工作區、分支，更新 README 2o 狀態，封存 plan 與 todo。

### 本機證據（不提交）

- 提案頁 `docs/artifacts/pages-unslop-2o-r2-proposal.html`。
- advisor 交流紀錄 `/tmp/unslop/advisor-exchange.md`、`advisor-exchange-2.md`。
