# 2l 實作計畫：首頁 A+ 版面與可編輯版面

spec：`docs/specs/phase-2l-home-layout.md`（決策 313～335、W272～W287、SC-Y1～SC-Y25）。分 3 個 PR，依序合併。

> 核可：（待開發者核可。schema、API、新套件三項要明確同意。）

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

## 1. PR1：A+ 版面（決策 313～320、322～324、W272～W279、W287）

### 1.1 S1：共用型別與預設版面（協調者）

- 新檔 `packages/shared/src/types/home-layout.ts`：`HOME_CARD_IDS`、`HomeCardId`、`HomeLayoutNode`、`HomeLayoutBand`、`HomeLayoutV1`、`DEFAULT_HOME_LAYOUT_V1`（spec §3.2）。
- 只有型別與常數。驗證函式放 PR2。
- `index.ts` 匯出。跑 `pnpm --filter @ledger/shared build`。
- shared 測試：預設版面每張卡剛好一次、權重加總 10000。只 `import type` 會測不到常數，所以這條測試放 web（`apps/web/src/features/home/default-layout.test.ts`），由 W-A1 的 worker 寫。

### 1.2 W-A1：版面渲染與卡片拆分（`2l-aplus`，Codex）

依賴 S1。一個 worker 做完 PR1 的網頁部分，因為卡片拆分與渲染器互相牽動，拆開會一直撞同一批檔案。

- **卡片登記表** `apps/web/src/features/home/card-registry.tsx`：`HomeCardId` → 標題、最小寬度、渲染函式。最小寬度從 20rem 起，實測後填。
- **卡片外框** `HomeCard`（決策 320）：標題列、右上連結、內距。PR3 的拖動把手與「移到…」按鈕會放在這個標題列，現在先留一個空的插槽。
- **渲染器** `HomeLayoutRenderer`：吃 `HomeLayoutV1`，畫根列與分割樹。左右分割用 CSS grid 或 flex，寬度照權重。
  - 換行（決策 324）：用 `ResizeObserver` 量分割容器寬度，比對子節點最小寬度總和，放不下就照順序分行。換行算法寫成純函式 `wrapSplit(widthPx, minWidths, weights)`，不碰 DOM，單元測試。
  - 換行狀態要能讓 PR3 讀到（例如 context 給 `isWrapped`），PR1 先不用。
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
- **container query**（決策 319）：帳戶清單的兩欄斷點改用 container query，量清單自己的寬度。
- 資料仍由 `LedgerView`／`Dashboard` 打，卡片只吃 props；決策 307（切帳本不重打個人資料）與 306（寫入後一起更新）的結構不能動。
- 2k 留下的測試：SC-H2、H3 的請求增量測試照樣過。選擇器跟著新版面改，不刪驗證的行為。

### 1.3 W-A2：PR1 的 Web e2e（`2l-aplus-e2e`，Codex）

依賴 W-A1。派工前確認沒有別的 worktree 在跑 Web e2e，3100、5273、5274 沒被佔。

- `e2e/home.spec.ts` 改寫：SC-Y1（1280px 量 8 張卡的位置與寬度比例，容許 2px 誤差）、SC-Y2（390、900、901px）、SC-Y3（右側欄打開，3 種寬度，沒有橫向捲動）、SC-Y8（帳戶清單 439／440px）、SC-Y4 的趨勢卡高度。
- 2k 的 SC-H14（390px 長字、深淺色）照樣跑。
- 截圖：1280px 與 390px，淺色與深色，三種配色。協調者逐張看。

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
  - DTO：`schemaVersion` 必須是 1；`expectedRevision` 是 0 以上整數；`layout` 用 `@IsObject()` 或 null，再在 service 呼叫 `parseHomeLayoutV1`。不合格丟 `BadRequestException('版面格式不正確')`。`layout` 不能用 class-validator 的 nested，因為全站 `whitelist` 會把樹裡的鍵剝掉；要讓 `layout` 原樣進 service（用 `@Allow()` 加自訂 transform 確認，或在 controller 取原始 body）。worker 寫一條測試證明樹裡的鍵沒有被剝掉。
  - controller 加 `GET me/home-layout/web`、`PUT me/home-layout/web`，userId 取 `user.sub`。OpenAPI 標註。
- `error-codes.ts` 加 `HOME_LAYOUT_REVISION_CONFLICT`，409 回應帶這個碼（照既有 409 的格式）。
- 測試：service 單元測試（條件更新、P2002、null 重設）；API e2e：SC-Y11（含兩個並發請求，用 `Promise.all`）、SC-Y12 的 6 條 400 並確認資料庫沒變。

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
- 409 彈窗與網路錯誤、逾時（決策 329、W285）。逾時的判定：PUT 超過 10 秒沒回應，或 fetch 丟出非 HTTP 錯誤時，GET 比對 revision 與內容。
- 編輯中縮到 ≤900px 視同取消；有換行時「編輯」停用；離開首頁丟草稿（決策 323、324，W286）。
- 不是編輯模式時，首頁行為與 PR1 相同（SC-Y22）。

### 3.4 E3：PR3 的 Web e2e（`2l-layout-edit-e2e`，Codex）

依賴 E2。SC-Y14～Y21、Y23。

- SC-Y14 的另一台裝置：同一個測試開第二個 browser context 登入同一帳號。
- SC-Y18 的兩個分頁：同一個 context 開兩個 page。
- SC-Y19 的逾時：用 `page.route` 讓 PUT 先送到後端再延遲回應。
- SC-Y23：沿用 `csp.spec.ts` 的做法，打 `vite preview`，進編輯模式拖一次，console 沒有 CSP 違規。

### 3.5 PR3 驗收（協調者）

- diff 的新套件只有 C0 選定的那些，版本鎖定。
- 存出去的 JSON 都過 `parseHomeLayoutV1`（看 e2e 攔到的請求內容）。
- 自己用鍵盤走一次 SC-Y20。
- lint、typecheck、test、build、format:check、兩套 Web e2e 全綠。
- 合併後部署 dev，先 `pnpm install`，提醒按 `Ctrl + Shift + R`。

## 4. 風險與對策

| 風險                                                        | 對策                                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 全站 `whitelist` 把 `layout` 樹裡的鍵剝掉，存進去的是空物件 | B1 必須有測試證明原樣進 service；協調者驗收時用 e2e 存一份再讀回比對               |
| 並發的第一次建立兩個都成功                                  | 主鍵 `(userId, surface)` 保證只會有 1 列；`create` 撞到回 409；e2e 驗              |
| 拖動套件在正式 CSP 下不能用                                 | C0 檢查點先驗；兩者都不過就自己寫 Pointer Events 拖動層，不放寬 CSP                |
| 換行與分隔線互相干擾（換行後分隔線位置不對）                | 決策 324：有換行時不能編輯；換行是純渲染，不改資料                                 |
| 卡片內容高度變動造成列高跳動                                | 列高＝內容最小高度＋`extraHeightPx`，內容變長時列自動長高，不存內容高度            |
| PR1 拆卡時破壞 2k 的「切帳本不重打」與「寫入後一起更新」    | 資料仍由 `LedgerView`／`Dashboard` 打，卡片只吃 props；2k 的請求增量測試必須照樣過 |
| Codex 週額度用完                                            | 網頁不換層，停下來問開發者；PR2 是 `backend` 角色，不受影響                        |

## 5. 部署順序

1. docs PR 合併。
2. PR1 合併 → 部署 dev → 開發者看過 A+ 版面。
3. PR2 合併 → 部署 dev（migration）。前端還不呼叫，使用者看不出差別。
4. PR3 合併 → 部署 dev（`pnpm install`）→ 開發者試編輯。

## 6. 實作紀錄

（實作中遇到計畫外的問題，記在這裡。）
