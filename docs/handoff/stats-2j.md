# 交接：2j 統計、2k 首頁改版、2l 可編輯版面（`stats-2j`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-10-25）

- 2j 已以 PR #154 合進 `main`，程式隨 4a 部署到 dev（#156）。plan 與 todo 在 `tasks/archive/phase-2j-*.md`，驗收數字在 plan §6。
- 2k 首頁改版已以 PR #163（`ad1471f`）合進 `main` 並部署到 dev（只改前端）。部署後在 dev 用無頭瀏覽器點過：首頁版面、展開與收起、最近｜標註切換、三種配色切換、重整後配色保留、390px，沒有 console 錯誤或 4xx／5xx。spec `docs/specs/phase-2k-home-redesign.md`，plan 與 todo 在 `tasks/archive/phase-2k-*.md`，W1～W7 的驗收數字在 plan §6。
- 討論過程：參考圖與三個版本的比較、分類條配色 demo 都在 `docs/artifacts/home-redesign/`（不進版控）。advisor（Codex）審過 spec 一輪、plan 兩輪，修訂紀錄在 spec §11 與 plan §6。
- 2l 首頁 A+ 版面與可編輯版面：spec `docs/specs/phase-2l-home-layout.md`、plan 與 todo `tasks/phase-2l-*.md` 開發者 2026-10-25 核可。A+ 對照圖與版面編輯原型在 `docs/artifacts/home-design-align/`（不進版控）。advisor（Codex）兩輪方向意見、兩輪全文審查都在 spec §10，雙方已無分歧。
- 已知限制（2j spec §1）：交易頁的日期篩選用瀏覽器時區換算，統計用台灣時間。
- 效能（SC-R13）：統計端點 p95 約 260～310ms，機器有其他負載時曾量到 907～967ms。

## 2l 進度（2026-10-26）

PR1、PR2 都已合併並部署到 dev。下一步是 PR3（編輯模式）。

- PR1（A+ 版面）：#172（`2454a0d`）。含 W-A3（決策 336、SC-Y30）：卡窄於 360px 時交易列改成兩行。
- PR1 的交接 #173（`83c5cf3`）已合併。CI 原本卡在首頁 e2e `getRect` 偶發失敗，#174（`db7cb2f`）已修好：量之前先等元素可見並重試，斷言沒放寬。
- PR2（伺服器儲存）：#175（`0665f80`）。新表 `UserHomeLayout`、`GET`／`PUT /api/users/me/home-layout/web`、`parseHomeLayoutV1`、禁鍵 guard、錯誤碼 `HOME_LAYOUT_REVISION_CONFLICT`。前端還沒呼叫，使用者看不出差別。驗收數字在 PR 描述，偏離在 plan §6。
- PR2 部署：主工作區 `git pull`、shared build、`prisma generate`、`prisma migrate deploy`、API build 都做了（Node 升級 session 代做）。`ledger_dev` 的 migration 狀態是最新。套 migration 前沒有 `pg_dump`；這個 migration 只新增表與 enum，不動既有資料。開發者要用 Node 24 重開 API（`node dist/main`）與 Vite。
- 已清掉：worktree `2l-aplus`、`home-design`、`home-e2e-flake`、`2l-layout-api` 與對應的本機分支；遠端分支 `polluxyz/2l-aplus`；測試資料庫 `ledger_2laplus_test`、`ledger_homedesign_test`、`ledger_flake_test`、`ledger_layout_test`。

### 下一個 session 先做

1. PR3 從 C0（拖動套件檢查點，plan §3.1）開始。派工前先向開發者確認試裝 3 個套件：`@dnd-kit/react` 0.5.1、`@dnd-kit/core` 6.3.1、`react-resizable-panels` 4.14.8。
2. E1（版面運算）只依賴 PR2，可以跟 C0 平行派。
3. 專案 Node 已改成 24.22.1（#176）。指令用 `fnm exec --using=24.22.1 ...`。

### 待開發者決定

- 要不要請 Codex 重產已刪的 A+ 預覽頁（選用，實作以 spec 文字為準）。

## 已知問題

- 390px 時，借還卡的長對象名稱（例：「搬移測試對象 1021」）被擠成 4 行。開發者還沒決定要不要改。
- Web e2e 有 1 條統計頁版面斷言偶發失敗：W7 的 Codex 第一輪跑到 88/89，單獨重跑與協調者重跑都沒有重現（2j plan §6）。再出現時先看是不是機器負載。
- #174 的代價：首頁元件真的沒出現時，`getRect` 要多等 5 秒才失敗。
- PR2 已知限制：revision 到 2147483647 後再存一次，資料庫整數溢位回 500。正常使用不會發生，沒有處理。
- `packages/shared` 沒有 lint script；shared 的測試檔不在 typecheck 範圍內。

## 之後的 PR

- PR3 照 `tasks/phase-2l-todo.md`。C0 選定的套件才裝進 PR3（決策 335）。
- PR3 合併後部署 dev 要先跑 `pnpm install`（新套件）。

## 開發者在這次討論給的偏好

- 首頁版面跟著帳號存在伺服器；像 VS Code 一樣拖分隔線、拖卡片到另一張卡的半邊；按「編輯」才能拖；手機網頁固定（2l）。
- 根列只改自己的高度，整頁變長；列內分隔線才是一增一減（2l 決策 332）。

2k 的：

- 首頁選 A 版，右上放資產趨勢小圖，資產卡裡放支出分類（跟原 A 版互換）。
- 新增交易後，首頁所有圖卡要同時更新。
- 分類條配色做成設定：彩色、金色、灰色三選一。
