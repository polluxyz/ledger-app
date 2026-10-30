# 交接：2j 統計、2k～2m 首頁改版（`stats-2j`）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-10-30）

### stats-2j 已收尾

開發者 10-30 決定收尾。沒有待辦、沒有開著的 PR。測試資料庫 `ledger_stats_test` 已刪除，orca run `run_1f196e6bdf9d` 的 4 個 task 都是 completed。工作區與終端機交給 main 關閉。之後要再做 2j 相關的事，從 main 開新工作區，決策號照 `../handoff.md` 的編號分段。

### 既有名稱資料：統計完，不清理

協調者對 `ledger_dev` 只跑 `SELECT`、只輸出數字。空白的定義與 JavaScript `trim()` 相同。

- 前後有空白／純空白：User 6／19（共 30）、Ledger 28／2（共 39）、Account 2／1（共 66）、Category 0／0（共 475）。帳本多半是空白姓名組出的「 的帳本」。
- 帳戶、分類去掉空白後撞名 0 組。
- 有問題的帳號都在 07-26～08-24 建立；9 月後建立的 5 個帳號名稱正常，和有問題的帳號只同在 1 本共享帳本，好友 0 組。
- 開發者 10-30 說明：dev 的帳本與帳號全是測試資料，刪掉無妨。結論：不寫 migration、不改程式。新輸入已由 #207 修剪。正式環境若沿用 dev 資料庫才需要重新評估。

## 先前紀錄（2026-10-29）

### 名稱 trim 與首頁版面 revision 不回繞：已驗收、合併並部署 dev

開發者要兩件同時做，advisor 兩輪後雙方一致，開發者核可（orca run `run_1f196e6bdf9d`）。

- 首頁版面 revision 不回繞：#206（`101407e`）。[plan](../../tasks/archive/home-layout-bigint-revision-plan.md)。`backend` 角色實作。`revision` 改 `BIGINT`，寫入永遠加 1；API 仍用 JSON number，`expectedRevision` 上限 9007199254740990；條件 `update` 沒有符合的列丟 `P2025` 轉 409；PUT 回傳寫入快照。修訂 2l 決策 329、333，新增決策 260～262。#202 的儲存前 GET 保留。
- 名稱 trim：#207（`fa4c09d`）。[plan](../../tasks/archive/name-trim-plan.md)。`default` 角色實作。8 個 DTO 共用 `TrimName()`，先去掉前後空白再驗證，純空白回 400；更新帳戶 `name: null` 從 500 改成 400。各 DTO 原本的必填或可省略規則不變。
- 驗收數字（協調者重跑）：#206 API 單元 967、API e2e 59 suites／624；#207 API 單元 1028、API e2e 59 suites／623；兩邊 lint、typecheck、format:check 都 exit 0。CI 併入 main 後重跑都通過。
- 計畫外：#205 改了 `docs/handoff.md` 的編號那一行，#206 合併前手動解衝突。name-trim worker 和其他檢查平行跑時，無關的 GLM provider 測試 40ms 逾時；單獨重跑通過。
- 部署：API 與 Vite 原本就沒在跑。主工作區 `git pull`、`pnpm install`、shared build；`pg_dump` 備份到 `D:\Projects\ledger-app-backups\ledger_dev-20261029-before-206-207.dump`；`prisma generate`、`migrate deploy`（套用 `20261029080000_home_layout_revision_bigint`）、API build。暫時用 3200 起 API 驗過：欄位型別 `bigint`、GET 回傳的 revision 是 number、`PATCH` 帳戶 `name: null` 回 400。開發者下次照常起 API 即可。
- 已清掉：worktree `layout-bigint`、`name-trim` 與對應的本機、遠端分支；測試資料庫 `ledger_layoutbig_test`、`ledger_nametrim_test`；worker 終端機。

### 4 項後續：已驗收、合併並部署 dev

開發者要 4 項全開，全部交給 Codex 先提案、協調者審批與驗收（orca run `run_a1b491916f94`）。提案與驗證紀錄都在 `tasks/archive/`。

- shared lint 與 typecheck：#199（`e289b60`）。[plan](../../tasks/archive/shared-lint-typecheck-plan.md)。`packages/shared` 加 ESLint 與 7 個 devDependency（開發者核可，要求確認套件沒有問題）。lockfile 只在 shared importer 多 7 條；`pnpm audit` 前後都是 96 筆、id 相同；dist 前後 52 個檔案完全相同；typecheck 已涵蓋測試檔（放型別錯誤會報 TS2322）。build 改用 `tsconfig.build.json`。
- 借還卡空白姓名：#200（`d42ca9f`）。[plan](../../tasks/archive/home-avatar-empty-name-plan.md)。空字串或純空白姓名的頭像顯示 `?`、姓名欄 `—`。
- 帳戶卡視覺：#201（`9892c71`）。[plan](../../tasks/archive/home-account-card-visual-plan.md)。方案 A 細線帳簿列：名稱單行省略、金額等寬數字、`title` 顯示完整名稱。協調者用臨時檢查量過 309／390／560px 不溢出、560px 分 2 欄；版控內 e2e 只涵蓋 309、560。
- 首頁版面舊 revision：#202（`d647e7d`）。[plan](../../tasks/archive/home-layout-stale-revision-plan.md)。採方案 (b)：普通「完成」先 GET，比對 revision 與原版面才 PUT。改 2l 決策 329、SC-Y14，新增 SC-Y31。剩餘限制：GET→PUT 間不是原子操作；舊 client 與未來 App 沒有這層保護，要全面保障需改後端（方案 (c)，另案核可）。
- 驗收數字：全站 Web e2e 頭像 136／136、帳戶卡 137／137、revision 136／136；4 個分支的 lint、typecheck、test、format:check 都 exit 0。
- CI 偶發：#201 第一次 CI 的 SC-Y30（窄 activity 卡列超出卡片下方 383px）失敗；本機同 commit `--repeat-each 5` 5／5 通過，併入 main 後 CI 重跑通過。SC-Y30 過去 CI 沒失敗過，再出現時保留 trace 查。#202 第一次 CI 的 SC-W80（3c 分帳）失敗，10-28 的 main 也失敗過，是既有偶發。
- 部署：主工作區 `git pull`、`pnpm install`、shared build。沒有 migration，API 不用重開。
- 計畫外：一個孤兒 grep 程序吃掉 12GB 記憶體，讓 Web 單元測試大量 5 秒逾時，協調者把它停掉。PR #198 分支名稱不符規範，關掉後改名重開成 #199。
- 已清掉：worktree `shared-lint`、`home-avatar-empty`、`home-account-card`、`home-layout-stale` 與對應的本機、遠端分支；測試資料庫 `ledger_revstale_test`。worker 終端機都已關閉。

### 首頁 4 項網頁修正：已驗收、合併並部署 dev

- PR [#193](https://github.com/polluxyz/ledger-app/pull/193)，squash 合併進 `main`，基底 `b0cae3b`。開發者要求修 #190 留下的既有問題，加上「標註」分頁色條壓到分類圖示。Codex 實作（orca run `run_eba369c91658`）。沒有改 schema、API、shared、套件、CI。
- 「移到…」選單被下一列蓋住：原因是編輯畫布的橫向捲動容器裁掉了往下超出的部分。選單改用 portal 掛到 `body`、以視窗座標定位，空間不夠時往上開或夾在視窗內（`947c78c`、`c04c61c`）。
- Escape 與點外面都會關選單，Escape 後焦點回「移到…」（`5dbbb79`）。
- 鍵盤：選單移到 `body` 後 Tab 順序斷掉，違反 2l SC-Y20。驗收退件 2 次：第一次要求打開時聚焦；第二次我用臨時測試證實「第一次打開」焦點仍停在按鈕上（選單還沒掛上就呼叫 focus），e2e 的 `tabTo` 一路按 Tab 把問題蓋掉。修正後每次打開都聚焦「目標卡」，焦點離開選單就關閉並回到按鈕；e2e 改成按 Enter 後直接斷言聚焦（`a15cf25`）。
- 309px `PageHeader`：`.header` 與 `.actions` 加 `min-width: 0`、`max-width: 100%`（`cbd8abd`）。e2e SC-Y32 量 9 個頁面的頁首。
- 色條壓圖示：交易列左內距至少 `3px + var(--space-xs)`（7px），標註與未標註列圖示對齊；首頁與交易頁、標註與選取都量過（`2d0c49e`）。
- 驗收數字：Web vitest `--maxWorkers=2` 1126／1126；lint、typecheck、format:check、web build exit 0；全站 Web e2e 136／136。第一次全站跑時我同時跑 vitest，`csp.spec.ts` 2 條失敗；單獨重跑 4／4、無負載重跑全站 136／136。
- Codex 更新提示要選「3 Skip until next version」才會進入工作畫面。把退件直接打進 Codex 輸入框時，它只在畫面上回報、不發 `worker_done`，要讀畫面確認。

### 2m 收支摘要漏項補正：已驗收、合併並部署 dev

- PR [#190](https://github.com/polluxyz/ledger-app/pull/190)，squash 合併進 `main`。使用者指出 #189 漏做核可預覽中三張卡的圖示與結餘背景，Codex 依原畫面補齊（`095faa3`），基底 `cab8b50`。
- 已補：支出斜上箭頭、收入斜下箭頭、結餘等號（右上底板內）；結餘卡右下淡金雙圓弧；縮小貨幣符號；帳本月份與結餘副標；標題「本月結餘」。金額直接用 `formatMoney` 原字串。沒有改 schema、API、shared、套件、CI。
- 驗收紀錄在 [補正計畫](../../tasks/archive/home-summary-details-plan.md) 最後一節。驗收找到「結餘卡的移到選單被副標蓋住」，原因是 header／body 的 `z-index` 建立了堆疊上下文；Codex 修正（`a193936`）後重驗通過。
- 驗收數字：Web vitest `--maxWorkers=2` 1121／1121；format、lint、typecheck、build exit 0；首頁與版面編輯 e2e 41／41。暫存驗收 e2e 驗完刪除。
- CI 抓到 3 條全站 e2e 失敗（驗收時漏跑全站）：副標進了卡片連結名稱、金額多了貨幣 span，舊測試的定位與計行被打破。Codex 只改 e2e 修正（`f3d175d`），重跑全站 Web e2e 134／134。之後驗收網頁改動要跑全站 e2e。
- 既有問題（基底就有）：「移到…」選單超出卡片底部的部分被下一列蓋住；Escape 關不掉該選單；309px 時 `PageHeader` 的主要按鈕超出畫面（`scrollWidth` 330）。2026-10-28 已修，見上一節。
- 已清掉：驗收修正用的 Codex 終端機（orca run `run_13e9dac7a485`）、本機與遠端分支 `fix/home-summary-visual-details`。

### 2m 首頁風格：已驗收並合併

- PR [#189](https://github.com/polluxyz/ledger-app/pull/189)，squash 合併進 `main`。程式 commit `823428a` 由 Codex 實裝，基底 `d8b8720`。開發者指定 Claude Code 驗收；驗收紀錄在 [plan](../../tasks/archive/phase-2m-plan.md) 最後一節。
- 規格：[2m](../specs/phase-2m-home-visual-refresh.md)；plan、todo、設計討論紀錄已移到 `tasks/archive/phase-2m-*.md`。沒有改 schema、API、shared、套件、環境變數或 CI。
- 實作：首頁沿用八卡與儲存版面；趨勢左「總資產變化」、右「每月結餘」，只畫柱圖，切換時有滑動底板／柱高／零線動畫，只看站內動畫設定。借還改左右圓形頭像與姓名、中央支付箭頭與精確金額。
- 驗收數字：Web vitest 1118／1118；format、lint、typecheck、build exit 0；首頁與版面編輯 e2e 41／41。暫存驗收 e2e 3／3（驗完刪除）補驗了 API 原值、負值柱、動畫中途取消、站內動畫開關、換帳本、鍵盤、借還 1280／390／309px。
- 計畫外：PR 的 CI 在 SC-Y8 失敗。原因是舊斷言在右側面板轉場中取樣，不是產品回歸；面板開完後清單 551px 排兩欄，符合 2l SC-Y8。Codex 改成等面板與清單寬度穩定再判斷（`c975aac`），只動測試。
- 已部署 dev（只改前端，主工作區 `git pull` 後 Vite 自動更新）。
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

## 已知問題收尾（2026-10-28）

- 統計頁 e2e 偶發失敗：#194（`38ddbe3`）。一直沒有重現（`--repeat-each=10 --workers=1` 加 CPU 負載 50/50）。`stats.spec.ts` 一次量測就斷言的地方已全部改成整段重試，數值沒放寬。再出現時保留失敗的 trace。`--workers=4` 會因共用資料庫互撞（409 EMAIL_ALREADY_EXISTS、外鍵）失敗，不是版面問題。
- `getRect` 巢狀等待：#194。在外層 `expect.poll`／`toPass` 裡的 4 處改用只量一次的 `measureRectOnce`，其餘 24 處維持會重試的 `getRect`。
- 首頁版面 revision 到 2147483647 再存回 500：改成回繞成 1（2l 決策 333、SC-Y11，開發者 10-28 核可 advisor 與協調者的共識）。網頁補查時改成「revision 不等於 r 才算衝突」。advisor 提醒：首頁查詢 `staleTime: Infinity`，停著不重新整理的分頁在回繞後可能用舊 revision 蓋掉新版面，機率極低但不是零。10-29 已由 #206 改成不回繞，取代這個做法。

## 已知問題

- 無。

## 開發者在這次討論給的偏好

- 首頁版面跟著帳號存在伺服器；像 VS Code 一樣拖分隔線、拖卡片到另一張卡的半邊；按「編輯」才能拖；手機網頁固定（2l）。
- 根列只改自己的高度，整頁變長；列內分隔線才是一增一減（2l 決策 332）。

2k 的：

- 首頁選 A 版，右上放資產趨勢小圖，資產卡裡放支出分類（跟原 A 版互換）。
- 新增交易後，首頁所有圖卡要同時更新。
- 分類條配色做成設定：彩色、金色、灰色三選一。
