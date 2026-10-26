# 2l 實作計畫：首頁 A+ 版面與可編輯版面

spec：`docs/specs/phase-2l-home-layout.md`（決策 313～335、W272～W287、SC-Y1～SC-Y29）。分 3 個 PR，依序合併。

> 核可：開發者 2026-10-25 核可本 plan 與 todo。schema（`UserHomeLayout`）、API（兩個版面端點）、試裝拖動套件的方向已同意；C0 試裝前再確認套件清單。

## 0. 起點

- spec、本 plan、todo 先開 docs PR 合進 `main`。同一個 PR 更新 `docs/handoff.md`（`stats-2j` 那一列與編號分段）和 `docs/handoff/stats-2j.md`。
- 目前的 `feature/home-design-align`（A+ 對照圖的決策紀錄、「網頁設計也交給 Codex」）併進這個 docs PR，不另開。
- 3 個 PR 各從 `origin/main` 開一條分支，前一個合併後才開下一個。不開整合分支：每個 PR 只有 1～2 個 worker，協調者直接在 PR 分支上 merge worker 的子分支。
  - PR1：`feature/2l-home-aplus`
  - PR2：`feature/2l-home-layout-api`
  - PR3：`feature/2l-home-layout-edit`
- 角色：
  - 網頁只派 Codex（`default` 角色）。Codex 用完時不換層，停下來問開發者。
  - PR2 的 migration、條件更新、隔離派 `backend` 角色。
  - 協調者自己寫：`packages/shared` 的型別與預設版面常數（PR1）、`parseHomeLayoutV1` 的測試（PR2，先紅燈）、隔離 e2e（PR2，先紅燈）。
- 協調者不改 `apps/web`。

## 1. PR1：A+ 版面（決策 313～320、322～324、336、W272～W279、W287）

### 1.1 S1：共用型別與預設版面（協調者）

- 新檔 `packages/shared/src/types/home-layout.ts`：`HOME_CARD_IDS`、`HomeCardId`、`HomeLayoutNode`、`HomeLayoutBand`、`HomeLayoutV1`、`DEFAULT_HOME_LAYOUT_V1`（spec §3.2）。
- 只有型別與常數。驗證函式放 PR2。
- `index.ts` 匯出。跑 `pnpm --filter @ledger/shared build`。
- shared 測試：預設版面每張卡剛好一次、權重加總 10000。只 `import type` 會測不到常數，所以這條測試放 web（`apps/web/src/features/home/default-layout.test.ts`），由 W-A1 的 worker 寫。

### 1.2 W-A1：版面渲染與卡片拆分（`2l-aplus`，Codex）

依賴 S1。一個 worker 做完 PR1 的網頁部分，因為卡片拆分與渲染器互相牽動，拆開會一直撞同一批檔案。

- **卡片登記表** `apps/web/src/features/home/card-registry.tsx`：`HomeCardId` → 標題、最小寬度、渲染函式。最小寬度從 20rem 起，實測後填。限制：預設版面在 1280px、左側欄展開、有直向捲軸（內容區約 961px）時不能換行，所以三欄列的每張卡 ≤ (實際內容寬度 − 2 × 間距) ÷ 3（SC-Y1）。
- **卡片外框** `HomeCard`（決策 320）：標題列、右上連結、內距。PR3 的拖動把手與「移到…」按鈕會放在這個標題列，現在先留一個空的插槽。
- **渲染器** `HomeLayoutRenderer`：吃 `HomeLayoutV1`，畫根列與分割樹。左右分割用 CSS grid `minmax(最小寬度, 權重 fr)` 加固定間距（決策 324）。
  - 節點的不換行最小寬度：卡片取登記表；左右分割＝子節點總和＋(n−1)×間距；上下分割＝子節點最大值。寫成純函式 `minWidthOf(node)`。這個值只用來判斷要不要換行、畫編輯畫布，不當成閱讀模式的硬性欄寬。
  - 換行（決策 324）：用 `ResizeObserver` 量分割容器寬度，最小寬度大於可用寬度就照順序分行。換行算法寫成純函式 `wrapSplit(widthPx, minWidths, weights, gapPx)`，不碰 DOM。單元測試：剛好放得下、差 1px、全部換行、權重分配遇到最小寬度的夾限（可用 700px、兩卡 320px、權重 6667／3333）、間距有扣。
  - 巢狀換行（決策 324、SC-Y29）：單獨佔一行的子節點寬度不超過那一行，它的子樹用同一規則往下換行；上下分割跟著可用寬度縮。單元測試用 `x[expense, y[x[income, net, trend, categories], x[activity, accounts, debts]]]`，在 1152px 與 976px 時每一層的結果都不超過可用寬度。
  - 渲染器留一個「不換行」的模式（PR3 編輯畫布用，寬度不夠時畫布自己橫向捲動），PR1 先不用。
  - 根列的 `extraHeightPx` 在 PR1 一律是 0，但渲染器要支援，PR3 才不用回頭改。
- **待處理卡**插在第 1 根列之後（決策 322）。
- **≤900px**（決策 323）：用 `matchMedia('(max-width: 900px)')`，固定順序一欄，不經過分割樹。
- **沒有帳本**（W287）：固定版面，不經過分割樹。
- **卡片拆分**：
  - `trend`：`BalanceTrendChart` 加總資產標題（決策 314）。圖面高度跟著卡片，最小 180px（W274）。2k W261 的「不比左卡高」那段量測邏輯拿掉。
  - `categories`：`HomeCategorySection` 獨立成卡，每類兩行加進度條（W275）。
  - `accounts`：從 `AssetCard` 拆出帳戶清單（W276）。`AssetCard` 拆完沒人用就刪。
  - `expense`／`income`／`net`：`LedgerStatsRow` 拆成 3 張獨立卡（W273）。
  - `debts`：`DebtsCard` 的兩處箭頭換成首頁摘要版 `HomeBalanceSummaryArrow`（決策 317）。`BalanceArrow`、`DebtArrow` 不改。
  - `activity`：`ActivityCard` 套上 `HomeCard` 外框，內容不變。
- **金色規則**（決策 315）：`use-home-category-colors.ts:77` 改成只看 `expenseGroups` 整體第一列。需要傳進「是不是第一列」與第一列的種類。
- **container query**（決策 319）：帳戶清單的兩欄斷點改用 container query，量展開後清單自己的內容寬度；收起時一律一欄（照現有 `HomeAccountList`）。
- **借還摘要箭頭**（決策 317）：往來對象吃 `counterparty.totalBalance`，未指向帳本的人吃 `people.amount`；元件測試兩個來源各驗正、負、0。
- 資料仍由 `LedgerView`／`Dashboard` 打，卡片只吃 props；決策 307（切帳本不重打個人資料）與 306（寫入後一起更新）的結構不能動。
- 2k 留下的測試：SC-H2、H3 的請求增量測試照樣過。選擇器跟著新版面改，不刪驗證的行為。

### 1.3 W-A2：PR1 的 Web e2e（`2l-aplus-e2e`，Codex）

依賴 W-A1。派工前確認沒有別的 worktree 在跑 Web e2e，3100、5273、5274 沒被佔。

- `e2e/home.spec.ts` 改寫：SC-Y1（1280px、左側欄展開與收合各一次，量 8 張卡的位置與寬度比例，容許 2px 誤差）、SC-Y2（390、900、901px）、SC-Y3（從登記表算出的 3 種內容寬度，沒有橫向捲動）、SC-Y8（6 個帳戶、展開後清單 content box 439／440px，收起時一欄）、SC-Y4 的趨勢卡高度。
- 2k 的 SC-H14（390px 長字、深淺色）照樣跑。
- 截圖：1280px 與 390px，淺色與深色，三種配色。協調者逐張看。

### 1.3a W-A3：首頁窄卡的交易列（`2l-aplus`，Codex）

依賴 W-A2。照決策 336、SC-Y30。

- 只改首頁 `activity` 卡的「最近」與「標註」列。用 container query 依列的寬度切換：一行放得下時照舊；放不下時改成多行，名稱不被擠成 0。排法由 Codex 決定。
- 交易頁的列不動：52px、7rem 金額欄（3d T13、2k 決策 312）。所以首頁的樣式要限定在首頁，不改交易列元件的預設。
- 不改決策 318 的預設版面與 309px 最小寬度，不加寬其他卡，不加每列日期。
- e2e 照 SC-Y30：309px 卡寬量幾何（寬度大於 0、不重疊、不超出卡片），不只檢查可見；6 種列（短名稱借還、差額還清、臨時帳戶、分帳、標註、展開）；390px 與寬卡；深淺色截圖。2k SC-H14 裡首頁列高 52px 的斷言改成新規則，交易頁的 52px 斷言不動。
- 檔頭與註解照 `CLAUDE.md` §7 補「為什麼首頁跟交易頁不同」。

### 1.4 PR1 驗收（協調者）

- diff 只有 `apps/web`、`packages/shared/src/types/home-layout.ts` 與匯出、文件。沒有 `apps/api`、沒有新套件。
- 自己重跑 SC-H2、SC-H3 並看請求增量。
- `pnpm lint / typecheck / test / build / format:check` 與兩套 Web e2e 全綠。
- 截圖對過 W272～W279、W287 與 A+ 對照圖。
- 合併後在主工作區部署 dev，提醒開發者按 `Ctrl + Shift + R`。開發者看過再開 PR2。

## 2. PR2：伺服器儲存（決策 321、330、333、334）

### 2.1 S2：紅燈測試（協調者，先寫）

- `packages/shared/src/home-layout.test.ts`：`parseHomeLayoutV1` 的每一條規則（spec §3.2、§3.3）各至少一組合格與一組不合格。被測檔只能 `import type`，所以預設版面用測試裡自己寫的字面值。
- `apps/api/test/home-layout-isolation.e2e-spec.ts`：SC-Y10、SC-Y13。照 `ai-quota-isolation.e2e-spec.ts` 與 `e2e-utils.ts` 的寫法。
- 兩支都先跑一次，確認是紅燈（模組不存在），再派工。

### 2.2 B1：驗證函式、資料表、API（`2l-layout-api`，`backend`）

依賴 S2。一個 worker：驗證函式、migration、service、controller 互相依賴，量也不大。

- `packages/shared/src/home-layout.ts`：`parseHomeLayoutV1(input: unknown)`，回傳 `{ ok: true, layout } | { ok: false, reason }`。
  - 先 `JSON.stringify` 量 UTF-8 長度（`TextEncoder`），超過 16384 直接失敗，不走訪。
  - 走訪用 `Object.keys` 加 `Object.prototype.hasOwnProperty.call`，物件要是 plain object（`Object.getPrototypeOf` 是 `Object.prototype` 或 `null`）。
  - 收集出現過的卡 id，最後比對剛好 8 張。
- Prisma：spec §3.1 的 enum 與 model；`User` 加反向關聯。migration 名稱 `<timestamp>_user_home_layout`，只建表、enum、外鍵。
- `apps/api/src/users/`：
  - `home-layout.service.ts`：`get(userId)`、`put(userId, dto)`。
  - PUT 的條件更新照 spec §4.2：`expectedRevision > 0` 用 `updateMany` 帶 revision 條件，`count === 0` 回 409；`expectedRevision === 0` 用 `create`，Prisma `P2002`（違反唯一）回 409。不在 transaction 裡先讀再寫。
  - DTO：`schemaVersion` 必須是 1；`expectedRevision` 是 0 以上整數；`layout` 用 `@IsObject()` 或 null，再在 service 呼叫 `parseHomeLayoutV1`。不合格丟 `BadRequestException('版面格式不正確')`。`layout` 不用 class-validator 的 nested，全站 `whitelist` 就不會遞迴進去（advisor 已核對 `validation.pipe.js`）。worker 仍寫一條 e2e：存一份再讀回，樹完整。
  - 禁鍵 guard（決策 334）：全站 pipe 會先默默刪掉 `__proto__`、`constructor`、`prototype`（`validation.pipe.js:64-65`、`170-196`），service 看不到。所以 PUT 端點掛一個 guard，在 pipe 之前掃 `req.body` 的自有鍵，出現就丟 `BadRequestException('版面格式不正確')`。用明確的堆疊走訪，不用遞迴；巢狀超過 32 層直接丟同一個例外。`parseHomeLayoutV1` 也照樣拒絕這三個鍵。不要繞過 DTO 改吃原始 body。
  - DTO 層的錯誤照全站既有格式（`Validation failed`＋`details`），不另做轉換（spec §4.3）。
  - controller 加 `GET me/home-layout/web`、`PUT me/home-layout/web`，userId 取 `user.sub`。OpenAPI 標註。
- `error-codes.ts` 加 `HOME_LAYOUT_REVISION_CONFLICT`，409 回應帶這個碼（照既有 409 的格式）。
- 測試：service 單元測試（條件更新、P2002、null 重設）；API e2e：SC-Y11（含兩個並發請求，用 `Promise.all`）、SC-Y12 的 6 條 400 並確認資料庫沒變（`__proto__`、`constructor` 用 `.send(原始 JSON 字串)` 加 `Content-Type: application/json`）；guard 的單元測試。

### 2.3 PR2 驗收（協調者）

- 逐行看 migration SQL、service、controller、DTO 的 diff。
- 自己重跑隔離 e2e 與並發 e2e，各跑 3 次確認不閃爍。
- 確認 OpenAPI 文件出現兩個端點、DTO 型別正確。
- `pnpm lint / typecheck / test / build / format:check` 與 API e2e 全綠。
- 合併後在主工作區部署 dev：先跑 migration 再起 API。

## 3. PR3：編輯模式（決策 325～329、331、332、335，W280～W286）

### 3.1 C0：拖動套件檢查點（Codex，不合併）

依賴 PR1。可以跟 PR2 平行。派工前先向開發者確認要試裝 `@dnd-kit/react` 0.5.1、`@dnd-kit/core` 6.3.1、`react-resizable-panels` 4.14.8 三個套件（spec 決策 335 核可的是「試」，選定的那個才進 PR3）。

- 拋棄式分支 `spike/2l-dnd`。兩個最小頁面，各用一個 dnd 套件，加 RRP 的左右分隔線。
- 照 spec §6.3 的 8 條跑正式 build 的 Playwright。
- 交回：每條過或不過與證據、整合成本（要關掉或重做的插件、轉接層行數）、建議選哪個。
- 協調者照決策 335 選，結果寫進本 plan §6 實作紀錄，再跟開發者報告。選定的套件才裝進 PR3。

### 3.2 E1：版面運算（`2l-layout-ops`，Codex）

依賴 PR2 合併（要用 shared 的 `parseHomeLayoutV1`）。純函式，不碰 DOM，`apps/web/src/features/home/layout-ops.ts`：

- `moveCard(layout, cardId, targetCardId, side)`：從原位置移除 → 收合空分割與單子分割 → 插到目標旁 → 同方向分割壓平 → 權重重新正規化到加總 10000。
- `canDrop(layout, cardId, targetCardId, side, sizes)`：一半小於最小尺寸就不行（決策 327）。
- `resizeSplit(layout, path, index, deltaPx, containerPx, minPx)`：一增一減。
- `resizeBand(layout, bandIndex, deltaPx, minPx)`：只改那一列的 `extraHeightPx`，限 0～1600。
- 每個函式的輸出都通過 `parseHomeLayoutV1`（測試用 property 的方式：隨機做 200 次移動，每次都合格）。

### 3.3 E2：編輯模式介面（`2l-layout-edit`，Codex）

依賴 C0、E1。

- `use-home-layout.ts`：GET 與 PUT，query key `['home-layout', 'web']`。讀到的版面先過 `parseHomeLayoutV1`，不合格用預設（SC-Y24）。`layout: null` 用預設。
- 編輯狀態：草稿、原始 revision、是否有改動。「完成」「取消」「重設為預設」（決策 326）。
- 拖動轉接層：只在這一層用 C0 選定的套件，轉成 `moveCard` 呼叫。
- 列內分隔線：RRP。根列高度把手：自己用 Pointer Events 加鍵盤（W284）。
- 「移到…」選單（W283）、live region、焦點（決策 328）。
- 409 彈窗與網路錯誤、逾時（決策 329、W285）：`api-client.ts` 加可選的 `signal`；PUT 10 秒用 `AbortController` 中止；中止、網路錯誤、409 後都先 GET，用結構比對（不比字串）判斷是否已存。比對函式寫成純函式並單元測試。
  - 這次 GET 直接打網路（不用 React Query 快取），有自己的 10 秒逾時與自己的 signal。
  - 送出到判斷結束之間，停用會改草稿的操作。結果回來先比對世代號碼，不符就丟掉，不做後續動作。
- 草稿 store（W286）：放在首頁之外（App 層 context 或模組層 store），以使用者 id 區分。
  - 存整個編輯工作階段：草稿、是否在編輯、原始 revision、進編輯時的版面、是否有改動。回到首頁沿用原始 revision。
  - 世代號碼：登出、換使用者、「取消」時加 1，並中止進行中的請求。`AuthProvider.tsx:41-47` 目前登出只清 token、帳本偏好與 QueryClient，要接上 store。
  - 有改動時掛 `beforeunload`，掛在不會跟著首頁卸載的那一層。
- ≤900px 暫停編輯、草稿保留，暫停期間不寫回草稿、不更新原始 revision（決策 323）；編輯畫布用渲染器的不換行模式，寬度不夠時畫布橫向捲動（決策 324）。
- `canDrop` 與「移到…」共用一個檢查：結果的深度與節點數不超過 `parseHomeLayoutV1` 的上限（決策 327、SC-Y28）。不檢查最小寬度。
- 不是編輯模式時，首頁行為與 PR1 相同（SC-Y22）。
- 與 4a AI 入口（`feature/ai-icon-entry`，4a spec W246～W256）的界線，照 4a 的 W256（ai-4a 協調者 2026-10-26 通知）：
  - 編輯模式若用 `inert` 鎖住首頁其他部分，不可包住 AI 草稿區（`<AiDraftSection>`，在 PageHeader 之後、`HomeLayoutRenderer` 之前）。
  - 重寫 `TransactionWorkbench` 時保留 `onDraftSaved` 與 `onDraftSavingChange` 兩個回呼。
  - 首頁不加會重建共用狀態的 `key`（例如帳本 id 當 `key`），否則 AI 草稿會退回頁面生命週期。
  - 拖動或調整卡片期間 AI 結果到達、草稿區長高把版面往下推，落點仍要正確：落點依放開當下量到的位置判斷，不用開始拖動時快取的座標。

### 3.4 E3：PR3 的 Web e2e（`2l-layout-edit-e2e`，Codex）

依賴 E2。SC-Y14～Y21、Y23、Y26～Y29。

- SC-Y26 的舊版面與 SC-Y29 的巢狀版面：用 API 先 PUT 進去再開首頁。

- SC-Y14 的另一台裝置：同一個測試開第二個 browser context 登入同一帳號。
- SC-Y18 的兩個分頁：同一個 context 開兩個 page。
- SC-Y19 的 4 條路徑：PUT 直接失敗；`page.route` 擋住 PUT 超過 10 秒（還沒存進去）；同上再讓 GET 也失敗；`route.fetch()` 先送到後端、再延遲回應（已存進去）。
- SC-Y23：沿用 `csp.spec.ts` 的做法，打 `vite preview`，進編輯模式拖一次，console 沒有 CSP 違規。
- AI 結果在拖動中到達（4a 要求的驗收）：拖動或調整卡片時，讓 AI 解析的回應到達、草稿區長高，放開後落點仍正確。4a 還沒合併時，這條等 AI 入口進 `main` 再補（見 §3.5）。

### 3.5 PR3 驗收（協調者）

- diff 的新套件只有 C0 選定的那些，版本鎖定。
- 存出去的 JSON 都過 `parseHomeLayoutV1`（看 e2e 攔到的請求內容）。
- 自己用鍵盤走一次 SC-Y20。
- lint、typecheck、test、build、format:check、兩套 Web e2e 全綠。
- 與 4a AI 入口誰後合併誰解衝突（`HomePage.tsx` 會被兩邊改）。PR3 後合併時，協調者跑首頁整合驗收：編輯版面時 AI 區仍能操作、表單儲存後草稿移除、切帳本與換頁不丟草稿（4a SC-P29 第 1、5 項），並補上 §3.4 的「AI 結果在拖動中到達」。
- 合併後部署 dev，先 `pnpm install`，提醒按 `Ctrl + Shift + R`。

## 4. 風險與對策

| 風險                                                     | 對策                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 全站 pipe 先刪掉 `__proto__` 等鍵，service 看不到        | PUT 端點的 guard 在 pipe 之前擋；e2e 用原始 JSON 字串送；另存一份再讀回確認樹完整  |
| 並發的第一次建立兩個都成功                               | 主鍵 `(userId, surface)` 保證只會有 1 列；`create` 撞到回 409；e2e 驗              |
| 拖動套件在正式 CSP 下不能用                              | C0 檢查點先驗；兩者都不過就自己寫 Pointer Events 拖動層，不放寬 CSP                |
| 換行與分隔線互相干擾（換行後分隔線位置不對）             | 決策 324：編輯畫布不換行、改成橫向捲動；換行只在非編輯時畫，不改資料               |
| 逾時後重送，把已存的版面當成衝突                         | 決策 329：中止後先 GET 結構比對；409 也先比對，相同就當成已存                      |
| A 的草稿留在記憶體，B 登入後存成 B 的版面                | 草稿以使用者 id 區分，登出或換使用者清掉；世代號碼丟掉晚到的結果；SC-Y19、Y27 驗   |
| 巢狀版面在閱讀模式撐出整頁橫向捲軸                       | 決策 324：一層層換行，最小寬度不當硬性欄寬；SC-Y29 的單元測試與 e2e 驗             |
| 卡片內容高度變動造成列高跳動                             | 列高＝內容最小高度＋`extraHeightPx`，內容變長時列自動長高，不存內容高度            |
| PR1 拆卡時破壞 2k 的「切帳本不重打」與「寫入後一起更新」 | 資料仍由 `LedgerView`／`Dashboard` 打，卡片只吃 props；2k 的請求增量測試必須照樣過 |
| Codex 週額度用完                                         | 網頁不換層，停下來問開發者；PR2 是 `backend` 角色，不受影響                        |
| 與 4a AI 入口在首頁語意衝突（git 合併成功但行為壞掉）    | 守 4a W256 的 3 條（§3.3）；後合併的一方跑首頁整合驗收（§3.5）                     |

## 5. 部署順序

1. docs PR 合併。
2. PR1 合併 → 部署 dev → 開發者看過 A+ 版面。
3. PR2 合併 → 部署 dev（migration）。前端還不呼叫，使用者看不出差別。
4. PR3 合併 → 部署 dev（`pnpm install`）→ 開發者試編輯。

## 6. 實作紀錄

（實作中遇到計畫外的問題，記在這裡。）

- 2026-10-25 W-A1：設定彈窗的「金色」示意條原本 3 個一般分類都是金色，和決策 315 不一致。改成只有第一段金色，判斷第一列的參數改成必填（`01e5426`）。
- 2026-10-25 W-A2：W-A1 已併回 `feature/2l-home-aplus`，W-A2 直接用 `2l-aplus` worktree，沒有另開 `2l-aplus-e2e`。這個 worktree 的 e2e 用自己的測試資料庫 `ledger_2laplus_test`。
- 2026-10-25 W-A2：e2e 量到 1280px、左側欄展開時內容區只有約 961px，不是 976px。差的 15px 是 Windows 傳統直向捲軸。登記表的 314px 最小寬度會讓三卡列換行，SC-Y1 過不了。SC-Y1 的目標不變；spec 決策 324、SC-Y1 與本檔 §1.2 改寫成扣掉捲軸的寬度。授權 W-A2 在 `apps/web/src` 調低最小寬度，不改側欄、頁面外距與 16px 間距。
- 2026-10-25 W-A2：三卡列 6 張卡的最小寬度從 314px 調到 309px（`1fedfd9`）：961 − 2×16 − 3×309＝2px 餘裕。e2e 在 `b628661`。
- 2026-10-25 W-A2 驗收：協調者重跑整套 Web e2e，86 過 2 紅。SC-Y3 恢復寬度那步、2j 的「首頁長金額保持單行」都是調整視窗後太早量：ResizeObserver 換行比寬度晚一拍，一欄與分割樹切換時卡片重新掛載。派回修成等版面穩定再量，斷言不放寬；捲軸寬度改成實測（`3372946`）。worker 回報：整套連跑兩次各 88/88，相關 3 個測試 `--repeat-each=10` 共 30/30。協調者還沒重跑這次修正。
- 2026-10-25 PR #172 的 CI：SC-H18 逾時（30 秒）。沒有斷言失敗，是 6 組配色、20 次導覽太接近上限。派 Codex 拆成淺色、深色兩條，斷言不放寬，結尾改用導覽列回首頁（`838b5f9`）。worker 回報：`--repeat-each=5` 共 10/10，最長 6.8 秒；整套 89/89。
- 2026-10-25 PR1 驗收：`activity` 卡寬 309px 時，借還列的名稱寬度是 0。advisor 建議合併前修，開發者同意。spec 加決策 336、SC-Y30，本檔加 §1.3a W-A3。
- 2026-10-26 PR2 驗收：`expectedRevision` 送超過 2147483647 的值回 500（資料庫欄位是 32 位元整數）。DTO 加 `@Max(2147483647)` 改回 400，加 1 條 e2e（`b612421`）。revision 本身到上限後再存一次仍會溢位回 500。正常使用不會發生，記為已知限制，沒有處理。
- 2026-10-26 PR2 部署：套 migration 前沒有先 `pg_dump` `ledger_dev`。這個 migration 只新增表與 enum，不動既有資料，所以沒有補做。
