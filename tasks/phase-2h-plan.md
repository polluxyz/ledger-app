# 實作計畫：階段二 (2h) — Web 視覺與編排重新設計

> 狀態：**已核可，實作中**（2026-09-23）。
> 依據：`docs/specs/phase-2h-web-visual.md`（下稱 spec）。
> 分成**兩個 PR**：PR-A 修三個顯示錯誤（D7），PR-B 是本步的設計主體。

---

## 1. 為什麼是這一塊

階段二的功能已經完整，但畫面沒有經過設計。實際量測的問題（1440 首屏只有 5 筆、手機要捲 1.36 屏才看到第一筆、40 顆列內按鈕、管理頁不對齊）都寫在 spec §1。

開發者 2026-09-23 選定：L1 的可收合側欄 ＋ L3 的表格與右側面板 × 黑金（含淺色象牙金）。

---

## 2. 範圍

### PR-A：三個顯示錯誤（D7）

| 錯誤                 | 位置                                                   | 修法                                                  |
| -------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| 轉帳畫成收入的綠色   | `TransactionList.tsx:84`                               | 三種型別各自一個 class；轉帳用中性色                  |
| 負餘額寫成 `$-6,820` | `AccountList.tsx:53`、`AccountBalances.tsx:77`         | `lib/format.ts` 加 `formatMoney()`，負號放在 `$` 前面 |
| 390px 時按鈕文字直排 | `TransactionList.module.css`、`AccountList.module.css` | 按鈕 `white-space: nowrap`，右側區塊 `flex-shrink: 0` |

⚠️ **第二項會改 3 行 e2e 的期望字串**（`transactions.spec.ts:62, 72, 90`：`'$-120'` → `'-$120'` 等）。這是 spec §2 假設 6，**2026-09-23 已取得同意**。斷言意圖不變。

PR-A 不做任何設計變更，改動小，由協調者自己做（派工成本高於自己改）。

### PR-B：設計主體（spec §3 的 SC-24～SC-30）

範圍內：

- `global.css` 兩組 token（深色黑金、淺色象牙金），預設跟隨 `prefers-color-scheme`。
- 深淺色切換鈕，載入時不閃（D19）。
- 四個「新增／建立」小視窗改成往下展開（D20）。
- 可收合側欄、訪客頂列、窄螢幕頂列。
- 首頁三欄工作台：表格、右側面板（新增／編輯）、帳戶餘額移進面板。
- 統一頁首 `PageHeader`，套用到 6 頁。
- 29 個 `*.module.css` 全部改走 token。
- 新增 `Icon`、`PageHeader` 元件與測試；新增 `e2e/layout.spec.ts`。

範圍外：見 spec §8。

---

## 3. 元件與相依

```
global.css（token）──┬─> Icon.tsx ──┬─> AppSidebar（側欄、收合）──> App.tsx
                     │              ├─> TransactionList（表格、分組、圖示鈕）
                     │              └─> Pagination（圖示鈕，名稱不變）
                     ├─> PageHeader.tsx ──> 6 個頁面
                     └─> Dialog.tsx（加 panel 變體）──> TransactionDialog ──> HomePage（三欄）
                                                                              └─> AccountBalances（移進面板）
```

**先做 token、`Icon`、`PageHeader`、`Dialog` 的 panel 變體、`SlideDown`、`use-theme`**——它們是其他所有工作的介面。這六件由協調者先做完，worker 才能平行開工而不互相踩到。

---

## 4. 設計決策（實作層級）

spec §4 的 D1–D7 是開發者的決定。以下是實作怎麼落地。

### D8 — 編輯面板用 `<dialog>` 的非 modal 模式

`Dialog` 加一個 `variant: 'modal' | 'panel'`，預設 `modal`（現有呼叫端不用改）。

- `panel` 用 `dialog.show()` 而不是 `showModal()`：沒有遮罩、不鎖焦點，渲染在原本的位置（右側面板裡），不進 top layer。
- 角色仍是 `dialog`、名稱仍由 `aria-label={title}` 給，所以 `getByRole('dialog', { name: '編輯交易' })` 照樣對得到。
- 非 modal 的 `<dialog>` 按 Esc 不會自動關，要自己接 `keydown`。
- jsdom 沒有 `show()`，`src/test/setup.ts` 比照現有的 `showModal()` 補一個替身。

**為什麼不自己寫 `role="dialog"` 的 `<section>`**：`<dialog>` 已經處理好「開著／關著」的語意與 `open` 屬性，自己寫要重做一次。

### D9 — 面板的狀態沿用 `HomePage` 現有的 `editing`

`LedgerTransactions` 已經有 `editing: Transaction | null`。三欄版面只是改變「它渲染在哪」：

- `editing === null` → 面板顯示 `TransactionForm`（新增）。
- `editing !== null` → 面板顯示 `TransactionDialog`（`variant="panel"`）。
- 點另一列 → 直接換 `editing`，面板內容跟著換（`key={editing.id}` 讓表單重建）。
- 關閉後焦點回到觸發的按鈕：記下 `document.activeElement`，關閉時 `focus()` 回去；那顆按鈕不存在了（例如被刪掉）就回到面板標題。

⚠️ 新增表單與編輯表單**不能同時在畫面上**，否則 `getByLabel('金額')` 在頁面層級會對到兩個。

### D10 — 窄螢幕的兩種狀態全部用 CSS 處理，不在 JS 讀斷點

2f 的決定：斷點只存在 CSS，JS 裡再寫一次遲早分岔。所以：

- **< 900px 編輯時隱藏列表**：`.layout:has(.panel[open]) .list { display: none; }`。`:has()` 從 Chrome 105、Safari 15.4、Firefox 121 起支援，三者的現行版本都支援。專案沒有另外訂目標瀏覽器清單；若之後要支援更舊的版本，這一條要重新評估。
- **< 900px 不做收合表單**（spec 假設 4：手機另開一步）。單欄時面板排在列表上方，跟現在一樣；只保證功能可用、不橫向捲動。
- **900–1199px 側欄一律收合**：收合的樣式同時掛在 `.collapsed` class 與 `@media (max-width: 1199px)` 底下。

### D11 — 側欄收合的記憶

新 hook `app/use-sidebar-collapsed.ts`：讀寫 `localStorage['ledger.sidebarCollapsed']`，預設 `false`。

- 比照 `lib/token-storage.ts` 的做法把 key 集中在一處。
- 讀取失敗（隱私模式、被封鎖）一律當成 `false`，不拋錯。
- 這是**純外觀偏好**，不是機敏資訊，放 `localStorage` 沒有安全疑慮。

### D12 — `h1` 的位置

全站任何時刻只能有一個 `h1`（`AppShell.test.tsx`、`smoke.spec.ts:33`）。

| 狀態          | `h1` 在哪                | 頂列                                     |
| ------------- | ------------------------ | ---------------------------------------- |
| 訪客          | 頂列                     | 只有站名                                 |
| 登入、≥ 900px | 側欄頂端                 | 不渲染（CSS 隱藏整條）                   |
| 登入、< 900px | 側欄頂端（在 ☰ 面板裡） | ☰ ＋ 站名（**普通文字，不是 heading**） |

窄螢幕頂列的站名只是視覺上的標誌。它若也是 `h1`，jsdom 裡會同時存在兩個（jsdom 不套 CSS，看不出哪個被隱藏）。

### D13 — 視覺隱藏用一個全域 class

`global.css` 加 `.visually-hidden`（標準的 clip 寫法）。側欄收合時，站名文字、導覽文字、帳本卡標籤都套上它——螢幕閱讀器與 e2e 讀得到，眼睛看不到。**不用 `display: none`**，那會讓名稱消失。

### D14 — token 命名與搬遷

- 沿用 `--color-*` 前綴，新增 spec §4.3 表上的 token。
- 既有的 `--color-surface-hover` 改名為 `--color-fill`（兩者用途相同）。`--color-primary-hover` 保留，改成用 `color-mix()` 從 `--color-primary` 推導，不另訂色碼。`--color-focus-ring` 保留名稱、改值。
- 深色值寫在 `:root`（預設）；淺色寫兩處：`:root[data-theme='light']` 與 `@media (prefers-color-scheme: light) { :root:not([data-theme='dark']) }`（切換鈕見 D19）。**深色當預設的理由**：黑金的本體是深色；不支援這個媒體查詢的舊瀏覽器應該看到品牌本體。
- 9 處寫死的色碼改成 token（`#fff` → `--color-on-primary`、`#f3c6c6` → `--color-danger` 的半透明版本，用 `color-mix()`）。

### D15 — token 對比寫成單元測試

`styles/tokens.test.ts` 用 `node:fs` 讀 `global.css`，抓出兩組 token，依 spec §4.3 的表算對比並斷言門檻。任何人改色碼導致不及格，`pnpm test` 就會紅。

### D16 — 交易表格的日期分組

- 依後端給的順序，把**連續同一天**的交易分成一組。前端不重新排序（排序是後端的職責）。
- 每組是「一行日期標題（`<p>`）＋ 一個 `<ul>`」。標題不是 `<li>`，所以 `getByRole('listitem')` 的數量仍等於交易筆數（spec SC-25.6）。
- 日期文字「8月16日 星期日」由 `lib/format.ts` 新增的 `formatGroupDate()` 產生（純呈現）。
- **不顯示每日小計**——那是金額運算，屬後端職責。

### D17 — 列操作與整列點擊

- 鉛筆與垃圾桶是 `Icon` ＋ `<button>`，`aria-label` 沿用現在的「編輯2026/08/16 的餐飲」，另加 `title="編輯"` 給滑鼠使用者看文字提示。
- 點整列的空白處也會開編輯（`onClick` 在 `<li>` 上，事件來自按鈕時略過）。鍵盤使用者走鉛筆鈕，所以 `<li>` 不需要可聚焦。

### D18 — 帳本卡在收合時

`LedgerSwitcher` 的 `<select>` 仍是同一個元素。收合時 CSS 把它變成覆蓋在方塊上的透明層（`opacity: 0`、`position: absolute; inset: 0`），方塊顯示帳本名的第一個字。點方塊就是點 `<select>`，原生下拉照常展開、鍵盤照常操作。只有一本帳本時（現在是 `<span>`）方塊不可點，只顯示字。

### D19 — 深淺色切換的實作（spec §4.6、SC-29）

- **狀態的唯一來源是 `<html data-theme>`。** `theme-init.js` 在載入時設它；React 裡的 `use-theme` 讀寫 `localStorage` 並同步更新它。CSS 只看這個屬性與媒體查詢，不看 React state。
- `theme-init.js` 放 `apps/web/public/`，Vite 會原樣複製到建置產物，`<script src="/theme-init.js">` 放在 `index.html` 的 `<head>`、CSP `meta` 之後、任何 CSS 之前。**不加 `defer` 或 `async`**——它必須在第一次繪製前跑完。檔案只有十幾行，不會拖慢載入。
- `theme-init.js` 裡所有 `localStorage` 存取包在 `try` 裡；失敗就不設屬性，等於跟隨系統。
- `system` 時**移除** `data-theme` 屬性，而不是設成 `system`——CSS 就只需要處理 `light`、`dark`、沒有屬性三種情況。
- 單元測試：在 jsdom 裡讀入 `theme-init.js` 的文字執行，驗三種 `localStorage` 值與「讀取會拋錯」各自的結果。
- `csp.spec.ts` 會打 `vite preview` 的產物，它本來就驗「console 沒有 CSP 違規」，外部腳本不會觸發違規。

### D20 — 往下展開的建立表單（spec §4.7、SC-30）

- 用步驟 1 做好的 `Dialog` `panel` 變體（非 modal、角色 `dialog`、名稱不變），外面包一個新的 `components/SlideDown.tsx` 負責展開與收起的動畫。
- 動畫用 `grid-template-rows: 0fr → 1fr` 加 `transition`。收起時先播完動畫（約 200ms，監聽 `transitionend`）再卸載，這樣 `Dialog`「關閉就卸載、下次打開是乾淨的」的保證照舊。`prefers-reduced-motion` 時直接卸載。
- 開關狀態留在各頁面（`LedgersPage` 已經有 `creating`，其他頁比照），按鈕加 `aria-expanded`。
- `AccountDialog` 與 `CategoryDialog` 同時負責「新增」與「編輯」：**新增模式用 `SlideDown`＋panel，編輯模式維持 modal**。分成兩種外殼，表單內容共用。

---

## 5. 實作順序

| 步驟 | 內容                                                                                                                                          | 誰     | 相依 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---- |
| A    | PR-A：三個顯示錯誤（3 行 e2e 已同意）                                                                                                         | 協調者 | 無   |
| 0    | 基準線：跑五個指令、記下測試數、量測截圖                                                                                                      | 協調者 | 無   |
| 1    | token（含淺色兩處）、`.visually-hidden`、`Icon`、`PageHeader`、`Dialog` panel 變體、`SlideDown`、`theme-init.js`＋`use-theme`、token 對比測試 | 協調者 | 0    |
| 2    | 四個 worker 平行（見 §8）                                                                                                                     | worker | 1    |
| 3    | 整合、兩種模式 × 七種寬度截圖、`layout.spec.ts`、e2e                                                                                          | 協調者 | 2    |
| 4    | 文件：`phase-2-web-mvp.md` §3、`docs/README.md`                                                                                               | 協調者 | 3    |

PR-A 與 PR-B 可以同時進行。PR-A 合併後，PR-B 用 `gh pr update-branch` 把 `main` 併進來再處理衝突（`TransactionList`、`AccountList` 兩邊都有改）。

---

## 6. 風險與對策

| 風險                                                            | 對策                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 兩個 `h1` 或兩個「作用中帳本」出現在 DOM                        | D12、D18；`AppShell.test.tsx` 既有斷言；新增一條「收合時帳本切換器仍只有一個」的測試  |
| 面板與確認彈窗同時開，單元測試的 `getByRole('dialog')` 對到兩個 | 改成帶名稱（spec SC-27.2 允許），逐處列在 PR 描述                                     |
| 新增與編輯表單同時渲染，`getByLabel('金額')` 對到兩個           | D9：兩者互斥                                                                          |
| 日期分組多出 `<li>`，e2e 的筆數斷言失敗                         | D16；新增單元測試釘住                                                                 |
| worker 的產出與設計有落差                                       | Task spec 附 token 表與提案頁路徑；協調者用假 API 截圖逐頁比對後才驗收                |
| 階段三（另一個 worktree）同時改 `AppSidebar` 或新增導覽項目     | 合併前 `gh pr update-branch`；側欄導覽設計成可以加到 7 項以上（收合時也放得下）       |
| 與 PR-A 在 `TransactionList`、`AccountList` 衝突                | PR-A 先合；PR-B 併 `main` 後以 PR-B 的版本為準，但保留 PR-A 的 `formatMoney` 與轉帳色 |
| e2e 與別的 worktree 撞資料庫                                    | 跑之前先查 3100／5273／5274 埠與 `ledger_test` 連線；被占用就等                       |
| SC 編號與階段三撞號                                             | spec §2 假設 7                                                                        |
| 淺色 token 兩處寫法日後不同步，某一種情況的顏色變錯             | token 測試比對兩塊內容完全相同（SC-29.4）                                             |
| `theme-init.js` 載入失敗或被改成非同步，載入時閃一下            | `layout.spec.ts` 驗「選淺色後重新整理，第一個畫面就是淺色」（SC-29.3）                |
| 往下展開的面板收起動畫還沒播完就被卸載，或卸載後殘留舊輸入      | D20：等 `transitionend` 再卸載；單元測試驗「收起後再開，欄位是空的」                  |
| 分類頁兩個展開面板同時開，頁面上出現兩個同類表單                | SC-30.5：同時只展開一個，單元測試釘住                                                 |

---

## 7. 驗證點

| 驗什麼       | 怎麼驗                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| SC-24.1–2    | 單元測試（收合記憶）＋ 截圖（1440、1280、1024、900）                                                                    |
| SC-24.3、5   | `e2e/layout.spec.ts`                                                                                                    |
| SC-24.4      | 390px 截圖：單欄、☰ 可用、新增與編輯走得完、無橫向捲動（只驗不壞）                                                     |
| SC-24.6      | 截圖腳本量 `scrollWidth - clientWidth`（375、768、2560）                                                                |
| SC-25        | 單元測試（面板切換、焦點回歸、互斥）＋ 既有 e2e                                                                         |
| SC-26.1      | `grep -rnE "#[0-9a-fA-F]{3,8}\b" apps/web/src --include=*.module.css` 只剩註解                                          |
| SC-26.2–3、7 | `styles/tokens.test.ts`                                                                                                 |
| SC-26.4–6、8 | 截圖人工比對（深淺兩色）                                                                                                |
| SC-27        | 五個指令 ＋ 完整 e2e（20 條既有 ＋ 新增）                                                                               |
| SC-29        | 單元測試（`use-theme`、`ThemeToggle`、`theme-init.js`、兩塊淺色 token 相同）＋ `layout.spec.ts`（不閃）＋ `csp.spec.ts` |
| SC-30        | 單元測試（開關、焦點、同時只開一個、收起後再開是乾淨的）＋ 既有 e2e 三處不改就過                                        |

截圖用的假 API 與 Playwright 腳本放在協調者的 scratchpad，**不進 repo**（新增開發工具要另外取得同意）。提案 v2 的截圖就是這樣產生的，沒有連任何資料庫。

基準線（步驟 0 實測，2026-09-23，已併入 `main` 的 #50–#52）：web 單元測試 **34 檔 181 條**、api **9 套 119 條**、e2e **20 條**。五個指令全綠。SC 編號：階段三 3a 用 `SC-F1`～`SC-F13`，與本步的 SC-24～30 不衝突。

---

## 8. 派工計畫

步驟 1 由協調者自己做：它定義了所有 worker 共用的介面，派出去等於讓四個 worker 各自猜。

步驟 2 四個 worker 一次全部派出，全部用 **Pi + `zai/glm-5.3`**（需要判斷，不用 flash）：

| Worker    | 負責的檔案（只能改這些）                                                                                                                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1 外殼   | `App.tsx`、`App.module.css`、`app/AppSidebar.*`、`app/AppTopBar.*`、`app/use-sidebar-collapsed.ts`（新）、`components/ThemeToggle.*`（新，用步驟 1 的 `use-theme`）、`features/ledgers/LedgerSwitcher.*`、`app/AppShell.test.tsx` |
| W2 首頁   | `pages/HomePage.*`、`features/transactions/TransactionDialog.tsx`、`features/transactions/TransactionForm.*`、`features/accounts/AccountBalances.*`、`transaction-edit.test.tsx`、`use-transactions.test.tsx`                     |
| W3 表格   | `features/transactions/TransactionList.*`、`features/transactions/TransactionFilters.*`、`components/Pagination.*`、`lib/format.ts`（只加 `formatGroupDate`）                                                                     |
| W4 其他頁 | 帳戶、分類、帳本、帳本明細、個人資料、登入、註冊七頁與它們 `features/` 底下的列表與彈窗（含 D20 的四個往下展開表單）、`Button`、`TextField`、`Select`、`FormError`、`ConfirmDialog` 的樣式                                        |

- W4 的份量比其他三個大（多了 D20）。若 worker 回報做不完，拆成 W4a（帳戶、分類）與 W4b（帳本、帳本明細、個人資料、登入、註冊、基礎元件）重派。
- 每份 Task spec 附：spec 路徑、token 表、提案頁路徑、該 worker 的檔案清單、**不准碰的檔案**（別的 worker 的清單＋步驟 1 的檔案）。
- `CLAUDE.md` 沒寫、每次都要寫的四條（`docs/orca-multi-agent.md` §5）：不准動 Prisma 與 API、不要跑 e2e、完成前跑四個指令、provider 錯誤帶原文回來。
- 額度用盡往下換層：Antigravity（`gemini-3.8-flash-high`）→ Claude Code（`opus`）。
- 驗收：協調者跑假 API 截圖逐頁比對，並檢查可及性名稱沒被改（`grep` 每個 worker 的 diff 裡被刪掉的 `aria-label` 與按鈕文字）。

---

## 9. Git

- **PR-A**：用 `orca worktree create` 從 `main` 另開 worktree，分支 `fix/web-amount-display`。這個 worktree 的分支是 `polluxyz/web-redesign`，不能同時簽出兩個分支。
  標題：`fix(web): color transfers neutrally and format negative balances as -$`。
- **PR-B**：本分支 `polluxyz/web-redesign`。
  標題：`feat(web): redesign the shell and home page with a black-gold theme`。
  描述必須列出：修改過選取方式的單元測試（SC-27.2）、`:has()` 的使用、`index.html` 多了一個外部 script（CSP 未改）、沒有新增相依。
- 兩個 PR 都**不自動合併**。CI 綠了之後停下來，等開發者說可以合。

---

## 10. 實作紀錄

### PR-A（#53，`fix/web-amount-display`）

- 三個錯誤照 §2 修完。用假 API 在 375／390／1440px 量測：40 顆列內按鈕最高 29.5px、轉帳金額 `rgb(107, 114, 128)`、餘額 `-$6,820`、無橫向捲動。
- **計畫外**：除了 3 行 e2e，還有 2 個單元測試的期望字串跟著改（`AccountBalances.test.tsx:65`、`accounts.test.tsx:65`：`'-12,000'` → `'-$12,000'`）。原本是子字串比對，新格式在負號與數字之間多了 `$`。意圖不變，已寫在 PR 描述。
- 第一次在全新 worktree 跑 lint／typecheck 失敗：`packages/shared` 還沒 build。先 build 再跑就綠，與改動無關。CI 本來就先 build shared。
- 全套測試第一次跑時 `transaction-edit.test.tsx` 有一條找不到「編輯」鈕；單獨跑 3/3 綠、全套再跑 2/2 綠。判斷是 api 與 web 測試同時跑時的負載造成的逾時，不是這次改動。
- CI：Web e2e 20 條、API e2e 41 條、單元測試全綠；已 `update-branch` 到最新 `main`，狀態 CLEAN，等開發者同意合併。

### PR-B 步驟 1（`c533e87`）

- **偏離**：`vite.config.ts` 加了 `test.css.include: [/global\.css/]`。Vitest 預設把所有 `.css`（含 `?raw`）換成空字串，token 對比測試讀不到檔案。只影響測試環境，不影響建置與 CI 設定。
- `Icon` 的筆畫資料拆到 `icon-paths.tsx`：React fast refresh 的 lint 規則不允許元件檔同時匯出常數。
- token 測試的反向驗證：把深色的次要文字改成 `#4a4538` → 2 條對比失敗；只改一塊淺色 token → 「兩塊相同」失敗。還原後 32 條全綠。
- `dist/index.html` 的順序確認：CSP `meta` → `theme-init.js`（無 defer／async）→ 應用程式 → CSS。
- web 單元測試 34 檔 181 條 → 40 檔 259 條，既有測試一條都沒改。

### PR-B 步驟 2（派工，2026-09-23）

- **偏離**：W4 事先拆成 W4a（帳戶、分類、基礎表單元件）與 W4b（帳本、帳本明細、個人資料、登入註冊），共 5 個 worker。§8 原本寫「做不完再拆」；看過份量後判斷一開始就拆比較快，檔案清單互不重疊。
- **偏離**：每個 worker 各開一個子 worktree（從本分支分出），不共用同一個簽出。同一個簽出裡 5 個 worker 同時跑測試，會看到彼此改到一半的檔案。做完由協調者逐一 merge 回本分支。
- Run `run_15550d0eb5af`，全部是 Pi ＋ `zai/glm-5.3`：

| Worker         | 分支                       | Task                | Dispatch           |
| -------------- | -------------------------- | ------------------- | ------------------ |
| W1 外殼        | `polluxyz/2h-w1-shell`     | `task_befd758f5df6` | `ctx_3e904410673f` |
| W2 首頁        | `polluxyz/2h-w2-home`      | `task_735002314065` | `ctx_79839e3ff693` |
| W3 表格        | `polluxyz/2h-w3-table`     | `task_8496e477b1ba` | `ctx_c0976e54bea0` |
| W4a 帳戶／分類 | `polluxyz/2h-w4a-accounts` | `task_a2ea3371ad27` | `ctx_2f707f8999c0` |
| W4b 帳本／個人 | `polluxyz/2h-w4b-ledgers`  | `task_abd184d45ec5` | `ctx_e793d533e67b` |

- 介面約定：`TransactionList` 的 `selectedId` 由 W3 加、W2 不傳，整合時由協調者接上（兩邊平行做，避免 W2 的型別檢查依賴 W3）。

**GLM 額度用完，改由 Claude Code 接手（2026-09-23 16:1x）**

- 5 個 Pi worker 都在同一時間停住，錯誤原文：`429: {"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2026-09-23 21:04:23"}`。Pi 自己重試 3 次後停止，沒有送出 `worker_done`，所以 dispatch 一直顯示 live——是開發者提醒後讀終端機才發現。**教訓**：Pi 的額度錯誤不會自動變成 escalation，協調者要定期讀終端機，不能只等訊息。
- 依 `orca-multi-agent.md` §4 原本要換到 Antigravity。W1 試了一次：`agy` 第一次開啟 worktree 會跳「是否信任這個資料夾」，Orca 看到這個畫面就把那次 dispatch 判為失敗（`Agent startup blocked: agent-trust-workspace`）。
- **開發者指示改用 Claude Code（Opus 5，`claude-opus-5`）跑所有 worker。** Pi 的 dispatch 用 `worker-abandon` 結束（`worker-stop` 對自己開的終端機無效，回 `stop_unknown`），再以 `--retry-of` 在同一個 Task 上重派。Claude Code 在這些 worktree 沒有信任提示，直接可用（auto mode）。
- Pi 留下的未 commit 改動保留在各 worktree，每個新 worker 都收到一則接手說明，列出前手改了哪些檔案，要求先看 diff 再決定沿用或重寫。W2 的前手沒有留下任何改動。

| Worker         | 新 Dispatch        | 前手留下的改動                                               |
| -------------- | ------------------ | ------------------------------------------------------------ |
| W1 外殼        | `ctx_90d7828d9a5b` | AppTopBar 兩檔（改）、ThemeToggle 三檔與收合 hook 兩檔（新） |
| W2 首頁        | `ctx_519836d85837` | 無                                                           |
| W3 表格        | `ctx_79b8ed5196a9` | `lib/format.ts`（改）                                        |
| W4a 帳戶／分類 | `ctx_e1e7e6e3c24b` | 5 個基礎元件的 CSS／測試、`AccountDialog.tsx`                |
| W4b 帳本／個人 | `ctx_3030a4343ec5` | 帳本與帳本明細 12 個檔案                                     |
