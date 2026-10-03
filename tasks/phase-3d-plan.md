# 3d 實作計畫：交易頁版面整理與分類圖示

spec：`docs/specs/phase-3d-tx-list.md`（T1～T12、SC-T1～SC-T9）。一個 PR。

## 1. 元件與相依

**協調者（契約）**

- `packages/shared`：`constants/category-icons.ts`（`CATEGORY_ICONS` 代號清單與型別 `CategoryIcon`）、`types/category.ts`（`icon`）、`types/transaction.ts`（`category` 帶 `icon`）、`constants/default-categories.ts`（每筆加 `icon`）。

**後端 worker（`backend` 角色）**

- schema：`Category.icon String?`；migration 加欄位＋依名稱回填預設分類（T4）。
- `categories/`：DTO 的 `icon` 驗證（`@IsIn(CATEGORY_ICONS)`、可為 null）、建立與修改、回應。
- 建立帳本時的預設分類寫入 `icon`。
- `transactions/`：`TRANSACTION_INCLUDE` 的 category 多選 `icon`，回應帶出。
- e2e：SC-T7 的後端部分、回填驗證。

**前端 worker（`default` 角色）**

- 新增相依 `lucide-react`（開發者已在決策 3 同意）。
- `components/CategoryIcon.tsx`：代號 → lucide 圖示的唯一對照表；T5 的固定圖示也放這裡；null 用通用圖示。
- `TransactionList.tsx`／`.module.css`：T1、T7、T8、T9、T11；`HomePage.tsx` 的最近交易（T10）。
- `TransactionFilters.tsx`、`TransactionsPage.tsx`：T6。
- 編輯面板（`TransactionDialog`／`TransactionForm` 的編輯模式）：加「刪除」（T7），沿用既有的刪除確認與 mutation。
- `CategoryDialog.tsx`、`CategoriesPage.tsx`：T12；分類選單（記帳表單）顯示圖示。
- 測試與 e2e：SC-T1～T8 的前端部分。

## 2. 實作順序

1. 協調者：shared 契約，commit 後開兩個 worktree。
2. 後端與前端 worker **平行**。前端先用 shared 型別與 mock 開發，後端合併後協調者跑 e2e。
3. 協調者：合併、全套檢查、兩套 e2e、截圖驗收（中文與長英文假資料）、PR、部署 dev。

## 3. 風險與對策

| 風險                                      | 對策                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `lucide-react` 讓 bundle 變大             | 只用具名 import（tree-shaking），不做「依字串動態載入全部圖示」；build 後比對 bundle 大小，記進實作紀錄 |
| 刪除移到面板後，e2e 找不到垃圾桶          | 前端 worker 一併改既有 e2e；協調者跑兩套 e2e 驗收                                                       |
| 列只剩一行，看不到備註與帳戶              | 開發者決策 1 的備註要求；編輯面板仍完整顯示                                                             |
| 改了 shared，開發者瀏覽器又用舊的預先打包 | 部署時刪 `.vite`；提醒開發者勾「Disable cache」重新整理（`apps/web/CLAUDE.md` 已記）                    |
| worker 對 `ledger_dev` 跑 migration       | Task spec 寫明 Prisma 指令只能對 `.env.test`（`apps/api/CLAUDE.md`）                                    |

## 4. 驗證點

- worker：各自的 lint、typecheck、test；後端 worker 跑 API e2e。
- 協調者：`pnpm lint / typecheck / test / build / format:check`；兩套 e2e 依序跑；截圖驗 SC-T2～T4（1440 與 375 寬，中文與長英文）。

## 5. 派工

- 後端：`backend` 角色，worktree `tx-icon-api`。
- 前端：`default` 角色，worktree `tx-list-web`。額度用完照角色表換 `fallback-1`。

## 6. 實作紀錄

（實作時填寫）
