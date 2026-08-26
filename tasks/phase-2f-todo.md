# 任務清單：階段二 (2f) — 版面重整與設計 token

> 狀態：**8 個 Step 全部實作完成，等待開發者驗收**（2026-08-26）
> 依據：`docs/specs/phase-2f-web-layout.md`、`tasks/phase-2f-plan.md`。
> 實作結果與偏離見 `tasks/phase-2f-plan.md` §10。
> 用法：依序執行；每個任務有驗收條件。勾選＝「開發者已驗收」。
>
> **下方核取方塊全部維持未勾選**——它們代表的是「開發者已驗收」，不是「已經寫完」。
> 驗收通過後再勾。尚未 commit，也尚未 push。
> 通用驗收（每任務皆適用，不再重複）：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全綠。
> 分支：`feature/web-dashboard-layout`（自 `main` 開）。**本步不改後端。**

### 設計決策（D1～D4 見 spec §2，D5～D8 見 plan §4）

| #   | 結論                                                          |
| --- | ------------------------------------------------------------- |
| D1  | 側邊欄放導覽，帳本切換器在側邊欄頂端                          |
| D2  | 首頁分兩欄，新增表單常駐右側欄                                |
| D3  | 窄螢幕用漢堡浮動選單；不做 focus trap                         |
| D4  | 只補結構性 token，主色不動                                    |
| D5  | 站名放頂列（全站唯一 `h1`）；頂列不放頁面標題，各頁 `h2` 不動 |
| D6  | 一份 DOM，用 CSS 斷點切換形態，不用 `matchMedia`              |
| D7  | `use-disclosure` 負責開闔、點外面關閉、Esc 關閉並退回焦點     |
| D8  | 新增 token 一律純加法，既有 7 色 4 間距一個都不改             |

---

## Step 0：開工前

- [ ] **0.1 開分支**
  - 內容：自 `main` 開 `feature/web-dashboard-layout`。
  - 驗收：`main` 未被動到。

## Step 1：擴充設計 token

- [ ] **1.1 在 `global.css` 補進新的 CSS 變數**
  - 內容：字級 5 級、行高 2 級、陰影 2 級、狀態色 3 個、`--space-xl` / `--space-2xl`、
    版面尺寸 4 個（見 spec §4 的表）。**既有 7 個顏色與 4 個間距一個都不改**（D8）。
  - 驗收：`pnpm --filter @ledger/web test` 130 條全綠，數量不變；瀏覽器開起來畫面與改動前一模一樣。

## Step 2：`use-disclosure`

- [ ] **2.1 寫 `app/use-disclosure.ts`**
  - 內容：回傳 `{ isOpen, toggle, close, triggerProps, panelProps }`（D7）。
    `triggerProps` 帶 `aria-expanded` 與 `aria-controls`；`panelProps` 帶 `id`。
    在 `document` 上掛 pointerdown 與 keydown，關閉時要移除監聽。
  - 注意：Esc 關閉後要把焦點退回觸發鈕，否則焦點會掉到 `<body>`。
  - 驗收：型別綠。
- [ ] **2.2 `use-disclosure.test.ts`**
  - 內容：四條——點 trigger 開、再點一次關、點外面關、Esc 關且 `document.activeElement` 是觸發鈕。
  - 驗收：四條全綠。

## Step 3：拆 `AppHeader`

- [ ] **3.1 新增 `AppTopBar.tsx` 與 `.module.css`**
  - 內容：站名（`h1`，連到 `/`）＋ 窄螢幕的 ☰ 按鈕。**不放頁面標題**（D5）。
  - 驗收：型別綠。
- [ ] **3.2 新增 `AppSidebar.tsx` 與 `.module.css`**
  - 內容：`LedgerSwitcher` ＋ 主導覽（首頁 / 帳本 / 帳戶）＋ 分隔線 ＋ 登出。
    只在 `isAuthenticated` 時渲染。**站名不放這裡**（D5）。
  - 注意：導覽連結的文字一個字都不能改——`e2e/ledgers.spec.ts` 有 5 處靠它定位。
  - 驗收：型別綠。
- [ ] **3.3 刪掉 `AppHeader.tsx`，改寫 `AppHeader.test.tsx`**
  - 內容：測試檔改名為 `AppShell.test.tsx`，三條斷言的意圖不變：登入後看得到導覽連結、
    未登入看不到、切到 `/accounts` 導覽還在。
  - 驗收：三條全綠；全專案搜不到 `AppHeader` 這個識別字。

## Step 4：外殼與版面

- [ ] **4.1 改 `App.tsx` 的外殼結構**
  - 內容：`頂列 → (側邊欄 + 主區)`。側邊欄只在已登入時渲染。
  - 驗收：型別綠；`AppShell.test.tsx` 仍綠。
- [ ] **4.2 改 `App.module.css`**
  - 內容：拿掉 `max-width: 40rem`；主區 `max-width: var(--content-max)` 置中。
  - 驗收：1440px 下側邊欄與內容並排，內容不超過 70rem（SC-19 第 1 條）。
- [ ] **4.3 跑一次 e2e**
  - 內容：這是版面第一次真的動到，**現在就要確認 e2e 沒壞**，不要拖到 Step 8。
  - 驗收：`pnpm --filter @ledger/web test:e2e` 15 條全綠，測試檔一行未改。

## Step 5：響應式與浮動選單

- [ ] **5.1 加 900px 斷點**
  - 內容：低於斷點時側邊欄脫離文件流，改由 `use-disclosure` 控制顯示（D6）。
    ☰ 按鈕只在斷點以下顯示。
  - 驗收：375px 到 2560px 無橫向捲動（SC-19 第 3 條）。
- [ ] **5.2 `AppSidebar.test.tsx`**
  - 內容：四條——☰ 開闔、點外面收起、Esc 收起且焦點回按鈕、**點導覽連結後收起**。
  - 驗收：四條全綠。
- [ ] **5.3 再跑一次 e2e**
  - 驗收：15 條全綠（Playwright 視窗 1280×720，看到的是展開的側邊欄）。

## Step 6：首頁分兩欄

- [ ] **6.1 改 `HomePage.tsx` 與 `HomePage.module.css`**
  - 內容：左主欄放篩選 + 列表 + 分頁，右側欄放新增表單 + 帳戶餘額（D2）。
    低於斷點退回單欄，且新增表單仍排在列表前面。
  - 注意：`features/` 一個檔案都不能改。只加包裝元素與 grid。
  - 驗收：既有元件測試全綠；瀏覽器確認斷點行為（SC-19 第 2 條）。

## Step 7：其餘頁面

- [ ] **7.1 調整四頁的間距**
  - 內容：`AccountsPage`、`LedgersPage`、`LedgerDetailPage`、`AuthPage` 的 `.module.css`
    適應新寬度。這四頁維持單欄。
  - 驗收：元件測試全綠；四頁在 1440px 下版面不鬆散。

## Step 8：收尾

- [ ] **8.1 更新 `docs/artifacts/design-system.html`**
  - 內容：加入新的 token 與版面尺寸。artifact，不進版控。
- [ ] **8.2 回寫 `docs/specs/phase-2-web-mvp.md`**
  - 內容：§3 加 SC-19；§9 插入 Step 7（本步），Slice 4 順延為 Step 8、收尾順延為 Step 9。
  - 驗收：§9 的清單與實際排程一致。
- [ ] **8.3 回寫 `docs/specs/phase-2f-web-layout.md` 與本 plan 的狀態**
  - 內容：狀態改為已完成；記下實作中的偏離（若有）。
- [ ] **8.4 全套指令 ＋ 瀏覽器實測**
  - 內容：`pnpm lint / typecheck / test / build / format:check` ＋ e2e；
    375px / 900px / 1440px / 2560px 四種寬度各走一次，含鍵盤 Tab。
  - 驗收：SC-19 四條 ＋ plan §7 的五條手動項目逐條核對。
