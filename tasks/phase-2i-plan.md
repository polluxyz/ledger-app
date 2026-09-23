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
- `ThemeToggle` 從「按一下輪換」改成三個 `menuitemradio`。`use-theme` 的 `choose()` 已經存在（2h），不用改 hook。

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

（開工後填寫）
