# 任務清單：階段二 Slice 4 — 分類管理 + 個人資料

> 狀態：**實作完成，待開發者驗收**（2026-09-23。plan 核可於 2026-09-23）
> 依據：`docs/specs/phase-2-web-mvp.md`、`tasks/phase-2b-slice-4-plan.md`。
> 用法：依相依順序執行；每個任務有驗收條件。**勾選＝「開發者已驗收」，不是「已經寫完」。**
> 分支：`feature/web-categories-profile`（自 `main` 開）。
> **本步不改後端、不新增套件、不新增環境變數、不動 CI、不動 Prisma schema。**
>
> 通用驗收（每個任務皆適用，不再重複）：
> `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`、`pnpm build` 全綠。
> 測試基準線：**24 個檔案、139 條**（2026-09-23 實測）。只能增加，不能有原本綠的變紅。

### 設計決策

| #   | 結論                                                                                 | 出處    |
| --- | ------------------------------------------------------------------------------------ | ------- |
| D1  | 分類做成獨立一頁 `/categories`，頁內自己的帳本下拉，不與側邊欄切換器連動             | 提案頁  |
| D2  | 支出與收入兩區塊上下並列，各自有新增按鈕                                             | 提案頁  |
| D3  | 刪除分類用一般確認彈窗，不要求輸入名稱                                               | 提案頁  |
| D4  | 非 EDITOR 隱藏新增／改名／刪除，並顯示一行說明                                       | 提案頁  |
| D5  | 錯誤訊息維持後端原文，在地化留到階段二收尾                                           | 提案頁  |
| D6  | 個人資料入口放側邊欄，`/profile`                                                     | 提案頁  |
| D7  | 頁內選的帳本 id 放網址查詢字串 `?ledgerId=`，用 `useSearchParams()`                  | plan §4 |
| D8  | 頁內帳本 ≠ 作用中帳本時顯示提示條 + 一鍵切換                                         | plan §4 |
| D9  | 下拉清單用 `useActiveLedger().ledgers`，不另外發請求；角色從 `LedgerSummary.role` 拿 | plan §4 |
| D10 | 帳本明細頁的「管理分類」連結帶 `?ledgerId=`，**不改作用中帳本**                      | plan §4 |
| D11 | 網址的 `ledgerId` 對不上清單就退回作用中帳本並說明                                   | plan §4 |
| D12 | `CategoryDialog` 新增與改名共用一份表單；新增時型別由按鈕帶入，表單無型別欄位        | plan §4 |

---

## Step 0：開工前

- [ ] **0.1 開分支**
  - 內容：自 `main` 開 `feature/web-categories-profile`。
  - 驗收：`main` 未被動到；`git status` 乾淨。

---

## Step 1：分類的資料層（派工 A）

- [ ] **1.1 `use-categories.ts` 補三個 mutation**
  - 檔案：`apps/web/src/features/categories/use-categories.ts`（目前 25 行）。
  - 內容：新增 `useCreateCategory(ledgerId)`、`useRenameCategory(ledgerId)`、
    `useDeleteCategory(ledgerId)`。端點分別是
    `POST /ledgers/{ledgerId}/categories`、
    `PATCH /ledgers/{ledgerId}/categories/{categoryId}`、
    `DELETE /ledgers/{ledgerId}/categories/{categoryId}`（回 204 無 body）。
    型別用 `@ledger/shared` 既有的 `CreateCategoryRequest`、`UpdateCategoryRequest`、`Category`。
  - 注意：
    - **三個都要讓 `['categories', ledgerId]` 前綴失效**，否則列表與記帳表單的下拉都停在舊資料。
      這不會拋錯也不會讓測試變紅，是最容易漏的一項。
    - **不要攔截錯誤**。`apiRequest` 已經把統一錯誤格式轉成 `ApiError`，交給 `FormError` 呈現。
      前端不改寫後端訊息（D5，也是 `use-accounts.ts` 既有的立場）。
    - 把既有的 `useCategories` 抽一個共用的 key 函式出來，別讓 key 字串散在四個地方。
  - 驗收：`pnpm --filter @ledger/web typecheck` 綠；測試數不變（139）。

- [ ] **1.2 `use-categories` 的單元測試**
  - 檔案：`apps/web/src/features/categories/use-categories.test.tsx`（新）。
  - 內容：4 條 —— 新增成功後快取失效、改名成功後快取失效、刪除成功後快取失效、
    409 時 `mutation.error` 是 `ApiError` 且 `errorCode` 正確。
  - 驗收：4 條全綠。

---

## Step 2：個人資料（派工 B，與 Step 1 平行）

- [ ] **2.1 `useUpdateProfile`**
  - 檔案：`apps/web/src/features/auth/use-current-user.ts`（改）。
  - 內容：`useUpdateProfile()`，`PATCH /users/me`，body 只有 `{ name }`，回 `AuthUser`。
    `onSuccess` 讓 `CURRENT_USER_KEY` 失效。
  - 注意：只送 `name`。多送欄位會被後端退 400（全域開了 `forbidNonWhitelisted`）。
  - 驗收：型別綠。

- [ ] **2.2 `ProfilePage`**
  - 檔案：`apps/web/src/pages/ProfilePage.tsx`、`ProfilePage.module.css`（新）。
  - 內容：`h2` 標題「個人資料」。Email 唯讀顯示 + 一行提示「Email 不可變更」；
    名稱用 `TextField`，一顆「儲存」。錯誤用 `FormError`。送出中按鈕停用並顯示「儲存中…」。
  - 注意：
    - 版面比照 `AccountsPage.module.css`：`.page { max-width: 52rem }`，標題 `var(--text-xl)`。
    - 站名才是 `h1`，頁面標題一律 `h2`。
    - Email 用唯讀呈現即可，不要做成 `disabled` 的 input（讀不出來也選不起來）。
  - 驗收：型別綠；瀏覽器開 `/profile` 版面與帳戶頁一致。

- [ ] **2.3 `ProfilePage` 的單元測試**
  - 檔案：`apps/web/src/pages/ProfilePage.test.tsx`（新）。
  - 內容：3 條 —— 顯示現有 email 與名稱、改名送出後呼叫正確端點與 body、
    後端回 400 時畫面顯示錯誤訊息且不清空輸入框。
  - 驗收：3 條全綠。

---

## Step 3：分類的展示元件（派工 C，等 Step 1）

- [ ] **3.1 `CategoryDialog`**
  - 檔案：`apps/web/src/features/categories/CategoryDialog.tsx`（新）。
  - 內容：新增與改名共用（D12）。`target` 為 `null` 關閉、`{ type: CategoryType }` 為新增、
    `Category` 物件為改名。用 `key` 強制重建（比照 `AccountDialog.tsx`）。
    標題：「新增支出分類」／「新增收入分類」／「編輯分類」。
  - 注意：
    - **表單上沒有型別欄位**（D12）。新增時型別由呼叫端帶入；改名時型別不可改。
    - 送出失敗**不關彈窗**，錯誤用 `FormError` 就地顯示。
    - 名稱 `maxLength` 對齊後端 DTO，寫程式前先看 `apps/api/src/categories/dto/create-category.dto.ts`。
  - 驗收：型別綠。

- [ ] **3.2 `CategoryList`**
  - 檔案：`apps/web/src/features/categories/CategoryList.tsx`、`CategoryList.module.css`（新）。
  - 內容：呈現**單一型別**的一組分類。每列「名稱 …… 改名 刪除」。
    props 收 `categories`、`isLoading`、`error`、`canEdit`、`onEdit`、`onRemove`。
    `canEdit` 為 false 時不畫任何按鈕（D4）。空清單顯示提示。
  - 注意：
    - 樣式直接沿用 `AccountList.module.css` 的形狀，讓兩個列表看起來屬於同一個 app。
    - **列表 key 用 `category.id`，不要用 name。** 預設分類裡支出與收入各有一個「其他」。
  - 驗收：型別綠。

---

## Step 4：分類頁（派工 D，等 Step 3）

- [ ] **4.1 `CategoriesPage` 的帳本選擇**
  - 檔案：`apps/web/src/pages/CategoriesPage.tsx`、`CategoriesPage.module.css`（新）。
  - 內容：
    - 帳本 id 讀寫網址查詢字串 `?ledgerId=`，用 `useSearchParams()`，**不用 `useState`**（D7）。
    - 清單來自 `useActiveLedger().ledgers`，不另外發請求（D9）。
    - 沒有 `ledgerId` 參數時預設帶入作用中帳本。
    - 只有一本帳本時不畫下拉，改顯示名稱（比照 `LedgerSwitcher.tsx`）。
    - `ledgerId` 對不上清單時退回作用中帳本並顯示一行說明（D11）。
  - 注意：**這一頁絕對不呼叫 `setActiveLedgerId`，除了 4.2 那顆按鈕。** D1 選 C 的意思就是兩邊獨立。
  - 驗收：型別綠；換下拉時網址跟著變；重整後仍停在同一本。

- [ ] **4.2 不一致提示條（D8）**
  - 內容：頁內選的帳本 ≠ 作用中帳本時，標題下方顯示一條提示，含一顆按鈕：
    「你正在管理「X」的分類。記帳目前使用的是「Y」。[改用 X 記帳]」。
    按鈕呼叫 `setActiveLedgerId`，按完提示消失。兩邊一致時**什麼都不顯示**。
  - 注意：這條是 D1 選 C 的必要配套，不是裝飾。沒有它，使用者記錯帳本時畫面上沒有任何線索。
  - 驗收：兩邊不一致時看得到、一致時看不到；按下按鈕後側邊欄的切換器跟著換。

- [ ] **4.3 兩區塊列表與操作**
  - 內容：支出、收入兩個 `h3` 區塊上下並列（D2），各自有「新增支出分類」／「新增收入分類」。
    每區用一個 `CategoryList`。刪除用 `ConfirmDialog`，**不帶 `confirmText`**（D3）。
    刪除失敗不關彈窗，409 就地顯示。
  - 注意：
    - 資料流留在頁面這一層，彈窗只負責呈現與回報（比照 `AccountsPage.tsx`）。
    - 關閉刪除彈窗時要 `mutation.reset()`，下次開啟才不會殘留紅字。
  - 驗收：新增、改名、刪除三個動作都不必重整即反映在列表上。

- [ ] **4.4 角色控制（D4）**
  - 內容：從 `LedgerSummary.role` 取角色。不是 `OWNER` 或 `EDITOR` 就把 `canEdit` 設為 false，
    並顯示一行「你在這本帳本是檢視者，無法變更分類」。
  - 注意：**這只決定按鈕畫不畫，是體驗不是授權。**
    絕對不可以用角色決定要不要發請求或過濾資料——真正的防線是後端的 `@RequireLedgerRole`。
  - 驗收：以 VIEWER 身分看不到任何寫入按鈕，且看得到說明。

- [ ] **4.5 `CategoriesPage` 的單元測試**
  - 檔案：`apps/web/src/pages/CategoriesPage.test.tsx`（新）。
  - 內容：至少 8 條 —— 兩區塊各自顯示正確筆數、新增後出現在正確那一組、
    重複名稱顯示 409、改名更新、刪除 409 時彈窗不關、換下拉會換資料且網址跟著變、
    不一致提示條的出現與消失、VIEWER 看不到按鈕。
  - 驗收：8 條全綠。

---

## Step 5：接進 app（協調者自己做）

- [ ] **5.1 路由**
  - 檔案：`apps/web/src/app/routes.tsx`（41 行）。
  - 內容：在 `ProtectedRoute` 之下加 `/categories` 與 `/profile`。
  - 驗收：未登入存取這兩頁會被導去 `/login`。

- [ ] **5.2 側邊欄連結**
  - 檔案：`apps/web/src/app/AppSidebar.tsx`（73 行）、`AppSidebar.test.tsx`。
  - 內容：導覽加「分類」與「個人資料」，順序是 首頁 / 帳本 / 帳戶 / 分類 / 個人資料。
    兩個都要帶 `onNavigate`。登出維持在底部不動（D6）。
  - 注意：⚠️ **既有三個連結的文字一個字都不能改**——`e2e/ledgers.spec.ts` 有 5 處靠
    `getByRole('link', { name })` 定位它們。新字串也不可與既有的重疊。
  - 驗收：`AppSidebar.test.tsx` 全綠；窄螢幕點新連結後浮動選單會收起。

- [ ] **5.3 帳本明細頁的「管理分類」連結（D10）**
  - 檔案：`apps/web/src/pages/LedgerDetailPage.tsx`（292 行）。
  - 內容：成員區塊上方加一個連結，指向 `/categories?ledgerId=<這本的 id>`。
    **不呼叫 `setActiveLedgerId`。** 帳本已封存時不顯示。
  - 驗收：`LedgerDetailPage.test.tsx` 全綠；從明細頁點過去看到的是那一本的分類，
    且側邊欄的作用中帳本沒有被改動。

- [ ] **5.4 確認既有 e2e 沒被弄壞（SC-19.4）**
  - 內容：跑完整 e2e，**不修改任何既有斷言或選取器**。
  - 注意：⚠️ 跑之前確認沒有別的 worktree 在跑 e2e（共用 `ledger_test`，每個測試前清空）。
  - 驗收：既有 15 條全綠。紅了就是 5.2 的連結撞名，改連結文字而不是改測試。

---

## Step 6：e2e

- [ ] **6.1 `e2e/categories.spec.ts`**
  - 檔案：`apps/web/e2e/categories.spec.ts`（新）。
  - 內容：2 條 ——
    1. 在分類頁新增一個分類，回首頁記帳，**分類下拉裡看得到它**。
    2. 在分類頁改名一個分類，回首頁記帳，下拉顯示的是新名字。
  - 為什麼要這兩條：快取失效是跨頁面的事，單元測試涵蓋不到。
    漏做不會拋錯、不會讓測試變紅，只會讓下拉停在舊資料（plan §6）。
  - 驗收：2 條全綠；連同既有 15 條共 17 條全綠。

---

## Step 7：文件與收尾

- [ ] **7.1 更新 spec 與文件索引**
  - 檔案：`docs/specs/phase-2-web-mvp.md`、`docs/README.md`。
  - 內容：勾掉「8. Slice 4」；把 D1～D12 的結論寫進 spec（**artifact 會被刪，決策不能只留在那裡**）；
    `docs/README.md` 的階段二狀態改成「剩收尾」。
  - 驗收：`pnpm format:check` 綠。

- [ ] **7.2 把錯誤訊息在地化記進收尾（D5）**
  - 檔案：`docs/specs/phase-2-web-mvp.md` 的「尚未歸位的技術債」表。
  - 內容：新增一列 —— 後端錯誤訊息是英文，前端原樣呈現；建議時機「收尾」。
  - 驗收：那張表看得到這一列。

- [ ] **7.3 開 PR**
  - 內容：標題 `feat(web): add category management and profile pages`。
    描述依 `.github/pull_request_template.md` 四節填，影響範圍註明
    **沒有動到資料模型與 API**。
  - 驗收：CI 全綠後 squash merge，刪分支，切回 `main` 並 `git pull`。

- [ ] **7.4 歸檔**
  - 內容：把 `phase-2b-slice-4-plan.md` 與 `phase-2b-slice-4-todo.md` 移進 `tasks/archive/`。
  - 驗收：`tasks/` 底下只剩 `archive/`。
