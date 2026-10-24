# 交接：2j 統計、2k 首頁改版（`stats-2j`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-10-24）

- 2j 已以 PR #154 合進 `main`，程式隨 4a 部署到 dev（#156）。plan 與 todo 在 `tasks/archive/phase-2j-*.md`，驗收數字在 plan §6。
- 2k 首頁改版的程式與文件都在 PR #163（`feature/phase-2k-home-redesign-impl`），已併入 main 的 #160～#162。spec `docs/specs/phase-2k-home-redesign.md`，plan 與 todo 在 `tasks/archive/phase-2k-*.md`，W1～W7 的驗收數字在 plan §6。
- 討論過程：參考圖與三個版本的比較、分類條配色 demo 都在 `docs/artifacts/home-redesign/`（不進版控）。advisor（Codex）審過 spec 一輪、plan 兩輪，修訂紀錄在 spec §11 與 plan §6。
- 已知限制（2j spec §1）：交易頁的日期篩選用瀏覽器時區換算，統計用台灣時間。
- 效能（SC-R13）：統計端點 p95 約 260～310ms，機器有其他負載時曾量到 907～967ms。

## 已知問題

- Web e2e 有 1 條統計頁版面斷言偶發失敗：W7 的 Codex 第一輪跑到 88/89，單獨重跑與協調者重跑都沒有重現（plan §6）。再出現時先看是不是機器負載。

## 下一步

1. 盯 PR #163 的 CI：`gh pr checks 163 --watch`。紅了就修；Web 的問題退給 Codex。落後 main 用 `gh pr update-branch 163`，不要用 `--admin`。
2. CI 全綠後 `gh pr merge 163 --squash --delete-branch`。
3. 部署 dev：在主工作區 `D:/Projects/ledger-app` 照 `docs/handoff/main.md` 做。只讀點一次：首頁版面、展開與收起、最近｜標註切換、設定頁切配色、重整。提醒開發者按 Ctrl+Shift+R。
4. 收尾 Orca run `run_b64af52968be`：沒有進行中的 worker，Delivery 都已 ack。確認後結束這個 run。
5. 把 `stats-2j` worktree 切回 `main`（或 detached），刪掉本地的 `feature/phase-2k-home-redesign-impl`。
6. 開一個小的 docs PR：`docs/handoff.md` 的 stats-2j 列改回「（待命）」與「2j（#154）、2k（#163）已合併」；本檔的下一步改回「沒有進行中的工作」，現況寫 2k 已以 #163 合併並部署。

之後沒有進行中的工作。新工作從 `origin/main` 開新分支，跑 `pnpm install`。

## 開發者在這次討論給的偏好

- 首頁選 A 版，右上放資產趨勢小圖，資產卡裡放支出分類（跟原 A 版互換）。
- 新增交易後，首頁所有圖卡要同時更新。
- 分類條配色做成設定：彩色、金色、灰色三選一。
