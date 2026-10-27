# 交接：2j 統計、2k～2m 首頁改版（`stats-2j`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-10-27）

### 2m 收支摘要漏項：補正完成，待 Claude Code 驗收

- 使用者提供核可預覽，指出三張卡的圖示及結餘背景沒有實裝。此為 Codex 在 #189 的實裝漏項，依原畫面補齊，不再要求使用者重複核可。
- 分支 `fix/home-summary-visual-details`，程式 commit `095faa3`，基底 `cab8b50`。詳見 [補正計畫及驗證](../../tasks/home-summary-details-plan.md) 與 spec 第 4 項、SC-V9。後續提交僅更新交接文件。
- 已補：支出／收入／結餘右上圖示、淡金雙圓弧、縮小貨幣符號、帳本月份／結餘副標；結餘卡標題明列「本月結餘」。保留所有金額格式、負號、小數及共享帳本個人份額。
- 裝飾使用獨立裁切層，不裁掉整張卡的焦點框或拖動控制，不隔離卡片選單的堆疊。不改 schema、API、套件、CI、版面格式或其他頁面。
- 驗證：相關 71／71；全 Web vitest 限制 2 workers 後 1121／1121；首頁與版面編輯 e2e 單批 41／41，最後堆疊調整後 SC-Y20 再驗 1／1。format、lint、typecheck、Web build 都 exit 0。預設併行 Web 測試首次與 e2e 同時跑有 28 條 5 秒逾時，沒有改 timeout 或斷言；重跑結果如上。
- 真實測試頁面的深淺色已核對：`docs/artifacts/2l-aplus-shots/home-1280px-light-gold.png`、`home-1280px-dark-gold.png`，手機 `home-390px-light-gold.png`。請直接對照使用者原預覽核對圖示、底板、圓弧與副標，不能只看測試綠燈。
- Codex 提交後交回既有 Claude Code 驗收。通過 SC-V9 且最新 head CI 全綠後才可合併，並按已授權的前端部署流程更新 dev；未通過時網頁修正仍由 Codex 負責。測試 DB `ledger_stats_test`，執行前查 3100／5273／5274，指令 `fnm exec --using=24.22.1 ...`。

### 2m 首頁風格：已驗收並合併

- PR [#189](https://github.com/polluxyz/ledger-app/pull/189)，squash 合併進 `main`。程式 commit `823428a` 由 Codex 實裝，基底 `d8b8720`。開發者指定 Claude Code 驗收；驗收紀錄在 [plan](../../tasks/archive/phase-2m-plan.md) 最後一節。
- 規格：[2m](../specs/phase-2m-home-visual-refresh.md)；plan、todo、設計討論紀錄已移到 `tasks/archive/phase-2m-*.md`。沒有改 schema、API、shared、套件、環境變數或 CI。
- 實作：首頁沿用八卡與儲存版面；趨勢左「總資產變化」、右「每月結餘」，只畫柱圖，切換時有滑動底板／柱高／零線動畫，只看站內動畫設定。借還改左右圓形頭像與姓名、中央支付箭頭與精確金額。
- 驗收數字：Web vitest 1118／1118；format、lint、typecheck、build exit 0；首頁與版面編輯 e2e 41／41。暫存驗收 e2e 3／3（驗完刪除）補驗了 API 原值、負值柱、動畫中途取消、站內動畫開關、換帳本、鍵盤、借還 1280／390／309px。
- 計畫外：PR 的 CI 在 SC-Y8 失敗。原因是舊斷言在右側面板轉場中取樣，不是產品回歸；面板開完後清單 551px 排兩欄，符合 2l SC-Y8。Codex 改成等面板與清單寬度穩定再判斷（`c975aac`），只動測試。
- **尚未部署 dev**。只改前端：主工作區 `git pull`、`pnpm install`、重新 build Web 或重開 Vite，再請開發者按 `Ctrl + Shift + R`。
- 小問題，不擋合併：姓名是空字串時頭像沒有字；版控內的 e2e 對動畫中途狀態的證據偏弱。build 的 PostCSS「沒傳 `from`」警告在基底就有。
- 已清掉：驗收修正用的 Codex 終端機（orca run `run_49de4f0d628c`）。

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
