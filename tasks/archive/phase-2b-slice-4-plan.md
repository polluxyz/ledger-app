# 實作計畫：階段二 Slice 4 — 分類管理 + 個人資料

> 狀態：**實作完成，待開發者驗收**（2026-09-23。plan 核可於 2026-09-23）
> 依據：`docs/specs/phase-2-web-mvp.md`（spec 已核可）。提案頁 `docs/artifacts/step-slice-4-08-categories-page.html` 的 D1～D6 已於 2026-09-23 拍板。
> 對應成功條件：**SC-9**（分類管理）、**SC-11**（個人資料）、**SC-12**、**SC-19.4**。
> 前置：2f 已合併（PR #31）。
> **本步不改後端、不新增套件、不新增環境變數、不動 CI、不動 Prisma schema。**

---

## 1. 為什麼是這一塊

分類與個人資料是階段二 spec 裡**唯二還沒有畫面的後端能力**。兩邊的端點都早已完備：

- 分類：`apps/api/src/categories/categories.controller.ts:30`，`GET / POST / PATCH / DELETE`，路徑 `/ledgers/:ledgerId/categories`。
- 個人資料：`apps/api/src/users/users.controller.ts`，`GET /users/me` 與 `PATCH /users/me`。

前端目前只有 `apps/web/src/features/categories/use-categories.ts`（25 行）一個唯讀查詢 hook。

排在 2f 之後的理由見 spec §「為什麼這樣排」：這一塊要新增兩個頁面，先把 dashboard 骨架定下來，這兩頁就只做一次版面。

做完這一塊，階段二只剩「收尾」（測試補完、README、CSP），不再有新畫面。

---

## 2. 範圍

### 範圍內

- 分類管理頁 `/categories`：列表、新增、改名、刪除，支出與收入分兩區。
- 分類頁自己的帳本選擇器（**與側邊欄的作用中帳本各自獨立**，D1 選 C）。
- 個人資料頁 `/profile`：檢視 email（唯讀）與名稱，可改名。
- 側邊欄新增兩個導覽連結。
- 帳本明細頁新增一個「管理分類」連結。
- `use-categories.ts` 補三個 mutation。
- 兩頁的單元測試，以及 2 條跨頁面的 e2e。

### 範圍外

- **錯誤訊息在地化**（D5 選 A）。後端訊息是英文，帳戶頁現在也一樣。這一步維持現況，把它列進階段二「收尾」當獨立議題。
- 分類排序、分類圖示、分類統計、分類合併。
- 變更密碼、刪除帳號（spec 未涵蓋）。
- 任何後端變更。

---

## 3. 元件與相依

```
apps/web/src/
├── app/
│   ├── routes.tsx                    改（41 行）  +2 條受保護路由
│   ├── AppSidebar.tsx                改（73 行）  +2 個導覽連結
│   └── AppSidebar.test.tsx           改          +連結斷言
├── features/
│   ├── categories/
│   │   ├── use-categories.ts         改（25 行）  +3 個 mutation
│   │   ├── CategoryList.tsx          新          單一型別的一組列表
│   │   ├── CategoryList.module.css   新
│   │   ├── CategoryDialog.tsx        新          新增 / 改名共用
│   │   └── use-categories.test.tsx   新
│   └── auth/
│       └── use-current-user.ts       改          +useUpdateProfile
├── pages/
│   ├── CategoriesPage.tsx            新
│   ├── CategoriesPage.module.css     新
│   ├── CategoriesPage.test.tsx       新
│   ├── ProfilePage.tsx               新
│   ├── ProfilePage.module.css        新
│   ├── ProfilePage.test.tsx          新
│   └── LedgerDetailPage.tsx          改（292 行） +「管理分類」連結
├── components/                       不動
└── e2e/
    └── categories.spec.ts            新          2 條

docs/specs/phase-2-web-mvp.md         改          勾掉 Slice 4、記下 D1～D12
docs/README.md                        改          階段二狀態
```

**不新增任何 npm 套件。不新增環境變數。不改後端。`packages/shared` 不動**——
`Category`、`CreateCategoryRequest`、`UpdateCategoryRequest`、`AuthUser` 全都已經存在。

依賴方向：

```
CategoriesPage ──┬─ useActiveLedger()      取帳本清單與角色（唯讀，不呼叫 setActiveLedgerId）
                 ├─ useSearchParams()      頁內選的帳本 id
                 ├─ CategoryList  × 2      支出一組、收入一組
                 └─ CategoryDialog / ConfirmDialog

ProfilePage ─────┬─ useCurrentUser()
                 └─ useUpdateProfile()
```

---

## 4. 設計決策

### 已於提案頁核可（2026-09-23）

| #   | 結論                                                                         |
| --- | ---------------------------------------------------------------------------- |
| D1  | 分類做成獨立一頁 `/categories`，**頁內自己的帳本下拉**，不與側邊欄切換器連動 |
| D2  | 支出與收入兩區塊上下並列，各自有新增按鈕                                     |
| D3  | 刪除分類用一般確認彈窗，不要求輸入名稱                                       |
| D4  | 非 EDITOR 隱藏新增／改名／刪除，並顯示一行說明                               |
| D5  | 錯誤訊息維持後端原文（英文），在地化留到階段二收尾                           |
| D6  | 個人資料入口放側邊欄，`/profile`                                             |

### 實作階段新增，**需要一併核可**

#### D7 — 頁內選的帳本 id 放在網址查詢字串

`/categories?ledgerId=<id>`，用 `useSearchParams()` 讀寫，**不用 `useState`**。

理由：D1 選 C 的核心是「這一頁的帳本自己決定」。若存在元件 state，重整就掉回預設，
而且沒辦法從別的地方連過來。放網址則三件事同時成立——重整保留、可加書籤、
帳本明細頁能直接連到「那一本」的分類頁而不必碰作用中帳本（見 D10）。

沒有 `ledgerId` 參數時，預設帶入作用中帳本（D9）。

#### D8 — 兩邊不一致時，頁面顯示提示條（C 的風險對策）

這是提案頁替 C 標記的失敗情境：使用者在頁內選了「旅遊帳本」加完分類，
回首頁記帳卻記進「個人帳本」，因為側邊欄的切換器從來沒動過。

對策：**頁內選的帳本 ≠ 作用中帳本時**，在頁面標題下方顯示一條提示，包含一個按鈕：

> 你正在管理「旅遊帳本」的分類。記帳目前使用的是「個人帳本」。　[改用旅遊帳本記帳]

按鈕呼叫 `setActiveLedgerId()`，按完兩邊一致，提示條消失。
兩邊一致時**不顯示任何東西**——多數情況下使用者看不到這條，不會變成雜訊。

這條提示不是裝飾，是 D1 選 C 的必要配套。沒有它，記錯帳本這件事畫面上完全沒有線索。

#### D9 — 頁內下拉的預設值與清單來源

- 清單來自 `useActiveLedger().ledgers`，**不另外發請求**。那份清單已經在快取裡，
  而且型別是 `LedgerSummary`，**本身就帶 `role`**——D4 要的角色直接從這裡拿。
- 沒有 `ledgerId` 參數時預設帶入作用中帳本。
- 只有一本帳本時不畫下拉，改顯示帳本名稱（比照 `LedgerSwitcher.tsx` 的處理）。

> 提案頁說 D4「可能要多一次 `useLedger(id)` 請求」。查證後不需要：`LedgerSummary`
> 已經帶 `role`（`packages/shared/src/types/ledger.ts:51`）。這裡更正。

#### D10 — 帳本明細頁的「管理分類」連結

`LedgerDetailPage` 的成員區塊上方加一個連結，指向 `/categories?ledgerId=<這本的 id>`。

**它不呼叫 `setActiveLedgerId`。** 這正是 C 比 B 乾淨的地方：帶著 id 過去就好，
不必為了看一眼分類而改掉使用者記帳用的帳本。

帳本已封存時不顯示這個連結（封存後唯讀，見 D11）。

#### D11 — 網址上的 ledgerId 對不上清單時，退回作用中帳本

`ledgerId` 可能失效：帳本被刪、我被移出成員、帳本被封存、或是手打亂填。
處理方式比照 `ActiveLedgerProvider` 的「存下來的 id 一定要驗證」：
**對不上 `ledgers` 就退回作用中帳本，並顯示一行說明。**

因為 `ledgers` 不含已封存的帳本，「封存」會自然落進這個分支，不必另外寫判斷。
這也是 D10 在封存帳本上不顯示連結的原因——連過去也只會被退回。

#### D12 — `CategoryDialog` 新增與改名共用一份表單

比照 `AccountDialog.tsx`：`target` 為 `null` 關閉、`{ type }` 為新增、
`Category` 物件為改名。用 `key` 強制重建，表單狀態不會殘留上一筆。

**新增時型別由按鈕帶入，表單上沒有型別欄位**（D2 的附帶好處）。
改名時型別不可變（後端的 `UpdateCategoryRequest` 只收 `name`），也不顯示。

---

## 5. 實作順序

| 順序 | 內容                               | 為什麼排這裡                             |
| ---- | ---------------------------------- | ---------------------------------------- |
| 1    | `use-categories.ts` 三個 mutation  | 下游全部依賴它；純資料層，可獨立驗證     |
| 2    | `CategoryDialog` + `CategoryList`  | 兩個展示元件，不依賴頁面                 |
| 3    | `CategoriesPage`（含 D7～D11）     | 把上面兩個組起來，帳本選擇的邏輯在這一層 |
| 4    | `useUpdateProfile` + `ProfilePage` | 與分類完全無關，可與 1～3 平行           |
| 5    | 路由 + 側邊欄 + 明細頁連結         | 把兩頁接進 app                           |
| 6    | 單元測試                           | 隨各步寫，不留到最後                     |
| 7    | e2e 2 條                           | 要等 5 完成才跑得起來                    |

第 4 項與第 1～3 項無相依，**可以平行派給兩個 worker**。

---

## 6. 風險與對策

| 風險                                                                   | 對策                                                                                                                                    |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **記錯帳本**：頁內選 A、記帳用 B（D1 選 C 的固有風險）                 | D8 的提示條 + 一鍵切換。這是必做項，不是加分項                                                                                          |
| 側邊欄新增「分類」「個人資料」連結後，既有 e2e 的 `getByRole` 對到兩個 | 現有連結是「首頁 / 帳本 / 帳戶」，新字串不與任何一個重疊。Step 5 完成後立刻跑完整 e2e 確認 SC-19.4                                      |
| 新增分類後，記帳表單的分類下拉沒更新                                   | mutation 的 `onSuccess` 要讓 `['categories', ledgerId]` 前綴失效。**這件事不會讓測試變紅**，所以用 e2e 釘住（跨頁面，單元測試涵蓋不到） |
| 改名後側邊欄或其他地方仍顯示舊名                                       | `useUpdateProfile` 的 `onSuccess` 讓 `CURRENT_USER_KEY` 失效                                                                            |
| 刪除分類的 409 被彈窗吞掉                                              | 沿用帳戶頁做法：失敗**不關彈窗**，錯誤由 `ConfirmDialog` 的 `error` 就地顯示                                                            |
| 同名不同型別的分類（支出「其他」與收入「其他」，預設分類就有）         | D2 的分區呈現天然解決。列表 key 用 `category.id`，不用 name                                                                             |
| worker 動到授權相關程式                                                | Task spec 明寫：D4 只決定「按鈕畫不畫」，**不得用角色決定要不要發請求或過濾資料**                                                       |

---

## 7. 驗證點

通用（每一步都適用）：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`、`pnpm build` 全綠。

**基準線（2026-09-23 實測）**：`pnpm --filter @ledger/web test` = **24 個檔案、139 條測試全綠**。
做完之後只能增加，不能有任何一條原本綠的變紅。

| SC      | 驗證點                                                   | 怎麼驗                                   |
| ------- | -------------------------------------------------------- | ---------------------------------------- |
| SC-9    | 列表顯示支出與收入兩組，數量正確                         | Vitest + 瀏覽器                          |
| SC-9    | 新增「寵物」到支出組，**不重整即出現**                   | Vitest（mock API，驗快取失效）           |
| SC-9    | 同型別重複名稱 → 顯示 409 訊息，彈窗不關                 | Vitest（mock 409 `CATEGORY_NAME_TAKEN`） |
| SC-9    | 改名後列表即時更新                                       | Vitest                                   |
| SC-9    | 刪除有交易的分類 → 顯示 409 訊息，彈窗不關               | Vitest（mock 409 `CATEGORY_IN_USE`）     |
| SC-9    | 換頁內下拉 → 分類跟著換，網址的 `ledgerId` 跟著變        | Vitest + 瀏覽器                          |
| SC-9    | 頁內帳本 ≠ 作用中帳本 → 提示條出現；按下按鈕後消失（D8） | Vitest                                   |
| SC-9    | 網址帶不存在的 `ledgerId` → 退回作用中帳本並說明（D11）  | Vitest                                   |
| SC-9    | VIEWER 看不到新增／改名／刪除，並看得到說明（D4）        | Vitest                                   |
| SC-11   | 個人資料顯示 email（唯讀）與名稱；改名後其他畫面同步     | Vitest + 瀏覽器                          |
| SC-12   | 五個指令全綠                                             | 指令輸出貼進驗收報告                     |
| SC-19.4 | **既有 e2e 不改選取器即全數通過**                        | `pnpm --filter @ledger/web test:e2e`     |
| 新增    | e2e：新增分類後，記帳表單的下拉看得到它                  | Playwright                               |
| 新增    | e2e：改名後其他畫面顯示新名字                            | Playwright                               |

⚠️ 跑 e2e 前確認**沒有別的 worktree 在跑**——兩套 e2e 共用 `ledger_test` 且每個測試前清空。

---

## 8. 派工計畫

本步不涉及授權判斷、不動 Prisma schema、不動 API 介面，**依 CLAUDE.md §11 預設派給 worker**。

| 批次 | 任務                                         | 模型               | 備註                               |
| ---- | -------------------------------------------- | ------------------ | ---------------------------------- |
| 一   | A：`use-categories.ts` 三個 mutation         | Pi + `zai/glm-5.3` | 單一檔案，驗收條件機器可驗         |
| 一   | B：`useUpdateProfile` + `ProfilePage` + 測試 | Pi + `zai/glm-5.3` | 與 A 無相依                        |
| 二   | C：`CategoryDialog` + `CategoryList` + 測試  | Pi + `zai/glm-5.3` | 等 A 完成                          |
| 三   | D：`CategoriesPage`（D7～D11）+ 測試         | Pi + `zai/glm-5.3` | 邏輯最繞的一塊，驗收要特別仔細     |
| 四   | 路由 / 側邊欄 / 明細頁連結 / e2e             | 協調者自己做       | 跨檔案的小改動，派工成本高於自己做 |

Task spec 要求 worker 遇到 provider 錯誤時**原文回報、不要自己重試**。
額度用盡就往下換：Antigravity（`agy` + `gemini-3.8-flash-high`）→ Claude Code（`opus`）。

---

## 9. Git

- 分支：`feature/web-categories-profile`（自 `main` 開）。
- 一個 PR。標題：`feat(web): add category management and profile pages`。
- CI 全綠後 squash merge。

---

## 10. 實作紀錄

### 與計畫的偏離

1. **測試檔名**：plan §3 寫 `features/categories/categories.test.tsx`，實際叫
   `use-categories.test.tsx`（它測的就是那個檔案，同名比較好找）。
2. **`LedgerCategories` 子元件**（計畫外）：`CategoriesPage` 拆成外層（選帳本）與內層
   （兩組清單與彈窗），內層掛 `key={ledger.id}`。換帳本時連彈窗狀態一起重建，
   否則「刪除確認彈窗裡還停著上一本的分類名」這種殘留要逐一歸零才擋得掉。
3. **e2e 第一次寫壞**：`getByRole('button', { name: '新增' })` 同時對到「新增支出分類」
   與「新增收入分類」——Playwright 的名稱比對預設是包含而非相等。改成把操作限定在
   `getByRole('dialog', { name: ... })` 之內，並加 `exact: true`。
4. **Step 7 的核取方塊**：spec §9 的「7. 2f」先前沒勾，這次一併補勾（2f 已於 PR #31 合併）。

### 派工結果

四個任務全部由 Pi + `zai/glm-5.3` 完成，沒有遇到 provider 錯誤，沒有動用備援層。
Run `run_8b8db33f2af6`。Task A 與 B 平行，C、D 依序重用同一個 worker 終端機。
四份產出都由協調者逐檔閱讀後才接受，沒有退回重做。

### 驗證結果（實測數字）

| 項目                             | 基準線         | 完成後         |
| -------------------------------- | -------------- | -------------- |
| `pnpm --filter @ledger/web test` | 24 檔 / 139 條 | 27 檔 / 156 條 |
| Playwright e2e                   | 15 條          | 17 條          |

`pnpm lint`、`pnpm typecheck`、`pnpm format:check`、`pnpm build` 全綠。
**既有 15 條 e2e 沒有修改任何斷言或選取器即全數通過**（SC-19.4）。

新增的 17 條單元測試分布：`use-categories.test.tsx` 4 條、`ProfilePage.test.tsx` 3 條、
`CategoriesPage.test.tsx` 9 條、`AppSidebar.test.tsx` +1 條。
