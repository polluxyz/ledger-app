# 交接：2j 統計、2k 首頁改版、2l 可編輯版面（`stats-2j`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-10-25）

- 2j 已以 PR #154 合進 `main`，程式隨 4a 部署到 dev（#156）。plan 與 todo 在 `tasks/archive/phase-2j-*.md`，驗收數字在 plan §6。
- 2k 首頁改版已以 PR #163（`ad1471f`）合進 `main` 並部署到 dev（只改前端）。部署後在 dev 用無頭瀏覽器點過：首頁版面、展開與收起、最近｜標註切換、三種配色切換、重整後配色保留、390px，沒有 console 錯誤或 4xx／5xx。spec `docs/specs/phase-2k-home-redesign.md`，plan 與 todo 在 `tasks/archive/phase-2k-*.md`，W1～W7 的驗收數字在 plan §6。
- 討論過程：參考圖與三個版本的比較、分類條配色 demo 都在 `docs/artifacts/home-redesign/`（不進版控）。advisor（Codex）審過 spec 一輪、plan 兩輪，修訂紀錄在 spec §11 與 plan §6。
- 2l 首頁 A+ 版面與可編輯版面：spec `docs/specs/phase-2l-home-layout.md`、plan 與 todo `tasks/phase-2l-*.md` 待開發者核可。A+ 對照圖與版面編輯原型在 `docs/artifacts/home-design-align/`（不進版控）。advisor（Codex）兩輪意見與分歧在 spec §10。
- 已知限制（2j spec §1）：交易頁的日期篩選用瀏覽器時區換算，統計用台灣時間。
- 效能（SC-R13）：統計端點 p95 約 260～310ms，機器有其他負載時曾量到 907～967ms。

## 已知問題

- 390px 時，借還卡的長對象名稱（例：「搬移測試對象 1021」）被擠成 4 行。部署後檢查時看到，開發者還沒看過，未決定要不要改。
- Web e2e 有 1 條統計頁版面斷言偶發失敗：W7 的 Codex 第一輪跑到 88/89，單獨重跑與協調者重跑都沒有重現（plan §6）。再出現時先看是不是機器負載。

## 下一步

1. 開發者核可 2l 的 spec、plan、todo（schema、API、新套件要明確同意）。
2. docs PR（todo D0）合併後，照 todo 從 PR1 開始。

Orca run `run_dfe66599ba8a`。Codex 設計 worker 的 worktree `home-design`（分支 `polluxyz/home-design`，資料庫 `ledger_homedesign_test`）還開著，PR1 要不要沿用由協調者決定；不用就清掉。

## 開發者在這次討論給的偏好

- 首頁版面跟著帳號存在伺服器；像 VS Code 一樣拖分隔線、拖卡片到另一張卡的半邊；按「編輯」才能拖；手機網頁固定（2l）。
- 根列只改自己的高度，整頁變長；列內分隔線才是一增一減（2l 決策 332）。

2k 的：

- 首頁選 A 版，右上放資產趨勢小圖，資產卡裡放支出分類（跟原 A 版互換）。
- 新增交易後，首頁所有圖卡要同時更新。
- 分類條配色做成設定：彩色、金色、灰色三選一。
