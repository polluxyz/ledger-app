# Plan：階段二 (2i) — Web 版面第二輪

> 對應 spec：[`docs/specs/phase-2i-web-layout-v2.md`](../docs/specs/phase-2i-web-layout-v2.md)（SC-31～SC-37）。
> 任務清單：[`phase-2i-todo.md`](phase-2i-todo.md)。
> 分支：`feature/web-layout-v2`（worktree `web-redesign`，從 `main` 分出）。
> 狀態：**已核可**（2026-09-23），實作中。

---

## 1. 為什麼是這一塊

2h 定下了黑金視覺；開發者實際使用後，要求版面更「絲滑」、首頁像 dashboard、交易有自己的分頁，並且中間內容不要貼著左邊。這一輪只改前端版面與互動，不動後端。dashboard 的真實數字需要後端彙總端點，留給 2j。

---

## 2. 範圍

一個 PR：`feat(web): split transactions into their own page and animate the sidebars`。

包含 spec §3 的 SC-31～SC-37 全部。不包含：2j 的彙總 API 與圖表、手機版設計、訪客首頁。

---

## 3. 元件與相依

```
global.css（--content-max-*、--motion-*）
  └─ PageContent（wide / narrow 置中容器）
       ├─ 管理頁 ×5（narrow）
       └─ 記帳頁 ×2（wide）
RightPanelProvider（登記、開關、記憶、focus 請求）
  ├─ App 外殼：第三欄寬度 = 已登記 && 打開 ? 360 : 0
  ├─ RightPanel（外殼裡的欄位 ＋ portal 目標 ＋ ≤ 900px 抽屜）
  └─ RightPanelContent（記帳頁用來把內容 portal 過去並登記）
       └─ TransactionWorkbench（新增 ⇄ 編輯；從 2h HomePage 抽出）
PageHeader（既有 actions 插槽放「＋ 新增交易」；context 插槽放 LedgerSwitcher）
AppSidebar ─ UserMenu ─ 設定選單 ─ ThemeToggle（三選一）
```

---

## 4. 設計決策（實作層級）

### D21 — 右側欄：欄位屬於外殼，內容屬於頁面

spec §4.2。`RightPanelProvider` 提供：

```ts
interface RightPanelApi {
  isRegistered: boolean; // 目前頁面有沒有右側欄
  isOpen: boolean; // ≥ 901px：記在 localStorage；≤ 900px：抽屜開關，不記
  open(): void;
  close(): void;
  requestFocus(): void; // 「＋ 新增交易」用：打開並把焦點送到金額欄
  focusRequest: number; // 每次 requestFocus 加 1，表單在 effect 裡看到變化就 focus
  slot: HTMLElement | null; // portal 目標
}
```

- 記帳頁用 `<RightPanelContent>{…}</RightPanelContent>` 包住面板內容：mount 時登記、unmount 時取消，內容用 `createPortal` 放進 `slot`。
- **為什麼不讓每一頁自己排三欄**：置中是相對「兩側欄之間」，第三欄一定要在外殼裡，側欄開合的過渡才會連動中間區。
- **為什麼用 portal 而不是 context 傳 ReactNode**：內容的 state（`editing`、表單輸入）要留在頁面元件裡，換頁時跟著頁面一起消失；傳 ReactNode 進外殼的話，state 的擁有者會變成外殼。
- `focusRequest` 用遞增的數字而不是布林：連按兩次「＋ 新增交易」也要兩次都 focus。
- 焦點時機：右側欄打開要 220ms，但元素一開始就在 DOM 裡，`focus()` 不需要等動畫；`preventScroll: true` 避免欄位在寬度還是 0 時把容器捲動。

### D22 — 版面寬度的斷點仍然只在 CSS

沿用 2h 的 D10：901–1199px 收合、≤ 900px 抽屜，都用 `@media`。唯一需要 JS 知道斷點的是「≤ 900px 時右側欄的開關不寫進 localStorage」——用 `matchMedia('(max-width: 900px)')`，jsdom 沒有 `matchMedia` 時當成寬螢幕。

### D23 — 左側欄固定列高

spec §4.3。所有列用 `height` 而不是 `padding` 撐高；收合只改寬度與文字 `opacity`。2h 的 `.collapsed` 規則裡改到 `display`、`height`、`padding-top` 的全部移除。收合鈕從品牌列移到底部，**無障礙名稱不變**（「收合側欄」／「展開側欄」，`AppSidebar.test.tsx` 靠它）。

### D24 — 使用者選單

spec §4.4。兩層都是同一個 `Menu` 內部元件的實例；外層只管「哪一層開著」。

- 開啟時焦點送到第一個項目；Esc 關閉當前這一層並把焦點送回開啟它的項目。
- 點外面：用 `pointerdown` 監聽 document，事件目標不在任一層選單與觸發鈕裡就全部關閉。
- 揭露式而不是 ARIA `menu`（spec §4.4）：`role="menuitem"` 會讓「登出」不再是 button，既有測試得改斷言。
- 外觀是 radio 群組，呼叫 `use-theme` 的 `choose()`（2h 已有）。訪客頂列的 `ThemeToggle`（輪換鈕）不動。

### D25 — `TransactionWorkbench` 從 2h 的 `HomePage` 抽出

2h 的 `LedgerWorkbench` 同時管列表與面板。拆成：

- `TransactionWorkbench`：`editing` 與新增／編輯切換（面板內容），由頁面傳入 `editing` 與 `onClose`。
- 頁面（`HomePage`、`TransactionsPage`）各自持有 `editing` state，列表點擊時設定它並呼叫 `requestFocus` 的編輯版（打開右側欄）。

`key={ledger.id}` 重建子樹的做法（2h 的註解有說明為什麼）兩頁都保留。

### D26 — 帳本切換器的膠囊外觀

spec §4.6。沿用 2h 的「透明原生 `<select>` 疊在外觀上」，只換外觀層。單一帳本時不渲染 `<select>`（2h 已經如此），只渲染外觀，沒有箭頭。

### D27 — 901–1199px 的浮動展開

外殼第一欄在這個區間固定 72px（CSS）。側欄元件多一個「暫時展開」的 state（不寫 localStorage）：展開時加一個 class，讓 `<aside>` 改成浮在中間區上方、寬 240px。收回的時機：`NavLink` 的 `onClick`、Esc、`pointerdown` 在側欄外。≥ 1200px 仍然是「推擠 ＋ 記憶」（`use-sidebar-collapsed`）。判斷區間用 `matchMedia("(min-width: 901px) and (max-width: 1199px)")`；jsdom 沒有 `matchMedia` 時當成 ≥ 1200px。

---

## 5. 實作順序

| 步驟 | 內容                                                                                                                                                    | 誰     | 相依 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---- |
| 0    | 基準線：五個指令、測試數                                                                                                                                | 協調者 | 無   |
| 1    | 共用介面：token、`PageContent`（並套到五個管理頁）、`RightPanelProvider`／`RightPanel`／`RightPanelContent`、外殼三欄 grid 與過渡、`/transactions` 路由 | 協調者 | 0    |
| 2    | 兩個 worker 平行（§8）                                                                                                                                  | worker | 1    |
| 3    | 整合：e2e 導航修改、新 e2e、截圖、鍵盤                                                                                                                  | 協調者 | 2    |
| 4    | 文件與 PR                                                                                                                                               | 協調者 | 3    |

---

## 6. 風險與對策

| 風險                                                           | 對策                                                                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `grid-template-columns` 過渡期間 Playwright 點到還在移動的元素 | Playwright 預設會等元素位置穩定；若仍不穩，在 e2e 的 `test.use` 設 `reducedMotion: 'reduce'`（只影響測試） |
| portal 的目標在第一次 render 時還不存在，內容晚一拍才出現      | `slot` 用 callback ref 存進 state；單元測試驗「第一次 render 後表單就在」                                  |
| 新增與編輯表單同時存在                                         | D25：互斥由 `TransactionWorkbench` 保證，沿用 2h 的測試                                                    |
| 管理頁殘留右側欄（例如從交易頁切到帳戶頁，登記沒取消）         | `RightPanelContent` unmount 時取消登記；單元測試與 e2e SC-35.1 都驗                                        |
| 「作用中帳本」在同一頁出現兩次（頁首＋舊的側欄）               | 側欄的帳本卡由 W1 移除、頁首由 W2 加上；整合時 `getAllByLabelText('作用中帳本')` 長度為 1 的測試釘住       |
| 兩個 worker 同時改 `AppSidebar` 與 `LedgerSwitcher` 的邊界     | 檔案清單不重疊：W1 只從側欄拿掉 `<LedgerSwitcher />`，不改它；W2 只改 `LedgerSwitcher` 本身                |
| 1024px 時交易表格被擠壓（中間區約 530px）                      | 2h 的首頁在 1024 已經是同樣寬度且通過；截圖驗收                                                            |
| 選單在側欄收合時被 `overflow: hidden` 裁掉                     | 選單用 `position: fixed` 依觸發鈕座標定位，不放在側欄的 overflow 範圍裡                                    |
| e2e 與別的 worktree 撞資料庫                                   | 跑之前先查 3100／5273／5274 埠                                                                             |

---

## 7. 驗證點

| 驗什麼        | 怎麼驗                                                                           |
| ------------- | -------------------------------------------------------------------------------- |
| SC-31.1       | `layout.spec.ts` 量收合前後的 icon 中心座標                                      |
| SC-31.2、35.2 | `layout.spec.ts` 讀 computed `transition-duration`；另開 `reducedMotion` 驗 0    |
| SC-31.6       | 單元測試（901–1199px 浮動展開）＋ 1024、390px 截圖                               |
| SC-32         | 單元測試（`UserMenu`）＋ `layout.spec.ts` 鍵盤開關                               |
| SC-33         | 單元測試（`LedgerSwitcher`）＋ 截圖                                              |
| SC-34         | 單元測試（`HomePage`、`TransactionsPage`、路由保護）＋ 既有交易 e2e              |
| SC-35         | 單元測試（`right-panel-context`、`RightPanel`）＋ `layout.spec.ts` SC-35.1／35.2 |
| SC-36         | `layout.spec.ts` 量左右留白與置中軸                                              |
| SC-37         | 五個指令 ＋ 兩套 e2e                                                             |

截圖用 2h 留在協調者 scratchpad 的假 API 與腳本，不進 repo。

---

## 8. 派工計畫

步驟 1 由協調者做：右側欄的登記介面與外殼三欄是兩個 worker 共用的地基，派出去等於讓兩個 worker 各自猜。`PageContent` 套到五個管理頁是機械式改動，寫 Task spec 的時間比自己改還久。

步驟 2 兩個 worker 一次派出，**用 Claude Code Opus 5**（`--agent claude --model claude-opus-5`，開發者 2026-09-23 指定，只限 2i）：

| Worker    | 負責的檔案（只能改這些）                                                                                                                                                                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1 側欄   | `app/AppSidebar.*`、`app/UserMenu.*`（新）、`components/ThemeToggle.*`、`app/use-sidebar-collapsed.*`、`app/AppShell.test.tsx`                                                                                                                                                                              |
| W2 記帳頁 | `pages/HomePage.*`、`pages/TransactionsPage.*`（新）、`features/transactions/TransactionWorkbench.*`（新）、`features/transactions/TransactionDialog.tsx`、`features/transactions/TransactionForm.*`、`features/ledgers/LedgerSwitcher.*`、`features/accounts/AccountBalances.*`、`components/PageHeader.*` |

- 每個 worker 在自己的子 worktree 做（2h 的做法：從本分支分出，做完由協調者 merge 回來），避免兩個 worker 同時跑測試時看到彼此改到一半的檔案。
- Task spec 附：spec 路徑、樣版網站路徑、該 worker 的檔案清單、**不准碰的檔案**（對方的清單＋步驟 1 的檔案）、步驟 1 的介面說明（D21）。
- 固定四條（`docs/orca-multi-agent.md` §5）：不准動 Prisma 與 API、不要跑 e2e、完成前跑 lint／typecheck／test／format:check、provider 錯誤帶原文回來。
- 協調者定期讀 worker 終端機（2h 的教訓：額度錯誤不會自動變成 escalation）。
- 驗收：假 API 截圖逐頁比對；`grep` diff 裡被刪掉的 `aria-label` 與按鈕文字。

---

## 9. Git

- 分支 `feature/web-layout-v2`。
- 標題：`feat(web): split transactions into their own page and animate the sidebars`。
- 描述列出：e2e 的每一處導航修改與唯一一處斷言修改（假設 14）、修改過選取方式的單元測試、沒有新增相依、portal 的使用。
- **CI 綠了之後停下來，等開發者看過畫面再合併**（沿用 2h 的做法；這是視覺改動，開發者要先看）。

---

## 10. 實作紀錄

### Step 0（基準線，2026-09-23）

- 五個指令全綠。api 單元測試 212 條；web 46 檔 294 條；web e2e 27 條；api e2e 65 條（2h 收尾時實測）。

### Step 1（共用介面）

- **偏離**：管理頁不包 `<PageContent>`，改用 CSS Modules 的 `composes: narrow from '../components/PageContent.module.css'`。五個管理頁共有 11 個 `<section className={styles.page}>` 的 return 分支，逐一改包元件容易漏；`composes` 讓寬度仍只有一個來源。記帳頁用 `<PageContent width="wide">`。
- 外殼 grid 兩側欄是 `auto`：側欄與右側欄各自對自己的 `width` 做過渡，中間欄逐格跟著變。外殼因此不需要知道收合狀態，W1 改側欄時不會碰到外殼。
- 右側欄拆成三個檔：`right-panel-context.ts`（型別、hook、鍵名）、`RightPanelProvider.tsx`、`RightPanel.tsx`（欄位＋`RightPanelContent`）。原因是 React fast refresh 的 lint 規則不允許元件檔同時匯出 hook。
- 收起時裡層設 `inert`（React 19 支援布林值），寬度 0 的表單不會被 Tab 走到。
- 分類頁從 64rem 改成 52rem（spec 假設 10）；≥ 1200px 支出與收入兩張卡仍然並排，各約 400px。
- web 單元測試 46 檔 294 條 → 48 檔 304 條。

### Step 2（派工，2026-09-23）

- Run `run_da5c75cf9919`，兩個 worker 都是 Claude Code `claude-opus-5`，各自在 `worker-start --worktree new-child` 建的子 worktree（從 `feature/web-layout-v2` 的 `94dd1fe` 分出）：

| Worker    | 分支                     | Task                | Dispatch           |
| --------- | ------------------------ | ------------------- | ------------------ |
| W1 側欄   | `polluxyz/2i-w1-sidebar` | `task_06c7056213a6` | `ctx_36d78c37c6ba` |
| W2 記帳頁 | `polluxyz/2i-w2-pages`   | `task_8ed206fc79e8` | `ctx_fc736f6cfc51` |

- **派工後的更正（協調者發現）**：
  1. 使用者選單改成**揭露式**而不是 ARIA `menu`。既有 e2e（`csp.spec.ts`、`smoke.spec.ts`）與 7 個單元測試用 `getByRole('button', { name: '登出' })`；`role="menuitem"` 會讓它不再是 button，等於改斷言。已通知 W1，spec §4.4 與 plan D24 已更新。
  2. dashboard 的最近交易每一筆是 `<li>`，文字與交易表格的列相同（分類、帳戶、金額格式、備註）。原因：`transactions.spec.ts` 的情境 7、9、12 要在同一頁看到「改了 → 餘額跟著變」，而帳戶餘額只在 dashboard。已通知 W2。
- W2 問：頁首加上切換器後，`AppSidebar.test.tsx:155、159`（W1 的檔案）會看到兩個「作用中帳本」而紅。回覆：不碰它，由 W1 移除側欄切換器時一起修；協調者先 merge W1 再 merge W2。

### Step 3.1（e2e 的導航修改，與 Step 2 同時進行）

- `ui.ts` 新增 `openTransactions`、`openDashboard`、`openUserMenu`（點連結而不是 `goto`，保留 React Query 快取，才驗得到改動後畫面有沒有更新）。
- `transactions.spec.ts`：情境 7、12 在首頁點最近交易那一列進入編輯（首頁沒有鉛筆鈕）；情境 8 到交易頁刪除、再點「首頁」回去看餘額；情境 10、11 與最後一條先 `openTransactions`。
- `ledgers.spec.ts:159`：檢查「作用中帳本」之前先 `openDashboard`。
- **計畫外**：`csp.spec.ts:78`、`smoke.spec.ts:67` 用「登出按鈕看得到」確認登入成功；登出收進使用者選單後，斷言前先 `openUserMenu`。斷言不變。
- `layout.spec.ts`：SC-24.3、SC-28.1、SC-26.7 先 `openTransactions`；SC-24.5 改成 SC-36.4（置中軸，假設 14）；新增 SC-31.1、31.2、31.6、32.3、35.1、35.2、36.1 與「使用者選單收著登出與個人資料」。
- `git diff` 驗證：除了 SC-24.5 → SC-36.4 以外，沒有任何 `expect` 行被改。

### Step 2 驗收與整合

**W1（側欄）**：commit `792d619`，merge 為 `feature/web-layout-v2` 上的 merge commit。

- 依更正改成揭露式使用者選單；外觀是 `role="radiogroup"` 裡三顆原生 radio，第二層的 ↑↓ 交給瀏覽器內建。
- **偏離**：`<aside>` 裡多包一層 `.panel`。901–1199px 浮動展開時，外殼第一欄（`auto`）必須維持 72px；`<aside>` 固定 72px，真正變寬、浮起來的是內層。≥ 1200px 的寬度動畫仍在 `<aside>` 上。
- **偏離**：W1 沒有開樣版網站（`CLAUDE.md` §13：不主動把 `docs/artifacts/` 當 context），一律照 spec 文字做。
- 改過選取步驟的既有單元測試 9 處（`App.test.tsx`、`AppShell.test.tsx`、`ProtectedRoute.test.tsx`、`AuthDialog.test.tsx`、`LoginPage.test.tsx`、`RegisterPage.test.tsx`：先打開使用者選單再找「登出」；`AppSidebar.test.tsx` 兩處：個人資料改從選單找、收合後的名稱清單換成五項；`ThemeToggle.test.tsx`：協調者核可改寫，意圖「全站同時只有一組外觀控制項」不變）。
- 協調者驗收時修正：側欄收合時，第二層設定選單用 `top` 對齊「設定」而超出視窗底部，「深色」被切掉。改成用 `bottom` 對齊第一層（`7a2cd3c`）。
- 量測：1440 深淺兩色，收合前後 6 個 icon 位移 0px；1024 浮動展開時 `<main>` 的 x 維持 72。

**W2（記帳頁）**：commit `9da9a61`。

- 依追加需求，dashboard 最近交易每筆一個 `<li>`，文字含分類、備註、日期、帳戶與交易表格同格式的金額，整列是一顆按鈕。
- 協調者驗收時修正：
  1. W2 因為 `TransactionList` 的正負號對照表是模組私有，在 `HomePage` 複製了一份。收攏成 `lib/format.ts` 的 `formatTransactionAmount`，兩處共用並補單元測試（`993df9c`）。
  2. dashboard 的卡片只有交易表格一半寬，一行擠日期、分類、備註、帳戶、金額，備註被截斷。改成兩行：上行「分類 備註」、下行「日期・帳戶」（`1b1905e`）。
- merge 後沒有衝突；W1、W2 各自預期會紅的 `LedgerSwitcher.test.tsx`、`AppSidebar.test.tsx` 合起來全綠。

### Step 3（整合驗證）

- web e2e **35 條全過**（原 27 ＋ 新 8），第一次就綠；api e2e 65 條全過。
- 反向驗證：在收合狀態的導覽加 6px 內距 → SC-31.1 紅（`Received: 6`），還原後綠。
- 根目錄 `pnpm test`：api 212；web 51 檔 343 條（基準 46 檔 294）。**有一次** web 出現 1 條失敗，當時沒有抓到測試名稱；之後連續 5 次全綠。與 2h 記錄過的「api 與 web 同時跑時的負載逾時」同型，列為已知的偶發問題。
- lint、typecheck、format:check、build 全綠。
- 截圖（假 API）：375／390／1024／1440 × 深淺兩色 × 首頁／交易／帳戶，另有側欄收合、使用者選單兩層、1024 浮動展開。全部沒有橫向捲動、沒有 console 錯誤。

### 第二輪修訂（2026-09-23，開發者看過 PR #56 的畫面後）

回饋與選擇的原文在 spec §4.11。

- **調查「看不到動畫」**：實測當時的版本，左側欄收合寬度經過 12 個中間值、右側欄 13 個，動畫是有的。可能原因是 Windows 關了動畫效果（瀏覽器回報 `prefers-reduced-motion: reduce`，我們把時間設成 0），或 220ms 先快後慢、約 100ms 就收掉大半。改成 320ms、前後都慢；文字與右側欄內容跟著滑動。
- **協調者（地基）**：`--content-max: 72rem` 取代寬／窄兩個 token；`PageContent` 不再有 `width`；上方橫條 `PageToolbar`（左右兩個 portal 插槽，sticky，與內容同寬）；右側欄改成預設關閉、不記憶。
- **計畫外（協調者自行修正）**：「換頁就關」最初用「面板內容卸載就關」實作，但切換帳本時頁面以 `key` 重建，右側欄會跟著關——使用者正在記帳時換帳本會很突兀。改成用網址判斷（記下在哪個路徑打開的），切換帳本不關、換頁才關，並補了單元測試。
- **W3（設定彈窗、側欄抽屜動畫）**：`task_e672712e3821`／`ctx_4a9d44be63c6`。設定改成 modal 彈窗（三張 `role="radio"` 預覽卡），使用者選單的第二層移除。**偏離**：預覽卡的固定色用 chrome token，而不是 `--color-bg`／`--color-surface`——後者跟著目前主題變，淺色模式下「深色」那張卡會被畫成白的。協調者驗收時拿掉「設定」右邊的「›」（它現在開的是彈窗，不是下一層）。
- **W4（橫條）**：`task_b8fb9c4e8c79`／`ctx_9404d570d93d`。帳本切換器與各頁的頁面層級按鈕（新增交易、新增帳戶、建立帳本、改名）搬進橫條；帳本明細的橫條左邊是「回到帳本列表」；`PageHeader` 拿掉 `context`／`actions` 插槽。
- **e2e**：用到新增表單前先 `openNewTransaction`（`ledgers.spec`、`categories.spec`、`transactions.spec` 情境 9）。2h 的 SC-24.5「標題左緣相同」因為回到單一寬度而重新成立，**恢復原本的斷言**（多量交易頁），假設 14 的斷言修改不再需要。與 `main` 比對，e2e 沒有任何 `expect` 行被刪改。
- **驗證**：web 單元測試 54 檔 363 條；web e2e 35 條全過（連跑兩次）；api e2e 65 條；lint、typecheck、format、build 全綠。動畫實測：右側欄打開 20 個中間影格、側欄收合 19 個。根目錄 `pnpm test` 又出現一次 web 1 條失敗，接著連續 4 次全綠，仍未抓到名稱。
