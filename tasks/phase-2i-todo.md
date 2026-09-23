# Todo：階段二 (2i) — Web 版面第二輪

> 對應：[`phase-2i-plan.md`](phase-2i-plan.md)、[`docs/specs/phase-2i-web-layout-v2.md`](../docs/specs/phase-2i-web-layout-v2.md)。
> 依相依順序排列。每一項完成時打勾，並把實際數字寫進 plan §10。

---

## Step 0：開工前（協調者）

- [x] **0.1 基準線**
  - 內容：`pnpm install`、shared build、五個指令，記下 api／web 單元測試數與 e2e 條數。
  - 驗收：數字寫進 plan §10。

---

## Step 1：共用介面（協調者）

- [x] **1.1 token**
  - 檔案：`styles/global.css`。
  - 內容：`--content-max-wide: 72rem`、`--content-max-narrow: 52rem`、`--motion-panel: 220ms`、`--motion-fade: 160ms`、`--motion-ease`；`prefers-reduced-motion` 時三個時間是 0ms；刪 `--content-max`。
  - 驗收：`grep -rn "content-max\b" apps/web/src` 沒有結果；`tokens.test.ts` 綠。

- [x] **1.2 `PageContent` 並套到五個管理頁**
  - 檔案：`components/PageContent.*`（新）、帳本、帳本明細、帳戶、分類、個人資料五頁。
  - 內容：`width="wide" | "narrow"`，`margin-inline: auto` 置中。拿掉各頁自己的 `max-width`。
  - 驗收：單元測試驗兩種寬度的 class；既有測試全綠。

- [x] **1.3 右側欄的地基**
  - 檔案：`app/right-panel-context.tsx`（新）、`app/RightPanel.*`（新）、`App.tsx`、`App.module.css`。
  - 內容：plan D21 的 API；外殼三欄 grid 與 `grid-template-columns` 過渡；≤ 900px 抽屜；`RightPanelContent` 的登記與 portal。
  - 驗收：單元測試——沒有登記時第三欄寬度 0；登記後預設打開；收起後重新 mount 仍收起；unmount 取消登記；`requestFocus` 遞增。

- [x] **1.4 `/transactions` 路由**
  - 檔案：`app/routes.tsx`、`pages/TransactionsPage.tsx`（先放最小骨架，W2 填內容）。
  - 內容：掛在 `ProtectedRoute` 下；導覽的「交易」連結由 W1 加。
  - 驗收：路由測試——未登入進 `/transactions` 被導走。

---

## Step 2：兩個 worker 平行（Claude Code Opus 5）

- [x] **2.1 W1 側欄**
  - 內容：固定列高與收合動畫（D23）、收合鈕移到底部、拿掉帳本卡與深淺色列、導覽加「交易」拿掉「個人資料」、`UserMenu` 兩層（D24）、`ThemeToggle` 三選一、901–1199px 的浮動展開（D27）。
  - 驗收：SC-31、SC-32 的單元測試；lint／typecheck／test／format:check 綠；1440 截圖收合前後 icon 不動。

- [x] **2.2 W2 記帳頁**
  - 內容：`TransactionWorkbench`（D25）、`TransactionsPage`（2h 首頁的表格搬過來，測試一起搬）、`HomePage` dashboard（SC-34.1、最近 5 筆可點）、`LedgerSwitcher` 膠囊外觀並移到頁首（D26）、「＋ 新增交易」接 `requestFocus`。
  - 驗收：SC-33、SC-34、SC-35.3–35.5 的單元測試；四個指令綠；截圖。

- [x] **2.3 協調者逐一驗收並 merge 回本分支**
  - 驗收：假 API 截圖逐頁比對樣版網站；被刪掉的 `aria-label` 與按鈕文字逐一有理由；整合後四個指令綠。

---

## Step 3：整合與驗證（協調者）

- [x] **3.1 既有 e2e 的導航修改**
  - 檔案：`e2e/ui.ts`（`openTransactions`）、`transactions.spec.ts`、`ledgers.spec.ts:159`、`layout.spec.ts`（SC-24.3 移到 `/transactions`、SC-24.5 改置中軸——假設 14）。
  - 驗收：`git diff` 裡除了 SC-24.5 以外沒有任何 `expect` 行被改。

- [x] **3.2 新 e2e**
  - 檔案：`e2e/layout.spec.ts`。
  - 內容：SC-31.1、SC-35.1、SC-35.2、SC-36.1、SC-36.2、SC-32.3。
  - 驗收：新測試綠；反向驗證（把一列的高度改掉 → SC-31.1 紅）。

- [x] **3.3 跑完整 e2e**
  - 前置：確認沒有別的 worktree 占用 3100／5273／5274。
  - 驗收：web e2e 與 api e2e 全綠。

- [x] **3.4 截圖與鍵盤**
  - 內容：375／900／1024／1280／1440／2560 × 深淺 × 左側欄開合 × 右側欄開合；Tab 走完側欄、選單、頁首、表格、右側欄。
  - 驗收：沒有橫向捲動、沒有 console 錯誤、每個焦點都看得見。

---

## Step 4：文件與 PR（協調者）

- [x] **4.1 文件**
  - 檔案：`docs/specs/phase-2-web-mvp.md`（加 SC-31～37、標 SC-24.5／SC-25 的取代關係）、`docs/README.md`（2h 改「已完成」、加 2i）、plan §10。
  - 驗收：`format:check` 綠。

- [ ] **4.2 開 PR**
  - 內容：push、`gh pr create`、盯 CI。**CI 綠了停下來，等開發者看過畫面再合併。**
  - 驗收：CI 全綠；描述列出 e2e 每一處修改、唯一的斷言修改、沒有新增相依。
