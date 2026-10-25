# 交接：2j 統計、2k 首頁改版、2l 可編輯版面（`stats-2j`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-10-25）

- 2j 已以 PR #154 合進 `main`，程式隨 4a 部署到 dev（#156）。plan 與 todo 在 `tasks/archive/phase-2j-*.md`，驗收數字在 plan §6。
- 2k 首頁改版已以 PR #163（`ad1471f`）合進 `main` 並部署到 dev（只改前端）。部署後在 dev 用無頭瀏覽器點過：首頁版面、展開與收起、最近｜標註切換、三種配色切換、重整後配色保留、390px，沒有 console 錯誤或 4xx／5xx。spec `docs/specs/phase-2k-home-redesign.md`，plan 與 todo 在 `tasks/archive/phase-2k-*.md`，W1～W7 的驗收數字在 plan §6。
- 討論過程：參考圖與三個版本的比較、分類條配色 demo 都在 `docs/artifacts/home-redesign/`（不進版控）。advisor（Codex）審過 spec 一輪、plan 兩輪，修訂紀錄在 spec §11 與 plan §6。
- 2l 首頁 A+ 版面與可編輯版面：spec `docs/specs/phase-2l-home-layout.md`、plan 與 todo `tasks/phase-2l-*.md` 開發者 2026-10-25 核可。A+ 對照圖與版面編輯原型在 `docs/artifacts/home-design-align/`（不進版控）。advisor（Codex）兩輪方向意見、兩輪全文審查都在 spec §10，雙方已無分歧。
- 已知限制（2j spec §1）：交易頁的日期篩選用瀏覽器時區換算，統計用台灣時間。
- 效能（SC-R13）：統計端點 p95 約 260～310ms，機器有其他負載時曾量到 907～967ms。

## 2l 進度（2026-10-25）

PR1（A+ 版面）已以 #172（`2454a0d`）合進 `main` 並部署到 dev。等開發者按 `Ctrl + Shift + R` 看過，再開 PR2（todo S2）。

- PR1 含 W-A3（決策 336、SC-Y30）：首頁「最近」「標註」卡窄於 360px 時交易列改成兩行，名稱不再被擠掉。協調者看過 309px、390px、寬卡的淺色與深色截圖。
- 驗證 commit `d6006bc`：format:check／lint／typecheck 全綠；單元測試 API 881、Web 1032、shared 126 條；Web e2e 90 條（worker 跑）；CI 全綠。
- 部署：主工作區 `git pull`、重建 shared 與 API（同時帶進 #171，API 預設只聽 `localhost`）。開發者要重開 API 與 Vite。
- `2l-aplus` worktree 與本機 `polluxyz/2l-aplus` 分支已清掉。遠端 `polluxyz/2l-aplus` 不是 PR 來源分支，刪之前先問。`ledger_2laplus_test` 也還在，刪之前先問。

### 待開發者決定

- 可否刪遠端分支 `polluxyz/2l-aplus` 與測試資料庫 `ledger_2laplus_test`。
- 可否刪測試資料庫 `ledger_homedesign_test`（已刪的 `home-design` worktree 留下的）。刪資料庫要先問。
- 要不要請 Codex 重產已刪的 A+ 預覽頁（選用，實作以 spec 文字為準）。

## 已知問題

- 390px 時，借還卡的長對象名稱（例：「搬移測試對象 1021」）被擠成 4 行。部署後檢查時看到，開發者還沒看過，未決定要不要改。
- Web e2e 有 1 條統計頁版面斷言偶發失敗：W7 的 Codex 第一輪跑到 88/89，單獨重跑與協調者重跑都沒有重現（plan §6）。再出現時先看是不是機器負載。

## 之後的 PR

- PR2、PR3 照 `tasks/phase-2l-todo.md`。C0 試裝拖動套件前，再跟開發者確認套件清單。
- 2l 全部完成後，刪 `ledger_2laplus_test` 等測試資料庫前要先問開發者。

## 開發者在這次討論給的偏好

- 首頁版面跟著帳號存在伺服器；像 VS Code 一樣拖分隔線、拖卡片到另一張卡的半邊；按「編輯」才能拖；手機網頁固定（2l）。
- 根列只改自己的高度，整頁變長；列內分隔線才是一增一減（2l 決策 332）。

2k 的：

- 首頁選 A 版，右上放資產趨勢小圖，資產卡裡放支出分類（跟原 A 版互換）。
- 新增交易後，首頁所有圖卡要同時更新。
- 分類條配色做成設定：彩色、金色、灰色三選一。
