# 交接：2j 統計、2k 首頁改版（`stats-2j`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-10-24）

- 2j 已以 PR #154 合進 `main`，程式隨 4a 部署到 dev（#156）。plan 與 todo 在 `tasks/archive/phase-2j-*.md`，驗收數字在 plan §6。
- 2k 首頁改版已以 PR #163（`ad1471f`）合進 `main` 並部署到 dev（只改前端）。部署後在 dev 用無頭瀏覽器點過：首頁版面、展開與收起、最近｜標註切換、三種配色切換、重整後配色保留、390px，沒有 console 錯誤或 4xx／5xx。spec `docs/specs/phase-2k-home-redesign.md`，plan 與 todo 在 `tasks/archive/phase-2k-*.md`，W1～W7 的驗收數字在 plan §6。
- 討論過程：參考圖與三個版本的比較、分類條配色 demo 都在 `docs/artifacts/home-redesign/`（不進版控）。advisor（Codex）審過 spec 一輪、plan 兩輪，修訂紀錄在 spec §11 與 plan §6。
- 已知限制（2j spec §1）：交易頁的日期篩選用瀏覽器時區換算，統計用台灣時間。
- 效能（SC-R13）：統計端點 p95 約 260～310ms，機器有其他負載時曾量到 907～967ms。

## 已知問題

- 390px 時，借還卡的長對象名稱（例：「搬移測試對象 1021」）被擠成 4 行。部署後檢查時看到，開發者還沒看過，未決定要不要改。
- Web e2e 有 1 條統計頁版面斷言偶發失敗：W7 的 Codex 第一輪跑到 88/89，單獨重跑與協調者重跑都沒有重現（plan §6）。再出現時先看是不是機器負載。

## 下一步

沒有進行中的工作。Orca run `run_b64af52968be` 已收尾（13 個任務都 completed，沒有占用中的 worker）。新工作從 `origin/main` 開新分支，跑 `pnpm install`。

## 開發者在這次討論給的偏好

- 首頁選 A 版，右上放資產趨勢小圖，資產卡裡放支出分類（跟原 A 版互換）。
- 新增交易後，首頁所有圖卡要同時更新。
- 分類條配色做成設定：彩色、金色、灰色三選一。
