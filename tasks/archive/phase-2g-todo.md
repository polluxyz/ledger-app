# 任務清單：階段二 (2g) — 收尾

> 狀態：**實作完成，待開發者驗收**（2026-09-23。plan 核可於 2026-09-23）
> 依據：`docs/specs/phase-2g-wrap-up.md`、`tasks/phase-2g-plan.md`。
> 用法：依相依順序執行；每個任務有驗收條件。**勾選＝「開發者已驗收」，不是「已經寫完」。**
> 分支：`chore/phase-2g-wrap-up`（自 `main` 開）。
>
> **本步會動 Prisma schema 與 `playwright.config.ts`，兩者皆已取得同意。不新增任何 npm 套件。**
>
> 通用驗收（每個任務皆適用，不再重複）：
> `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`、`pnpm build` 全綠。
> 基準線：web 單元測試 **27 檔 / 156 條**、e2e **17 條**（2026-09-23 實測）。只能增加。

### 設計決策

| #   | 結論                                                                       | 出處      |
| --- | -------------------------------------------------------------------------- | --------- |
| D1  | CSP 在 build 時由 Vite 插件注入，`index.html` 保持乾淨，dev 不受影響       | spec §4.1 |
| D2  | 對照表放 `apps/web/src/lib/error-messages.ts`，查不到退回後端原文          | spec §4.2 |
| D3  | 分類排序走方案 A：`Category` 加 `sortOrder Int @default(0)`                | spec §4.3 |
| D4  | 補 `Button` / `TextField` / `Select` / `FormError` / `Pagination` 五個測試 | spec §4.4 |
| D5  | `sortOrder` 寫進 `packages/shared` 的 `Category` 型別，但**前端不使用它**  | plan §4   |
| D6  | CSP 的 `connect-src` 從 `VITE_API_BASE_URL` 推導，不寫死                   | plan §4   |
| D7  | preview 用 5274 埠，埠號寫在 `e2e/env.ts`                                  | plan §4   |
| D8  | 對照表只寫「使用者能據以行動」的句子，**不可比後端更具體**                 | plan §4   |

---

## Step 0：開工前

- [ ] **0.1 開分支**
  - 內容：自 `main` 開 `chore/phase-2g-wrap-up`。
  - 驗收：`main` 未被動到；`git status` 乾淨。

- [ ] **0.2 記下 api 測試的基準線**
  - 內容：跑 `pnpm --filter @ledger/api test`，把檔數與條數寫進 plan §7。
  - 驗收：plan 裡有這個數字。

---

## Step 1：分類排序（後端，協調者自己做）

- [ ] **1.1 Prisma schema 加 `sortOrder`**
  - 檔案：`apps/api/prisma/schema.prisma`（`model Category`，:99）。
  - 內容：加 `sortOrder Int @default(0)`。**純加法**，不動既有欄位、不刪任何東西。
  - 注意：走 migration，**不可手動改資料庫**。指令
    `pnpm --filter @ledger/api exec prisma migrate dev --name add_category_sort_order`。
  - 驗收：`prisma/migrations/` 多一個目錄；`pnpm --filter @ledger/api typecheck` 綠。

- [ ] **1.2 種子依定義順序填值**
  - 檔案：`apps/api/src/ledgers/ledgers.service.ts`（:77 的 `createMany`）。
  - 內容：`DEFAULT_CATEGORIES.map((category, index) => ({ ..., sortOrder: index }))`。
  - 驗收：新建帳本後，DB 裡 12 筆的 `sortOrder` 是 0..11。

- [ ] **1.3 排序改用 `sortOrder`**
  - 檔案：`apps/api/src/categories/categories.service.ts`（:30）。
  - 內容：`orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]`。
  - 注意：次要鍵 `name` 是必要的——既有分類的 `sortOrder` 全是 0，沒有次要鍵就還是不確定。
  - 驗收：型別綠。

- [ ] **1.4 後端測試**
  - 檔案：`apps/api/src/categories/categories.service.spec.ts`。
  - 內容：2 條 —— 列出新帳本的分類時順序等於 `DEFAULT_CATEGORIES`；
    `sortOrder` 相同時退回 `name` 排序。
  - 驗收：2 條全綠，既有測試不變紅。

---

## Step 2：共用型別（協調者自己做）

- [ ] **2.1 `Category` 型別加 `sortOrder`**
  - 檔案：`packages/shared/src/types/category.ts`。
  - 內容：加 `sortOrder: number`，註解寫明**前端不用它排序**，
    排序由後端做完，欄位在這裡只是讓契約誠實（D5）。
  - 注意：⚠️ 這是 **API 回應形狀變更**。純加法，前端不改也不會壞，但 PR 描述必須明說。
  - 驗收：`pnpm --filter @ledger/shared build` 綠；web 與 api 的 typecheck 都綠。

- [ ] **2.2 重建 shared 並重開 dev server**
  - 內容：`pnpm --filter @ledger/shared build`。
  - 注意：⚠️ 改了 `packages/shared` 之後**開發伺服器要重開**才會拿到新的預先打包結果
    （`apps/web/CLAUDE.md` 的已知陷阱）。
  - 驗收：瀏覽器開得起來，沒有整頁全白。

---

## Step 3：錯誤訊息在地化（派工 E）

- [ ] **3.1 `error-messages.ts`**
  - 檔案：`apps/web/src/lib/error-messages.ts`（新）。
  - 內容：匯出 `ERROR_MESSAGES: Partial<Record<ErrorCode, string>>` 與
    `toUserMessage(error: unknown): string`。
    - `ApiError` 且對照表有這個 `errorCode` → 回中文。
    - `ApiError` 但對照表沒有 → **回後端原文**（絕不回空字串或「未知錯誤」）。
    - 不是 `ApiError` → 回「無法連線到伺服器，請確認網路後再試一次。」
  - 內容（文案）：至少涵蓋 plan §4 D8 表列的六個代碼，其餘常見代碼一併補。
  - 注意：⚠️ **不可以寫得比後端更具體**。不要編造後端沒給的數字或原因（D8）。
  - 驗收：型別綠。

- [ ] **3.2 `error-messages.test.ts`**
  - 檔案：`apps/web/src/lib/error-messages.test.ts`（新）。
  - 內容：3 條 —— 已知代碼回中文、未知代碼回後端原文、非 `ApiError` 回連線錯誤訊息。
  - 驗收：3 條全綠。

- [ ] **3.3 `FormError` 改用 `toUserMessage`**
  - 檔案：`apps/web/src/components/FormError.tsx`。
  - 內容：`message` 改由 `toUserMessage(error)` 產生。`details` 照舊原樣呈現（不在地化）。
  - 注意：**`ConfirmDialog` 不必改**——它內部就是用 `FormError`（`ConfirmDialog.tsx:69`），
    改這裡兩個地方一起生效。
  - 驗收：型別綠；既有測試若斷言英文訊息，一併改成中文（意圖不變）。

- [ ] **3.4 更新過時的註解**
  - 檔案：`FormError.tsx`、`features/accounts/use-accounts.ts`、
    `features/ledgers/use-ledgers.ts`、`features/categories/use-categories.ts`。
  - 內容：那幾處都寫著「前端不自行改寫錯誤訊息：那是後端的職責」。對照表存在之後這句話不對了。
    改成講清楚新的分界：**訊息內容仍由後端定義，前端只負責把 `errorCode` 對應到在地化字串**。
  - 注意：這不是可選的收尾。留著過時的註解會讓下一個人照舊做法走。
  - 驗收：全專案搜不到那句舊說法。

- [ ] **3.5 五個元件測試**
  - 檔案：`components/Button.test.tsx`、`TextField.test.tsx`、`Select.test.tsx`、
    `FormError.test.tsx`、`Pagination.test.tsx`（全新）。
  - 內容：各 2～3 條。`FormError` 那份**必須涵蓋「未知代碼退回後端原文」**——
    它是對照表的唯一出口。
  - 注意：**不要**為 `AccountsPage`、`LedgersPage`、`HomePage` 補同名測試檔。
    它們的行為已經被 `features/` 底下的測試蓋到了，再寫一份只是重複（spec §4.4）。
  - 驗收：五個檔案全綠。

---

## Step 4：CSP（派工 F，與 Step 3 平行）

- [ ] **4.1 CSP 插件**
  - 檔案：`apps/web/vite.config.ts`。
  - 內容：加一個 `apply: 'build'` 的插件，用 `transformIndexHtml` 注入
    `<meta http-equiv="Content-Security-Policy" content="...">`。
    `connect-src` 的來源從 `VITE_API_BASE_URL` 取 origin，沒設時用 `http://localhost:3000`（D6）。
  - 注意：⚠️ **`index.html` 保持乾淨、不要寫死 CSP**。Vite 的 dev server 靠 inline script
    做 HMR，寫死會讓 `pnpm dev` 整個壞掉。
  - 注意：⚠️ **`script-src` 絕不可以放 `'unsafe-inline'`**，那等於沒做（spec §7 Never）。
  - 驗收：`pnpm --filter @ledger/web build` 後，`dist/index.html` 看得到那個 meta；
    **`pnpm --filter @ledger/web dev` 開得起來且 HMR 正常**（當場手動試）。

- [ ] **4.2 preview 的埠與 webServer**
  - 檔案：`apps/web/e2e/env.ts`、`apps/web/playwright.config.ts`。
  - 內容：`env.ts` 加 `PREVIEW_PORT = 5274` 與 `PREVIEW_ORIGIN`（沿用既有寫法，埠號不散在設定檔裡）。
    `playwright.config.ts` 加第三個 webServer：先 build 再 `vite preview --port 5274 --strictPort`，
    `env` 帶 `VITE_API_BASE_URL` 指向測試用的 API（3100）。
  - 注意：既有的 3100 與 5273 不可動。
  - 驗收：`pnpm --filter @ledger/web test:e2e` 起得來三個伺服器。

- [ ] **4.3 `csp.spec.ts`**
  - 檔案：`apps/web/e2e/csp.spec.ts`（新）。
  - 內容：3 條 ——
    1. preview 的頁面含 CSP 的 meta。
    2. 走一遍登入並看得到資料，**過程中 console 沒有任何 CSP 違規**
       （`connect-src` 漏了 API 來源的話這條會當場紅）。
    3. 用 `page.addScriptTag({ content: ... })` 注入 inline script，**被擋下**。
  - 注意：這一條用 `PREVIEW_ORIGIN`，不是 `WEB_ORIGIN`。
  - 驗收：3 條全綠。

- [ ] **4.4 手動點過每一頁**
  - 內容：preview 模式下開著 console，點過首頁、帳本、帳本明細、帳戶、分類、個人資料。
  - 注意：`style-src` 不放 `'unsafe-inline'` 的賭注在這裡驗證。只看首頁不算數——
    某個相依可能只在特定頁面才注入 style。
  - 驗收：六頁都沒有 CSP 違規；有的話把實際違規內容記進 plan §10，再決定要不要放寬。

---

## Step 5：既有 e2e 與文件（協調者自己做）

- [ ] **5.1 既有 e2e 的英文斷言改中文**
  - 內容：先跑一次完整 e2e 找出哪幾條因為訊息改中文而變紅，逐條改。
  - 注意：⚠️ **只能改訊息字串，不能改選取器或斷言意圖**（SC-12）。
  - 驗收：17 條既有 e2e 全綠。

- [ ] **5.2 README**
  - 檔案：`README.md`。
  - 內容：功能敘述補上分類管理與個人資料頁；確認啟動步驟與實際情況一致。
  - 驗收：照著 README 從零跑一次跑得起來。

- [ ] **5.3 `security-baseline.md`**
  - 檔案：`docs/specs/security-baseline.md`（SEC-4）。
  - 內容：註明 CSP 目前走 `meta`，因此 `frame-ancestors` 與 `report-uri` **尚未生效**，
    要等有靜態主機時補 HTTP 標頭。
  - 注意：不要寫成「SEC-4 已完成」。做完的是一部分。
  - 驗收：SEC-4 底下看得到這個限制。

- [ ] **5.4 `phase-2-web-mvp.md` 與 `docs/README.md`**
  - 內容：勾掉「9. 收尾」；技術債表的 CSP 與錯誤訊息在地化兩列標示完成（CSP 標部分完成）；
    新增一列「`details` 欄位層級訊息在地化」，建議時機寫「階段三以後」。
    `docs/README.md` 的階段二狀態改「完成」，規格表加一列 `phase-2g-wrap-up.md`。
  - 驗收：兩份文件的狀態與實際一致。

- [ ] **5.5 開 PR**
  - 內容：標題 `chore(web): add CSP, localize error messages, and stabilize category order`。
    描述依 `.github/pull_request_template.md` 四節填。
    **影響範圍必須明說：動了 Prisma schema（純加法 migration）與 `Category` 的 API 回應形狀。**
  - 驗收：CI 全綠後 squash merge，刪分支，切回 `main` 並 `git pull`。

- [ ] **5.6 歸檔**
  - 內容：把 `phase-2g-plan.md` 與 `phase-2g-todo.md` 移進 `tasks/archive/`。
  - 驗收：`tasks/` 底下只剩 `archive/`。
