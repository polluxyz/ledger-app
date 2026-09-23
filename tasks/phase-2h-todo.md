# 任務清單：階段二 (2h) — Web 視覺與編排重新設計

> 狀態：**送審中**（2026-09-23），與 `tasks/phase-2h-plan.md` 一起送審。
> 依據：`docs/specs/phase-2h-web-visual.md`（spec）、`tasks/phase-2h-plan.md`（plan）。
> 用法：依相依順序執行；每個任務有驗收條件。**勾選＝「開發者已驗收」，不是「已經寫完」。**
>
> **不新增任何 npm 套件、不動 Prisma、不動 API、不動 CI。** 唯一要改既有 e2e 的是 PR-A 的 3 行期望字串（spec §2 假設 6，待同意）。
>
> 通用驗收（每個任務皆適用，不再重複）：
> `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`、`pnpm build` 全綠。
> 基準線：web 單元測試 **33 檔**（條數在 0.1 實測）、api **9 套 119 條**、e2e **20 條**。只能增加。

### 設計決策

| #   | 結論                                                      | 出處      |
| --- | --------------------------------------------------------- | --------- |
| D1  | L1 可收合側欄 ＋ L3 表格與右側面板                        | spec §4.1 |
| D2  | 黑金；D3 淺色版為「象牙金」，跟隨 `prefers-color-scheme`  | spec §4.3 |
| D4  | 列操作是鉛筆（編輯）與垃圾桶（刪除）圖示鈕，名稱不變      | spec §4.1 |
| D5  | 統計卡原樣保留                                            | spec §4.1 |
| D6  | 系統字體；圖示自己寫 inline SVG                           | spec §4.1 |
| D7  | 三個顯示錯誤另開 PR-A                                     | spec §4.1 |
| D8  | 編輯面板是 `Dialog` 的 `panel` 變體（`show()`，非 modal） | plan §4   |
| D9  | 面板狀態沿用 `HomePage` 的 `editing`；新增與編輯表單互斥  | plan §4   |
| D10 | 窄螢幕的狀態全用 CSS（`:has()`、強制展開），JS 不讀斷點   | plan §4   |
| D11 | 收合記在 `localStorage['ledger.sidebarCollapsed']`        | plan §4   |
| D12 | 登入後 `h1` 在側欄；窄螢幕頂列的站名不是 heading          | plan §4   |
| D13 | 收合時的文字用 `.visually-hidden`，不用 `display: none`   | plan §4   |
| D14 | 深色寫在 `:root`，淺色寫在 `prefers-color-scheme: light`  | plan §4   |
| D15 | token 對比寫成單元測試                                    | plan §4   |
| D16 | 日期分組：標題是 `<p>`，每組一個 `<ul>`；不顯示每日小計   | plan §4   |
| D17 | 整列可點開編輯；鍵盤走鉛筆鈕                              | plan §4   |
| D18 | 收合時帳本切換器仍是同一個 `<select>`，疊在方塊上         | plan §4   |

---

## Step A：PR-A 三個顯示錯誤（協調者，獨立 worktree）

⚠️ 開工前要先取得同意：A.4 會改 3 行 e2e。

- [ ] **A.1 開 worktree**
  - 內容：`orca worktree create` 從 `main` 開，分支 `fix/web-amount-display`；進去後先跑 `pnpm install`。
  - 驗收：`orca worktree list` 看得到；`main` 沒有被動到。

- [ ] **A.2 轉帳用中性色**
  - 檔案：`features/transactions/TransactionList.tsx:84`、`TransactionList.module.css`。
  - 內容：`EXPENSE`、`INCOME`、`TRANSFER` 各自一個 class；`.transfer` 用 `--color-text-muted`。
  - 驗收：新增單元測試——轉帳列的金額不帶收入的 class。

- [ ] **A.3 負餘額寫成 `-$6,820`**
  - 檔案：`lib/format.ts`（新增 `formatMoney`）、`AccountList.tsx:53`、`AccountBalances.tsx:77`。
  - 內容：`formatMoney(amount)` 回傳 `-$6,820`／`$3,240`，內部沿用 `formatAmount`。
  - 驗收：`formatMoney` 單元測試（正、負、零、千分位）；既有 `AccountBalances.test.tsx` 仍綠。

- [ ] **A.4 更新 3 行 e2e 期望字串**（需同意）
  - 檔案：`e2e/transactions.spec.ts:62, 72, 90`。
  - 內容：`'$-120'` → `'-$120'`、`'$-200'` → `'-$200'`。只改字串，不改選取器與斷言意圖。
  - 驗收：`git diff e2e/` 只有這 3 行。

- [ ] **A.5 按鈕不再擠成直排**
  - 檔案：`TransactionList.module.css`、`AccountList.module.css`。
  - 內容：`.action` 加 `white-space: nowrap`；`.right` 加 `flex-shrink: 0`。
  - 驗收：用假 API 在 375px、390px 截圖，20 列都沒有按鈕高於 32px。

- [ ] **A.6 開 PR-A**
  - 內容：commit、push、`gh pr create`，盯 CI 到綠。**不合併，等開發者同意。**
  - 驗收：CI 全綠；e2e 20 條全過；PR 描述寫明改了 3 行 e2e 與原因。

---

## Step 0：開工前（協調者）

- [ ] **0.1 記下基準線**
  - 內容：跑五個指令，把 web 單元測試的條數寫進 plan §7。
  - 驗收：plan 裡有實測數字。

- [ ] **0.2 更新 SC 編號（若需要）**
  - 內容：`git fetch` 看 `main` 上的 spec 有沒有用掉 SC-24 以後的編號。
  - 驗收：沒撞號；撞號的話改本 spec 與 todo 的編號。

---

## Step 1：共用介面（協調者自己做，其他步驟都依賴它）

- [ ] **1.1 token**
  - 檔案：`styles/global.css`。
  - 內容：依 spec §4.3 寫兩組 token；深色在 `:root`、淺色在 `@media (prefers-color-scheme: light)`；加 `.visually-hidden`；更新斷點說明（900px、1200px）。
  - 驗收：既有畫面仍能開（顏色會變，版面不變）。

- [ ] **1.2 token 對比測試**
  - 檔案：`styles/tokens.test.ts`（新）。
  - 內容：讀 `global.css`，對 spec §4.3 對比表的每一組、兩種模式斷言門檻（文字 4.5:1、焦點框 3:1）。
  - 驗收：測試綠；把任一色碼故意改淡，測試會紅（手動驗一次後還原）。

- [ ] **1.3 `Icon` 元件**
  - 檔案：`components/Icon.tsx`、`Icon.test.tsx`（新）。
  - 內容：約 15 個 inline SVG（首頁、帳本、帳戶、分類、個人、鉛筆、垃圾桶、轉帳、加號、選單、日曆、左右箭頭、關閉、登出）。預設 `aria-hidden="true"`。
  - 驗收：測試——每個名稱都渲染出 `<svg>`，且對螢幕閱讀器隱藏。

- [ ] **1.4 `PageHeader` 元件**
  - 檔案：`components/PageHeader.tsx`、`PageHeader.test.tsx`（新）。
  - 內容：`title`（渲染成 `h2`）、選填 `context`、`description`、`actions`。
  - 驗收：測試——標題是 `h2`、層級正確、`actions` 渲染在右側。

- [ ] **1.5 `Dialog` 的 panel 變體**
  - 檔案：`components/Dialog.tsx`、`Dialog.module.css`、`Dialog.test.tsx`、`src/test/setup.ts`。
  - 內容：`variant: 'modal' | 'panel'`，預設 `modal`。`panel` 用 `show()`、自己接 Esc。`setup.ts` 補 `show()` 替身。
  - 驗收：既有 `Dialog.test.tsx` 全綠；新增三條——panel 不呼叫 `showModal`、Esc 會觸發 `onClose`、角色與名稱正確。

---

## Step 2：四個 worker 平行（Pi + `zai/glm-5.3`）

每份 Task spec 附：spec 與 plan 路徑、spec §4.3 token 表、提案頁 `docs/artifacts/web-design-v2.html` 第 0 節、自己的檔案清單、**不准碰的檔案**。

- [ ] **2.1 W1 外殼**
  - 檔案：plan §8 的 W1 清單。
  - 內容：側欄（`h1` 站名、帳本卡、導覽＋圖示、使用者、看得見的「登出」、收合鈕）、`use-sidebar-collapsed`、900–1199px 自動收合、訪客頂列、窄螢幕頂列（站名非 heading）、收合時的帳本方塊（D18）。
  - 驗收：
    - `AppShell.test.tsx` 四條原有斷言不改就綠。
    - 新增測試：收合選擇重新渲染後仍保留；收合時「作用中帳本」只有一個、導覽連結名稱不變；任何狀態只有一個 `h1`。

- [ ] **2.2 W2 首頁工作台**
  - 檔案：plan §8 的 W2 清單。
  - 內容：三欄版面、右側面板（D8、D9）、帳戶餘額移進面板、窄螢幕收合表單與隱藏列表（D10）、焦點回歸、統計卡換樣式。
  - 驗收：
    - 新增測試：面板預設是新增表單；按鉛筆變編輯；Esc 回到新增且焦點回到鉛筆鈕；新增與編輯表單不會同時存在。
    - `transaction-edit.test.tsx`、`use-transactions.test.tsx` 只改選取方式（加名稱），每一處記進 plan §10。

- [ ] **2.3 W3 交易表格**
  - 檔案：plan §8 的 W3 清單。
  - 內容：單行 44px 列、日期分組（D16）、鉛筆與垃圾桶圖示鈕加 `title`（D17）、整列點擊、三色金額、篩選列同高、分頁圖示鈕（名稱仍是「上一頁」「下一頁」）。
  - 驗收：
    - 新增測試：`listitem` 數量等於交易筆數；分組標題的日期文字正確；點列空白處會呼叫 `onEdit`，點垃圾桶不會。
    - 既有 `transactions.test.tsx`、`transaction-filters.test.tsx`、`Pagination.test.tsx` 不改就綠。

- [ ] **2.4 W4 其他頁面與基礎元件**
  - 檔案：plan §8 的 W4 清單。
  - 內容：5 個管理頁套用 `PageHeader`、內容左緣對齊；表格化的列表；基礎元件與彈窗改走 token；危險操作的「刪除帳本」用危險樣式。
  - 驗收：這些頁面的既有測試不改就綠；`*.module.css` 沒有色碼。

- [ ] **2.5 協調者逐一驗收 worker 產出**
  - 內容：假 API 截圖逐頁比對；`git diff` 檢查沒有刪掉任何 `aria-label`、按鈕文字、`<label>`。
  - 驗收：四份都通過才進 Step 3。沒過的寫明原因回給 worker 重做。

---

## Step 3：整合與驗證（協調者）

- [ ] **3.1 新增 `e2e/layout.spec.ts`**
  - 內容：建 21 筆交易，驗 1280×800 可見 ≥ 10 筆、390×844 第一筆在首屏、375px 按鈕不換行、篩選欄位同高、五個頁面的頁首左緣相同。
  - 驗收：新測試綠。

- [ ] **3.2 跑完整 e2e**
  - 前置：確認沒有別的 worktree 在跑（3100／5273／5274 埠、`ledger_test`）。
  - 驗收：既有 20 條一行不改全過；新增的也過。

- [ ] **3.3 截圖驗收**
  - 內容：375／390／900／1024／1280／1440／2560 × 深淺兩色 × 側欄展開與收合。
  - 驗收：沒有橫向捲動；截圖附在 PR 描述（`docs/artifacts/` 的 HTML 不進版控，截圖只貼 PR）。

- [ ] **3.4 鍵盤走一遍**
  - 內容：Tab 走完側欄、表格、面板；Esc 關面板；收合鈕可用鍵盤操作。
  - 驗收：兩種模式下焦點框都看得見。

---

## Step 4：文件與 PR-B（協調者）

- [ ] **4.1 文件**
  - 檔案：`docs/specs/phase-2-web-mvp.md` §3（加 SC-24～28、標註 SC-19 被取代的部分）、`docs/README.md`（2h 列入階段表與規格表）、plan §10 實作紀錄。
  - 驗收：`format:check` 綠。

- [ ] **4.2 開 PR-B**
  - 內容：`gh pr update-branch`（若 PR-A 已合）、push、`gh pr create`、盯 CI。**不合併，等開發者同意。**
  - 驗收：CI 全綠；PR 描述列出修改過選取方式的單元測試、`:has()` 的使用、沒有新增相依、截圖。
