# 2j 實作計畫：收支統計與資產趨勢

spec：`docs/specs/phase-2j-stats.md`（決策 227～236、254～257、260～265、W201～W207、W215～W216、W220～W225、SC-R1～SC-R29）。後端、畫面、e2e 合成一個 PR。

> 核可：2026-10-23 開發者核可。advisor（Codex）2026-10-23 審過一輪，修訂內容見 §6 的第一筆紀錄。

## 0. 起點

- spec、本 plan、todo 先開 docs PR 合進 `main`。
- 合併後在 `stats-2j` worktree 從 `origin/main` 開整合分支：`git switch -c feature/phase-2j-stats-impl origin/main`。`main` 已在別的 worktree 簽出，所以不先切到 `main`。開完先跑 `pnpm install`。測試資料庫仍是 `ledger_stats_test`。只有協調者寫整合分支。
- 2j 只有這一個 session（`docs/handoff.md`）。協調者自己派 worker、驗收、合併，不另開後端或前端 session。
- 每個 worker 一個 worktree、一條子分支 `feature/2j-<名稱>`，從整合分支開。驗收後協調者 merge 回整合分支。
- 角色：統計的歸屬、分組、授權、資產公式派 `backend`；效能腳本派 `default`；網頁只派 Codex（`default` 角色）。模型看 `docs/orca-multi-agent.md` §0。
- 額度：Codex 用完時，網頁任務不換層，停下來問開發者。`backend` 用完時照 `docs/orca-multi-agent.md` §4：一小時內會重置就等，否則問開發者，不派給其他層。
- **不改資料模型，沒有 migration**（spec §3）。不加相依套件，圖表用 SVG 或 CSS 自己畫（W207）。
- 不改餘額公式（`accounts.service.ts` 的 `directionOf` 與加總方式）。§4.3 呼叫 `calculateBalances`，不複製一份。唯一的改動是在 `calculateBalances` 裡加安全整數檢查（§1.4）。

## 1. 元件與相依

### 1.1 協調者自己做（D0：契約與隔離測試）

- `packages/shared`：
  - 新檔 `types/statistics.ts`：`StatisticsPerspective`（`'LEDGER' | 'MINE'`）、`StatisticsTotals`、`StatisticsGroupKind`、`StatisticsGroup`（含 `percentageBps`）、`StatisticsPerson`、`LedgerStatistics`、`StatisticsTrend`，以及查詢參數 `GetLedgerStatisticsQuery`、`GetStatisticsTrendQuery`。形狀照 spec §4.1、§4.2，註解照抄 spec 的不變量。
  - `types/account.ts`：`BalanceTrend`、`GetBalanceTrendQuery`（spec §4.3）。
  - `index.ts` 匯出。4a 也會改這個檔，只多一行。
- 隔離測試 `apps/api/test/statistics-isolation.e2e-spec.ts`，先看到紅燈：
  - SC-R11 的矩陣：§4.1、§4.2 各自測「不是成員 404、已退出 404、未登入 401、檢視者 200、封存 200」；§4.3 測「未登入 401、別人的帳戶與交易不影響結果」。
  - SC-R7：小美的呆帳、結清差額（支出與收入兩個方向）、債務免除，我看到的是「未分類」；整個回應的 JSON 字串裡找不到對象名稱與往來 id；我和小美交替查，結果不互相影響。
  - **防假綠**：路由還不存在時，「不是成員 → 404」會直接通過。每條 404 的斷言都配一條正向對照（同一筆資料，成員查詢得到 200）。實作前，正向對照讓整個測試紅。
  - 「已退出」用真的退出 API 做出來，不直接改資料庫。
- 不寫 API 的空殼。路由不存在，隔離測試自然紅。

### 1.2 後端 A1：統計核心（S1a，`backend`）

只依賴 D0。這一段是歸屬規則的唯一來源，S1b、S2 都依賴它。

- 新目錄 `apps/api/src/statistics/`，本段只放純函式與 SQL 片段，不放 controller。
- `taipei-period.ts`：台灣日期與月份換成 UTC 半開區間（決策 231、264）。台灣沒有日光節約時間，固定 +08:00。不加日期套件。S2 也用這一份。
- `statistics-sql.ts`：一個「每筆交易算給誰多少」的 SQL 片段（CTE，SQL 裡的具名子查詢），用 `Prisma.sql` 組，參數化，不拼字串。totals、groups、people、趨勢、`MINE` 視角全部從這個 CTE 加總，**正式查詢只有這一套歸屬規則**（決策 230）。分帳份額要先依交易彙總再 JOIN，避免一筆交易被份額數放大。
- `attribution.ts`：同一套規則的純函式版本，**只給測試當對照**，正式查詢不呼叫它。
- `statistics-groups.ts`：分組與判定順序（決策 234、235）。決策 235 沿 `differenceOf → debtEntry → counterparty.ownerId` 判定。
- `percentage-bps.ts`：最大餘數法（決策 260）。乘以 10000 用 `BigInt`。
- 時間的 SQL 寫法：`date` 欄位是 `TIMESTAMP(3)`（沒有時區，存的是 UTC）。
  - 篩選用 `taipei-period.ts` 算出的 UTC 邊界：`date >= $from AND date < $to`。這樣能用到 `(ledgerId, date)` 索引。
  - 依台灣月份分桶要先標成 UTC 再轉：`("date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Taipei'`。不能直接寫 `date AT TIME ZONE 'Asia/Taipei'`，那會把 UTC 時間當成台灣時間，錯 8 小時。
- 測試：
  - 單元：決策 230 的歸屬、決策 234 的判定順序、決策 260（含同餘數、極小值、溢位）、台灣時間的期間換算（SC-R9、SC-R10 的日期邊界、跨月、閏日 2028-02-29）。
  - 單元測試另外用 `TZ=America/New_York` 跑一次，證明結果不受程式所在時區影響。
  - 差異測試（打自己的測試資料庫）：同一份種子，CTE 加總的結果等於 `attribution.ts` 算出的結果。種子涵蓋 SC-R28 的每種資料形態。連線設 `SET TIME ZONE 'America/New_York'` 時再跑一次，證明不受資料庫 session 時區影響。
  - 共用種子放 `apps/api/test/statistics-fixtures.ts`（§1 的「日常」「家用」），S1b、S2、S3 共用。

### 1.3 後端 A2：統計端點（S1b，`backend`）

依賴 S1a 合進整合分支。

- `StatisticsModule`、`StatisticsController`（`@ApiTags('statistics')`）、`StatisticsService`、DTO。在 `app.module.ts` 註冊（4a 也改這個檔，只多一行）。
- 授權：路由用既有的 `LedgerAccessGuard`（`VIEWER`＋`@AllowOnArchived()`，同 3l 標註端點）。service 層再用 `ledgerId`＋`userId` 查一次成員資格，不是成員就丟 404。spec §4 要求授權不只靠 controller。所有 SQL 都帶 `ledgerId` 條件。
- DTO：
  - §4.1：`from`、`to` 必填，`YYYY-MM-DD`，要驗證日期真的存在（2/30 → 400）。`to` 早於 `from`、含起訖超過 366 天 → 400。
  - §4.2：`endMonth` 必填 `YYYY-MM`；`months` 是 1～24 的整數，預設 12。
  - `perspective` 用 `@IsEnum`，預設 `LEDGER`。
  - 跨欄位的規則（起訖順序、366 天）放 service 或自訂 validator，worker 選一種，錯誤都是 400。
  - e2e 測每個 400：無效 enum；`months` 是 0、25、1.5、非數字；日期格式錯；日期不存在。
- 查詢：
  - 只讀型別是 `INCOME`、`EXPENSE`、`deletedAt` 是 null、`date` 在半開區間內的交易（決策 227、231、232）。
  - 全部從 S1a 的 CTE 加總，在資料庫算，不把交易逐筆拉回 Node。
  - `SUM` 的結果是 `bigint`。轉成 `number` 前檢查 `Number.isSafeInteger`，超過就丟標準錯誤，不截斷（spec §7 Always）。
  - 成員資格檢查、totals、groups、people 在同一個資料庫交易裡讀（`$transaction`，`RepeatableRead`），讓它們讀同一份快照（spec §4.1）。
  - 回應只帶 `kind`，不帶任何對象或往來的欄位（決策 235）。
- §4.2 趨勢：12 個月各自的 totals。一次 SQL 依台灣月份分桶（寫法見 §1.2）。沒有交易的月份補 0，由舊到新。
- API e2e：
  - SC-R1～R10、R12、R23、R27、R28。R27 的恆等式與 R28 的資料形態都要打真的端點（經過 SQL），不能只測純函式。
  - 決策 262 的正負不變量在每份種子上都檢查：收入、支出、每人金額不為負；分組只列大於 0 的。
  - 隔離測試 SC-R7、SC-R11 的 §4.1、§4.2 部分轉綠。

### 1.4 後端 B：資產趨勢（S2，`backend`）

依賴 S1a（用它的 `taipei-period.ts`），跟 S1b 平行。

- `AccountsController` 加 `GET /accounts/balance-trend`。使用者 id 只從 JWT 取，沒有帳本或使用者參數（決策 257）。DTO 規則同 §4.2 的 `endMonth`、`months`。
- `AccountsService.balanceTrend(userId, endMonth, months)`：
  - 在同一個 `RepeatableRead` 交易裡：先取使用者全部帳戶（含臨時帳戶，決策 254），再逐月呼叫既有的 `calculateBalances(accounts, tx, { date: { lt: 下個月 1 日 00:00 台灣時間 } })`，不另寫公式。
  - 先量 12 次呼叫的速度。SC-R13 超過 500ms 時，改成「一次算出顯示首月之前的基準＋依月份分桶的淨變動」，正負號仍只從 `directionOf` 來。改法記進實作紀錄。
- **安全整數**：`calculateBalances` 內部用 `number` 相加。只檢查最後的結果不夠，因為中間值超過安全範圍後，可能又加減回安全範圍，看起來正常其實已經不準。
  - 改法：在 `calculateBalances` 裡，每個 `_sum` 和每一次累加後都檢查 `Number.isSafeInteger`，不安全就丟標準錯誤。
  - 理由：每一步的運算元和結果都是安全整數時，浮點加法是精確的。真的超過時，算出來的絕對值也一定超過，必定被擋下。
  - 影響：公式不變。帳戶頁只有在原本就會算錯的情況下，改成回錯誤。
  - `balanceTrend` 的初始餘額合計與累積總額也照樣檢查。
- API e2e：SC-R16、SC-R17、SC-R29；隔離測試 SC-R11 的 §4.3 部分轉綠。
  - 最後一個點要等於 `GET /accounts` 所有帳戶餘額的合計（SC-R16）。
  - SC-R17 的「我已退出的帳本」用真的退出 API 做出來。`calculateBalances` 本身不查成員資格，要靠這條測試證明退出後的交易真的不算。
  - 既有帳戶 e2e 全綠。另加一條單元測試：中間值溢位時丟錯。

### 1.5 效能腳本（S3，`default`）

依賴 S1b、S2 合進整合分支。

- 一支獨立的 Jest 檔 `apps/api/test/stats-perf.perf-spec.ts`。它不符合 `jest-e2e.json` 的 `.e2e-spec.ts$`，也不符合單元測試的 `.spec.ts$`，所以不進 CI（spec §6）。
- 加 `apps/api` 的 `test:perf` script，沿用 `test:e2e` 的寫法：`cross-env NODE_OPTIONS=--experimental-vm-modules jest --config ./test/jest-e2e.json --runInBand --testRegex 'stats-perf\.perf-spec\.ts$'`。
- 驗收時跑 `pnpm --filter api test:e2e -- --listTests`，證明清單裡沒有這個檔。
- **先確認資料庫**：`load-env.ts` 不會覆蓋已經存在的 `DATABASE_URL`。終端機裡留著別的連線字串時，`resetDb` 會清錯資料庫。腳本開頭檢查資料庫名稱以 `_test` 結尾，不是就直接失敗，不灌資料。
- 用固定的亂數種子建 1 個使用者、1 本共享帳本、1 萬筆交易（含分帳、差額分支、刪除的），帳戶另有 12 個月以前的多年歷史。直接用 Prisma `createMany` 灌資料，不打 API。寫法參考 `debts-inline-perf.e2e-spec.ts`。
- 三個端點各暖機 5 次，依序量 100 次。排序後取第 95 筆（陣列索引 94）當 p95。
- 計時用 supertest 在同一個行程裡打，從送出請求到收完回應。這比 spec 的「進入 Nest 到回應完成」多了用戶端的成本，結果只會偏高，不會把不合格判成合格。
- 輸出 commit、Node 版本、PostgreSQL 版本、機器資訊。
- 協調者在整合分支跑一次，結果記進實作紀錄（SC-R13）。超過 500ms 時，先看 `EXPLAIN ANALYZE`。需要加索引就停下來問開發者（索引是 migration）。

### 1.6 畫面 A：首頁（W1，Codex）

只依賴 D0。元件測試用 `vi.mock` 替換 API。

| 區塊                   | 決策             | 主要檔案                                                                   |
| ---------------------- | ---------------- | -------------------------------------------------------------------------- |
| 資產趨勢圖             | W216、W206、W215 | 新元件 `features/statistics/BalanceTrendChart.tsx`、`use-balance-trend.ts` |
| 3 張卡                 | W201             | `pages/HomePage.tsx`、新 hook `use-ledger-statistics.ts`                   |
| 首頁版面與檔頭註解更新 | W215、spec §9    | `pages/HomePage.tsx`                                                       |

- 卡片的「本月」是台灣時間的這個月。月份字串由前端從今天的台灣日期取（`Intl.DateTimeFormat` 的 `timeZone: 'Asia/Taipei'`），起訖日也由前端組成 `YYYY-MM-01`～月底。這是組查詢參數，不是加總，不算業務邏輯。
- 共享帳本才有「我 $X」小字；看 `Ledger.kind`，不看成員數（CLAUDE.md §6）。
- 載入失敗時那一區顯示錯誤，不顯示 $0（SC-R14、W206）。
- 資產圖不跟著首頁帳本切換（決策 257），query key 不含帳本 id。
- 點卡片 → `/stats?tab=cat&ledger=<id>&month=<這個月>`。
- `use-ledger-statistics.ts` 也給 W2 用，介面寫成能帶任意期間與視角。
- 元件測試：W201、W206、W215、W216、SC-R14、SC-R18。

### 1.7 畫面 B：圖表元件（W3，Codex）

只依賴 D0，跟 W1 平行。純元件：只吃 props，不打 API、不讀網址。

| 元件                 | 用在       | 說明                                                                                  |
| -------------------- | ---------- | ------------------------------------------------------------------------------------- |
| `DonutChart`         | 分類、成員 | 甜甜圈，中心是方向與總額。弧度用 `percentageBps` 或傳入的分母換算。0 的切片不畫假面積 |
| `HorizontalBarChart` | 分類、成員 | 橫條，金額直接標在條旁                                                                |
| `TrendBarChart`      | 趨勢       | 每月收入、支出兩根，上方標選定月份的收入、支出、結餘                                  |
| `TrendLineChart`     | 趨勢       | 兩條折線；結餘跨過 0 時畫零線                                                         |
| `TrendTable`         | 趨勢       | 由舊到新的表格                                                                        |
| `CategoryLegendList` | 分類       | 色塊、名稱、金額、百分比；0 bps 顯示「<0.01%」                                        |
| `ChartTypeSwitch`    | 三個分頁   | 文字切換鈕，鍵盤可操作，觸控區至少 44px                                               |
| `chart-colors.ts`    | 分類色盤   | W224 的 6 色；顏色依分類 id 決定，不依排名；固定分組用中性灰                          |

- 檔案放 `apps/web/src/features/statistics/charts/`。
- 前端只做座標、弧度、長度換算與格式化（決策 261）。百分比顯示用 `percentageBps`，不自己算。成員圓餅的角度用傳入的分母，不顯示百分比（W220）。
- 每個圖都有讀屏可讀的精確值（W224、SC-R26）：SVG 的 `role`、`aria-label`，或旁邊的清單與表格。
- 元件測試：W207、W220、W221（用長名稱、大金額、15 類以上的資料檢查不截斷）、W223、W224、SC-R22 的圖表部分（空資料、單邊為 0、全 0 與常數序列、<0.01%、零線）。390px 的整頁檢查在 W4 用 Playwright 做。

### 1.8 畫面 C：統計頁（W2，Codex）

依賴 W1、W3 合進整合分支（重用 W1 的 hook 與 W3 的元件）。

| 區塊                | 決策                 | 主要檔案                                                        |
| ------------------- | -------------------- | --------------------------------------------------------------- |
| 路由與側欄          | W202                 | `app/routes.tsx`、`app/AppSidebar.tsx`                          |
| 篩選、摘要、分頁籤  | W203、W204、W225     | 新頁 `pages/StatsPage.tsx`、`features/statistics/`              |
| 網址與 localStorage | W203、W222           | 純函式 `features/statistics/stats-url.ts`（解析、正規化、輸出） |
| 三個分頁            | W205、W220、決策 263 | 用 W3 的元件                                                    |
| 點分類 → 相關交易   | 決策 236             | `pages/TransactionsPage.tsx` 讀入帶過來的篩選                   |

- 網址狀態：`stats-url.ts` 是純函式，負責：
  - 解析 `tab`、`ledger`、`month`／`year`／`from`＋`to`、`perspective`、`chart`。
  - 無效值退回預設並正規化。
  - 個人帳本的 `tab=member` 改成 `tab=cat`；成員分頁時 `perspective` 改成 `LEDGER`（決策 265）。
  - 優先順序：網址 → localStorage `stats.chart` → 預設（W222）。只有使用者按切換鈕才寫 localStorage；storage 丟例外時照常運作。
- 切換圖型只換元件，不改 query key、不重打 API（決策 263、SC-R19）。
- 趨勢的 `endMonth` 取期間的最後一個月，年模式是該年 12 月（決策 264）。畫面標出起訖月份（W205）。點某個月 → 期間切到那個月。
- 切帳本或期間時，不能短暫顯示上一本帳本的圖配新的摘要。摘要、分類、趨勢各自顯示載入與錯誤：一個端點失敗，只有那一區顯示錯誤（SC-R22、W206）。
- 點分類：只有「帳本」視角的 `CATEGORY` 可以點（清單列、切片、長條、圖例都算）。導到交易頁時帶入帳本、收支型別、分類、起訖日，其他篩選清掉，回到第 1 頁（決策 236）。
- 交易頁讀網址篩選（決策 236 的必要部分）：
  - 目前交易頁的篩選不從網址讀。W2 加這條入口，作法照 `TransactionsPage` 既有的 `view`、`tab` 參數。
  - 只在網址帶了篩選參數時套用；先用網址的帳本，再查那本帳本的資料。
  - 網址的值只在導入那一次套用。之後使用者手動改篩選，不能被 effect 蓋回去。
  - 測試：同一頁再次導入、返回鍵、無效日期與無效分類（退回不篩選）、手動改篩選後不被覆寫。既有的交易頁測試要全綠。
- 元件測試：W202～W205、W222、W225、SC-R19、R20、R22 的頁面部分、R24、R25、R26、決策 236。

### 1.9 Web e2e（W4，Codex）

依賴 S1b、S2、W1、W2 合進整合分支。

- 新檔 `apps/web/e2e/stats.spec.ts`：SC-R15 的主線（首頁點卡片 → 統計頁 → 切圖型 → 點分類 → 交易頁的相關交易）；重新整理與返回鍵還原狀態（SC-R20）。
- 390px（SC-R21）：長分類名稱、長人名、大金額、15 類以上，淺色與深色，斷言 `document.documentElement.scrollWidth <= clientWidth`，切換鈕高度至少 44px。
- Web e2e 用固定埠 3100、5273，ai-4a 也會跑（`docs/handoff.md`）。只查埠會有時間差。派 W4 前，協調者先看 ai-4a 有沒有正在跑 Web e2e 的 worker（`orca terminal list` 與 ai-4a 的交接檔），確認沒有才派。跑之前 worker 再查一次埠。

## 2. 實作順序

1. 開發者核可 → docs PR（spec、plan、todo、`docs/handoff/stats-2j.md`、`docs/handoff.md` 的 2j 那一列）→ 合併 → 從 `origin/main` 開整合分支、`pnpm install`。
2. D0（協調者）→ commit 到整合分支。
3. 第 1 波平行：S1a（`backend`）；W1、W3（Codex）。
4. 第 2 波平行：S1a 合併後派 S1b、S2（`backend`）；W1、W3 合併後派 W2（Codex）。
5. 第 3 波：S1b、S2 合併後派 S3；S1b、S2、W1、W2 都合併後派 W4。
6. 協調者整體驗收、spec §9 的文件影響、PR、部署。

## 3. 風險與對策

| 風險                                                       | 對策                                                                                                                                                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ledger`、`mine`、分組、`people`、趨勢的歸屬不一致         | 正式查詢只有 S1a 的一個 CTE，五處都從它加總；`attribution.ts` 只當測試對照，差異測試比對兩者；SC-R27 的恆等式打真的端點檢查                                                                    |
| 分帳份額 JOIN 把一筆交易的金額放大                         | 份額先依交易彙總再 JOIN；差異測試的種子含多人分帳                                                                                                                                              |
| 漏掉某種資料形態（代墊、合併、搬移、已離開的成員）         | SC-R28 逐種建資料，打真的端點；協調者逐行看 CTE 與函式                                                                                                                                         |
| 固定分組洩漏別人的借還（決策 235）                         | 判定沿 `counterparty.ownerId`，不用名字或帳戶猜；SC-R7 斷言整個回應的 JSON 字串裡沒有對象名稱、往來 id                                                                                         |
| 台灣時間換算錯一天或錯一個月                               | `date` 是無時區的 UTC，分桶先標 UTC 再轉台灣；純函式＋單元測試（SC-R9、SC-R10 的邊界、跨月、閏日 2028-02-29）；程式與資料庫的時區都換成別的再跑一次；e2e 用跨 10/31 23:30 與 11/1 00:10 的交易 |
| 加總超過安全整數，或中間值溢位後又加減回安全範圍           | SQL 加總轉 `number` 前檢查；`calculateBalances` 每一步都檢查；百分比用 `BigInt`；單元測試涵蓋                                                                                                  |
| 資產公式和帳戶頁不一致                                     | 直接呼叫 `calculateBalances`；SC-R16 斷言最後一點等於 `GET /accounts` 合計                                                                                                                     |
| 退出帳本後的交易仍算進資產                                 | `calculateBalances` 不查成員資格，靠 3k 退出時清掉引用；SC-R17 用真的退出 API 驗證                                                                                                             |
| 1 萬筆時超過 500ms                                         | SQL 在資料庫加總、篩選用 UTC 邊界走索引；S3 量 p95；需要索引時先問開發者                                                                                                                       |
| 效能腳本清錯資料庫                                         | 腳本開頭檢查資料庫名稱以 `_test` 結尾                                                                                                                                                          |
| 404 類的隔離測試在路由不存在時假綠                         | 每條配正向對照（D0）                                                                                                                                                                           |
| 網址、localStorage、返回鍵的組合太多，狀態錯亂             | `stats-url.ts` 純函式集中處理並單元測試；W4 的 e2e 測重新整理與返回鍵                                                                                                                          |
| 切換圖型時重打 API                                         | 圖型不進 query key；元件測試計算 fetch 次數（SC-R19）                                                                                                                                          |
| 交易頁加了網址篩選後弄壞既有行為                           | 只在網址帶參數時套用、只套用一次；既有交易頁的元件測試與 `transactions.spec.ts` 一起跑                                                                                                         |
| 390px 橫向捲動、文字截斷                                   | W4 的 Playwright 斷言 `scrollWidth`；協調者看淺色與深色的截圖                                                                                                                                  |
| 與 4a 改到同樣的檔案（`app.module.ts`、shared 匯出、側欄） | 每處只多一行；後合併的一方用 `gh pr update-branch` 併進 `main` 再解衝突                                                                                                                        |
| Web e2e 與 ai-4a 撞埠                                      | 派 W4 前看 ai-4a 有沒有在跑 Web e2e；跑之前再查埠；被占就等                                                                                                                                    |
| 額度用完                                                   | 網頁不換層，停下來問開發者；`backend` 一小時內重置就等，否則問開發者（`docs/orca-multi-agent.md` §4）                                                                                          |

## 4. 驗證點

- 每個 worker：`pnpm lint / typecheck / test / format:check`；後端再跑自己資料庫的相關 API e2e。
- 協調者：
  - 逐行看 `statistics/` 全部、`calculateBalances` 的改動、`balanceTrend`、`TransactionsPage` 讀網址篩選那段的 diff。重點是授權、歸屬 CTE、決策 235 的判定、時區寫法、安全整數檢查。
  - 自己重跑隔離測試（紅轉綠）、兩套 e2e、`pnpm build`、S3 效能腳本。
  - 用 Playwright 開 390px 與桌面，淺色與深色各截一張，逐項對 W220～W225。
- 部署後（dev）：
  - 首頁 3 張卡的數字等於統計頁同一本帳本、同一個月的摘要。
  - 資產圖最後一點等於帳戶頁的餘額合計。
  - 三個分頁各切一次圖型，點一個分類到交易頁。
  - 只讀，不在 dev 建資料。

## 5. 派工

| 波次 | worker          | 角色      | 範圍 | 驗收                                                                                           |
| ---- | --------------- | --------- | ---- | ---------------------------------------------------------------------------------------------- |
| 0    | 協調者          | —         | §1.1 | 隔離測試紅燈；shared build 後 typecheck 通過                                                   |
| 1    | `2j-stats-core` | `backend` | §1.2 | 單元測試（含另一個時區）；CTE 與 `attribution.ts` 的差異測試（含另一個資料庫時區）             |
| 1    | `2j-web-home`   | Codex     | §1.6 | W201、W206、W215、W216、SC-R14、R18 的元件測試；Web 檢查全綠                                   |
| 1    | `2j-web-charts` | Codex     | §1.7 | W207、W220、W221、W223、W224、SC-R22 圖表部分的元件測試；Web 檢查全綠                          |
| 2    | `2j-stats-api`  | `backend` | §1.3 | SC-R1～R10、R12、R23、R27、R28、決策 262、DTO 的 400；隔離測試 SC-R7、SC-R11（§4.1、§4.2）轉綠 |
| 2    | `2j-balance`    | `backend` | §1.4 | SC-R16、R17、R29；中間值溢位的單元測試；隔離測試 SC-R11（§4.3）轉綠；既有帳戶 e2e 全綠         |
| 2    | `2j-web-page`   | Codex     | §1.8 | W202～W205、W222、W225、SC-R19、R20、R22 頁面部分、R24～R26、決策 236 的元件測試               |
| 3    | `2j-perf`       | `default` | §1.5 | 腳本能跑、輸出 p95 與環境資訊；`--listTests` 證明不進 CI；非 `_test` 資料庫時直接失敗          |
| 3    | `2j-web-e2e`    | Codex     | §1.9 | 兩套 Web e2e 全綠，含 SC-R15、R20、R21                                                         |

- 會碰資料庫的 worker（`2j-stats-core`、`2j-stats-api`、`2j-balance`、`2j-perf`、`2j-web-e2e`）各用一個 `ledger_2j_<名稱>_test` 資料庫，`.env` 與 `.env.test` 都指向它（`docs/orca-multi-agent.md` §3）。
- worker 的新 worktree 第一件事跑 `pnpm install`。
- worker 不改 `packages/shared`（要改先問協調者）。
- W1 與 W3 都改 `apps/web`，但檔案分開：W1 在 `pages/HomePage.tsx` 與 `features/statistics/` 的首頁元件；W3 只在 `features/statistics/charts/`。
- 做完的 worker 驗收合併後，立刻 `worker-release`，再清 worktree、子分支、終端機、worker 測試資料庫。

## 6. 實作紀錄

- 2026-10-23 advisor（Codex `gpt-6.1-sol` xhigh）審 plan 第一版，修訂如下：
  - S1 拆成 S1a（統計核心）與 S1b（端點）；S2 改依賴 S1a，不再各寫一份台灣時間換算。
  - 正式查詢只用一個歸屬 CTE；`attribution.ts` 降為測試對照。
  - 修正時區寫法：`date` 是無時區的 UTC，分桶要先標 UTC 再轉台灣。
  - `calculateBalances` 加每一步的安全整數檢查（原本只檢查最後結果）。
  - 成員資格檢查與帳戶清單也放進同一個快照。
  - W2 改依賴 W1 與 W3。
  - 補驗收：決策 262、DTO 的 400、單一端點失敗、SC-R17 用真的退出 API、效能腳本的資料庫檢查與 `--listTests`。
  - 修正 `backend` 額度用完的規則（不換層）。
  - 沒有採納：快照一致性的併發測試。這種測試要靠時間差製造衝突，結果不穩定。改由協調者逐行確認查詢都在同一個 `RepeatableRead` 交易裡。
- 2026-10-23 D0（`82667c7`）：shared 型別與 13 條隔離測試，路由不存在時全紅（404）。
- 2026-10-23 S1a 驗收通過，合進整合分支（`52a0eea`）。協調者重跑單元測試 68 條（另用 `TZ=America/New_York` 再跑一次）與 `statistics-core` e2e 3 條，全過。測試資料庫的時區是 `Asia/Taipei`，10/31 與 11/1 的邊界測試照樣通過，證明篩選不受 session 時區影響。
- 流程偏離：S1a 與 W3 的 `worker_done` 在驗收前就 ack 了，違反 `docs/orca-multi-agent.md` §2「驗收沒過不要 ack」。S1a 後來驗收通過；W3 改用 reply 退回。之後一律先驗收再 ack。
- 2026-10-23 W3 第一次交付（`6b2ce58`）退回補 3 點：趨勢長條圖與折線圖滑過或聚焦時預覽該月、點擊才選月份；三個元件重複的固定分組名稱抽成一份；折線圖 y 軸處理負值、零線畫在 0 的真實位置。
- 2026-10-23 第 2 波派出 S1b（`2j-stats-api`）與 S2（`2j-balance`），各用自己的測試資料庫。
- 2026-10-23 W1 驗收通過，合進整合分支（`a74129f`）。協調者重跑 web typecheck、lint、822 個測試、prettier，全過。已知小事：台灣當月的換算在 `use-balance-trend.ts` 與 `HomePage.tsx` 各寫一份，W2 做 `stats-url.ts` 時收成一份。
- 2026-10-23 W3 第二次交付（`8bad61e`）再退回 2 點：`TrendLineChart` 的滑過預覽、點擊選月份沒有做；`TrendLineChart.test.tsx` 有 3 條斷言被放寬（`'收入 $0'`→`'$0'` 等），元件文字沒變，要改回精確斷言。原 dispatch 已結束，worker 改送 status 訊息回報。
- 2026-10-23 Task spec 的指令寫錯：`pnpm --filter @ledger/api test:e2e -- statistics-isolation -t "..."` 的 `--` 會讓 Jest 把 `-t` 當成檔名篩選，結果跑到別人的測試。正確寫法是不加 `--`：`pnpm --filter @ledger/api test:e2e statistics-isolation -t balance-trend`。S1b、S2 都自己發現並改用正確指令。之後的 Task spec 照正確寫法寫。
- 2026-10-23 W3 第三次交付（`969588c`）通過，合進整合分支（`e37e92f`）。
- 2026-10-23 第 2 波派出 W2（`2j-web-page`，從 `e37e92f` 開）。Task spec 補一項釐清：分類分頁的支出／收入切換只是頁面狀態，不寫進網址，也不寫 localStorage。
- 2026-10-23 S2 驗收通過，合進整合分支（`3520907`）。協調者重跑 `balance-trend` 21 條、隔離 2 條、帳戶回歸 38 條、全套單元測試與檢查，全過。12 個月查詢實測 35.67ms，沒有改成分桶算法；`calculateBalances` 簽名只加可選的 client 與日期條件。SC-R17 用真的退出 API 做出來，退出後趨勢與帳戶頁都歸 0。
- 2026-10-23 S1b 驗收通過，合進整合分支（`1eb481d`）。協調者重跑 `statistics` 25 條、`statistics-core` 3 條、`ledgers` 15 條、全套單元測試與檢查，全過。
- 2026-10-23 整合分支跑隔離測試全套 13/13 轉綠；`statistics*` 41、`balance-trend` 21、帳戶與帳本回歸 53 條全過；API 單元 714、Web 843、shared 116，lint、typecheck、format 全過。
- 2026-10-23 計畫外問題：W3 的 `DonutChart`、`HorizontalBarChart` 沒有點擊回呼，只有 `CategoryLegendList` 有。決策 236 要求切片與長條也能點，W3 驗收時漏看。W2 回報後，協調者放寬 W2 的檔案權限，讓它在這兩個元件的 groups 資料加可選的 `onSelect`（只有 `CATEGORY` 可點），既有斷言不得放寬。在已核可範圍內，不改 spec。
- 2026-10-23 W2 第一次交付（`017dde5`）退回補 4 點。協調者重跑 Web typecheck、lint、869 個測試、format，全過；圖表元件的改動沒有放寬既有斷言。要補的：側欄「統計」與「交易」共用 `receipt` 圖示，收合後分不出來，改用新的統計圖示；統計頁切帳本用 `replace`，返回鍵回不到上一本帳本（SC-R20），改 push；交易頁缺返回鍵的測試；統計頁缺 SC-R26 的純鍵盤測試。已知小事，不在 W2 範圍：交易頁的日期篩選沿用既有寫法，用瀏覽器時區換算，統計用台灣時間；決策 236 本來就不保證相關交易加總等於統計。
- 2026-10-23 S3 escalation：第一次執行 §4.1（一整年）p95 966.7ms，超過 500ms；同一份種子再跑兩次是 269.6ms、272.2ms。趨勢約 110ms，資產趨勢約 20～37ms。`EXPLAIN ANALYZE`：統計端點的三組查詢約 53、79、76ms，依序在同一個交易裡執行，加起來就是 median 的 218ms；交易表 1 年 8,193 列走循序掃描只要 1.6ms。worker 沒改 service、沒加索引。協調者會在機器沒有其他負載時自己重跑，再決定要不要處理。
- 2026-10-23 S3 驗收通過，合進整合分支（`0d5c38d`）。worker 共跑 5 次，統計端點 p95 只有 1 次超標（966.7ms），其餘 4 次 269.6～281.2ms。協調者在 CPU 負載 7～20% 時重跑 2 次：統計 272.4／276.2ms、趨勢 122.9／105.9ms、資產趨勢 27.1／26.2ms，都低於 500ms，所以不改 service、不加索引。966.7ms 那次沒能重現，worker 也不確定當時有沒有其他測試同時在跑，判斷是機器負載造成的。`test:e2e --listTests` 共 50 份，不含 `stats-perf`；資料庫名稱不以 `_test` 結尾時，在灌資料前就失敗。已知限制：多年歷史只有 36 筆，資產趨勢的負擔偏輕。
- 2026-10-23 W2 補正（`e0b9522`）驗收通過，合進整合分支（`c45df46`）。補了 4 點：側欄「統計」改用新的 `chart` 圖示；統計頁切帳本改成 push，返回鍵能回到原帳本；交易頁補「再次導入後按返回」的測試；補 SC-R26 純鍵盤測試，摘要與成員清單加 aria-label 讓讀屏讀到精確金額。整合分支全套檢查：lint、typecheck、format:check、build 通過；單元測試 API 46 份／714、Web 114 份／873、shared 116，全過。
- 2026-10-23 W4 第一次交付（`21b56b1`）退回補 3 點：「日常」少了「現金 → 儲蓄 轉帳 $1,000」，沒驗到轉帳不算收支；觸控區檢查找不到元素時會直接通過；長成員名稱只檢查有出現，沒檢查被截斷。
- 2026-10-23 W4 補正（`6d0c3aa`）驗收通過，合進整合分支（`a22235e`）。新檔 `apps/web/e2e/stats.spec.ts` 4 條測試：SC-R15 家用主線、SC-R15 日常、SC-R20 網址與返回鍵、SC-R21 390px 淺色與深色；`api.ts` 新增 `updateUserName`、`createCategory`、`forgiveCounterparty`。協調者跑前查過埠是空的，重跑 `stats.spec.ts` 4 passed、完整 Web e2e 72 passed。
- 2026-10-23 D1 效能（SC-R13，commit `d170642`，Node v22.23.1、PostgreSQL 18.4、i9-12900F 24 核心、63.8 GiB、win32）：第一次在背景跑時，統計端點 p95 907.1ms 超標，當時截圖測試同時在跑。CPU 負載 10% 時重跑 2 次：統計 260.1／307.7ms、趨勢 104.7／95.5ms、資產趨勢 25.1／25.1ms，都低於 500ms。和 S3 一樣判斷是機器負載，不改 service、不加索引。
- 2026-10-23 D1 截圖對照（390px 與 1280px、淺色與深色，共 32 張）找到 3 個畫面問題，jsdom 不計算 CSS 所以元件測試沒抓到：(1) 折線圖的線被填色，CSS 後寫的 `fill` 蓋掉 `fill: none`，支出線變成一塊紅色三角形；(2) 390px 下趨勢圖的月份標籤逐字切斷（「202／5年／11／月」），表格月份欄也斷在年中間；(3) 成員清單沒有色塊，看不出圓餅哪一片是誰（W221、W224）。屬於已核可範圍內的修正，派 W5（`2j-chart-fixes`，`default`）修，並在 `stats.spec.ts` 加 computed style 斷言防再犯。
- 2026-10-23 W5 第一次交付（`5792554`）退回補 2 點：390px 折線圖 12 個月份標籤相鄰沒有空隙（「11月12月1月」讀起來像一串字）；`stats.spec.ts` 每次跑都把截圖寫進 `docs/artifacts/`，CI 也會寫。折線 fill、長條圖標籤、表格月份欄、成員色塊已通過。
- 2026-10-23 W5 第二次交付（`05e22f7`）退回補 1 點：390px 隔月顯示、標籤空隙 ≥ 4px、測試不再寫截圖都已通過，但月份標籤用 12 欄網格平均排，點卻從最左排到最右，標籤沒有對齊它的點（「11月」排在 12 月那個點下方，10 月的尖峰旁最近的標籤是「9月」），會讓人讀錯月份。要求標籤照點的 x 定位，e2e 比對標籤與點的中心誤差 ≤ 6px；另外拿掉窄的時候月份與年份之間多出的空白行。
