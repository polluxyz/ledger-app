# 交接：2j 統計、2k～2m 首頁改版（`stats-2j`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-10-27）

### 2m 實裝完成，交 Claude Code 驗收

- 開發者逐次確認首頁預覽，最後要求「好 幫我實裝」，並追加「實裝完畢後交給 claude code 做驗收」。Codex 已完成程式與必要驗證，交接後停止寫入；驗收通過前不得合併。
- 分支：`feature/home-visual-refresh`，程式 commit `823428a`，基底 `d8b8720`。PR [#189](https://github.com/polluxyz/ledger-app/pull/189) 是 draft；後續交接 commit 只有文件，不改程式或測試。
- 規格：[2m](../specs/phase-2m-home-visual-refresh.md)；[plan](../../tasks/home-visual-refresh-plan.md) 的實作紀錄及結果、[todo](../../tasks/home-visual-refresh-todo.md) V1～V3 完成，V4 留給驗收者。沒有改 schema、API、shared、套件、環境變數或 CI，也沒有部署 dev。
- 實作：首頁沿用八卡與儲存版面；趨勢左「總資產變化」、右「每月結餘」，只畫柱圖，滑動底板／柱高／零線動畫；原資產與月結餘取既有兩組 API。借還改左右圓形頭像與姓名、中央支付箭頭與精確金額。其他卡片調整數字、淡金結餘、進度條與清單間距。
- 本機品質檢查：format、lint、typecheck、build 全部 exit 0；`pnpm test`：shared 160、API 902、Web 1118（共 2180）通過。最後圖表微調後 3 檔相關元件／首頁測試 45／45 通過。
- 本機 Web e2e：首頁與版面編輯首輪 39／41，修正兩條後針對失敗案例重跑 2／2 通過；最後手機標籤／留白調整再驗 SC-V1、Y4、H14，3／3 通過。不是最後一次單批執行 41／41，完整過程與測試斷言變更理由見 plan。
- 請特別檢查原 SC-Y16 滑鼠來回 50 vs 49.997 的次像素誤差：滑鼠斷言改 `toBeCloseTo(initialValue, 2)`；鍵盤精確恢復、總高 0.5px 內斷言保留，版面調整器沒有改動。新圖表測試改等手機版面穩定後檢查溢出。
- 本機截圖：`docs/artifacts/2l-aplus-shots/home-1280px-light-gold.png`、`home-390px-light-gold.png`、`home-1280px-dark-gold.png`；最後手機趨勢截圖在 `apps/web/test-results/`。均為測試虛構資料、不進版控。使用者核可的完整預覽為 `docs/artifacts/home-refresh-20261027/index.html`。
- CI 在 PR 建立後已啟動，交接時待完成。尚未在本機重跑全站 Web e2e／API e2e。請自行讀最新 head 的 CI、依 SC-V1～V8 做獨立驗收；通過後再將 draft ready、依 §10 完成合併及文件歸檔。失敗則列可重現問題，網頁修正仍交 Codex。
- e2e 使用本工作區 `ledger_stats_test`，port 3100／5273／5274 由測試啟閉；再次執行前確認沒有其他工作區使用。指令一律 `fnm exec --using=24.22.1 ...`，不要碰 dev 資料庫。

### 已完成的前置工作

- 2j 已以 PR #154 合進 `main`，程式隨 4a 部署到 dev（#156）。plan 與 todo 在 `tasks/archive/phase-2j-*.md`，驗收數字在 plan §6。
- 2k 首頁改版已以 PR #163（`ad1471f`）合進 `main` 並部署到 dev（只改前端）。部署後在 dev 用無頭瀏覽器點過：首頁版面、展開與收起、最近｜標註切換、三種配色切換、重整後配色保留、390px，沒有 console 錯誤或 4xx／5xx。spec `docs/specs/phase-2k-home-redesign.md`，plan 與 todo 在 `tasks/archive/phase-2k-*.md`，W1～W7 的驗收數字在 plan §6。
- 討論過程：參考圖與三個版本的比較、分類條配色 demo 都在 `docs/artifacts/home-redesign/`（不進版控）。advisor（Codex）審過 spec 一輪、plan 兩輪，修訂紀錄在 spec §11 與 plan §6。
- 2l 首頁 A+ 版面與可編輯版面：spec `docs/specs/phase-2l-home-layout.md`、plan 與 todo 開發者 2026-10-25 核可，已移到 `tasks/archive/phase-2l-*.md`。A+ 對照圖與版面編輯原型在 `docs/artifacts/home-design-align/`（不進版控）。advisor（Codex）兩輪方向意見、兩輪全文審查都在 spec §10，雙方已無分歧。
- 已知限制（2j spec §1）：交易頁的日期篩選用瀏覽器時區換算，統計用台灣時間。
- 效能（SC-R13）：統計端點 p95 約 260～310ms，機器有其他負載時曾量到 907～967ms。

## 2l 進度（2026-10-26）

2l 全部完成，3 個 PR 都已合併並部署到 dev。後續 2m 狀態見本檔最上方。

- PR1（A+ 版面）：#172（`2454a0d`）。含 W-A3（決策 336、SC-Y30）：卡窄於 360px 時交易列改成兩行。
- PR1 的交接 #173（`83c5cf3`）已合併。CI 原本卡在首頁 e2e `getRect` 偶發失敗，#174（`db7cb2f`）已修好：量之前先等元素可見並重試，斷言沒放寬。
- PR2（伺服器儲存）：#175（`0665f80`）。新表 `UserHomeLayout`、`GET`／`PUT /api/users/me/home-layout/web`、`parseHomeLayoutV1`、禁鍵 guard、錯誤碼 `HOME_LAYOUT_REVISION_CONFLICT`。部署時套了 migration，沒有先 `pg_dump`（只新增表與 enum）。
- PR3（編輯模式）：#179（`74116f2`）。拖卡片到另一張卡的半邊、拖分隔線、調列高、按「完成」存到伺服器。新套件 `@dnd-kit/core` 6.3.1 與 `react-resizable-panels` 4.14.8（版本鎖死，決策 335）。E3 的 e2e 抓到 E2 的產品 bug，5 個 `fix:` commit 都在 PR3 內修好。驗收數字與偏離在 plan §6。
- PR3 部署：主工作區 `git pull`、`pnpm install`、shared 與 API build 都做了，沒有 migration。開發者要用 Node 24 重開 API（`node dist/main`）與 Vite，再按 `Ctrl + Shift + R`。
- 已清掉：worktree `2l-aplus`、`home-design`、`home-e2e-flake`、`2l-layout-api`、`2l-layout-ops`、`2l-layout-edit`、`2l-layout-edit-e2e` 與對應分支；本機分支 `feature/2l-home-layout-edit`、`polluxyz/2l-dnd-spike`；遠端分支 `polluxyz/2l-aplus`；測試資料庫 `ledger_2laplus_test`、`ledger_homedesign_test`、`ledger_flake_test`、`ledger_layout_test`。保留 stats-2j 自己的 `ledger_stats_test`。
- 專案 Node 已改成 24.22.1（#176）。指令用 `fnm exec --using=24.22.1 ...`。

## 2l 之後的收尾（2026-10-27）

- Web code splitting：#184（`c810d55`）。登入、註冊以外的頁面改成按路由載入，build 不再有 500 kB 警告。最大 chunk 290.67 kB（gzip 92.11 kB），首頁首次載入 612.65 kB（改前 740.36 kB）。
- A+ 預覽頁已請 Codex 重產，放在 `docs/artifacts/home-design-align/aplus.html`（不進版控）。只是參考，實作仍以 2l spec 文字為準。
- 390px 借還卡長名稱：在 #184 的分支上用暫時的 e2e 量過，390px 與 309px、深淺兩色都是單行加省略號，沒有被擠成 4 行。2l #172 的首頁摘要箭頭已經處理掉。截圖與 Codex 做的 3 個改法比較在 `docs/artifacts/debt-card-390/`（不進版控）。
- 首頁帳戶卡一律列出全部帳戶（開發者 10-27）：拿掉「全部 N 個」與「收起」；6 個以上時清單 440px 排兩欄，5 個以下一欄。改了 2k W264、SC-H8 與 2l 決策 319、W276、SC-Y8。帳戶卡的視覺之後由開發者另請 Codex 設計。
- 已清掉：worktree `web-previews`、`web-code-split` 與對應分支，測試資料庫 `ledger_codesplit_test` 與誤建的 `ledger_test_codesplit`。e2e 只接受名稱以 `_test` 結尾的資料庫，命名要照這個規則。

## 已知問題

- Web e2e 有 1 條統計頁版面斷言偶發失敗：W7 的 Codex 第一輪跑到 88/89，單獨重跑與協調者重跑都沒有重現（2j plan §6）。再出現時先看是不是機器負載。
- #174 的代價：首頁元件真的沒出現時，`getRect` 要多等 5 秒才失敗。
- PR2 已知限制：revision 到 2147483647 後再存一次，資料庫整數溢位回 500。正常使用不會發生，沒有處理。
- `packages/shared` 沒有 lint script；shared 的測試檔不在 typecheck 範圍內。

## 開發者在這次討論給的偏好

- 首頁版面跟著帳號存在伺服器；像 VS Code 一樣拖分隔線、拖卡片到另一張卡的半邊；按「編輯」才能拖；手機網頁固定（2l）。
- 根列只改自己的高度，整頁變長；列內分隔線才是一增一減（2l 決策 332）。

2k 的：

- 首頁選 A 版，右上放資產趨勢小圖，資產卡裡放支出分類（跟原 A 版互換）。
- 新增交易後，首頁所有圖卡要同時更新。
- 分類條配色做成設定：彩色、金色、灰色三選一。
