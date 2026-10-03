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

1. **派工**：Run `run_e2035b727bd0`；後端 `backend`（`ctx_300ce382d2ba`，commit `8710ba2`），前端 `default`（`ctx_bedd06f4a673`，commit `48cb93a`）。前端的任務第一次只貼進輸入框沒有送出，補一次 Enter 後開始。
2. **後端**：`Category.icon`、migration 依名稱回填（只補 `icon IS NULL` 的列）、修改分類只更新送出的欄位（兩個都沒送回 400）。API 單元測試 328、e2e 172。
3. **前端**：`lucide-react` 1.x；`CategoryIcon` 是唯一的代號對照表。記帳表單的分類改成自訂的圖示選單（原生 `<select>` 放不了圖示），待確認卡片的分類仍是原生下拉。bundle 433→449 kB（gzip 131→138 kB）。Web 單元測試 614。
4. **合併後 Web e2e 5 個失敗，都是測試沒跟上**：分類選單改成自訂選單後要先打開才看得到選項（2 個）；CSP 測試檢查列上的備註，但列已不顯示備註；SC-T2 的分帳測試資料名單只有我（後端回 `SPLIT_NOT_NEEDED`）；SC-W80 把待確認卡片的分類當成新選單操作。協調者修正。
5. **截圖後協調者修正**：「分帳」膠囊被推到金額旁邊，改成緊跟名稱；漏斗原本自己佔列表卡片一整列，改放在「明細／借還」那一列右邊（`TransactionFilters` 拆成 `TransactionFilterToggle` 與 `TransactionFilterPanel`，原本的 `TransactionFilterBar` 保留為兩者的組合）；拆開後面板補上內距。
6. **驗證**：單元測試 shared 80、API 328、Web 614；API e2e 172、Web e2e 51；1440 與 375 寬截圖確認沒有橫向捲動、長英文名稱截斷、日期分組間距。
7. **修訂 1**（2026-10-04，開發者回饋，spec §9 T13）：一行的列讓同一個位置有時是名稱、有時是分類，看起來亂。改成固定兩行：第一行分類（借還、轉帳用標籤），第二行名稱（沒有就空著），分帳膠囊在名稱後面。列高 56px 時 SC-24.3（1440×900 首屏 10 筆）只放得下 9 筆，改成 52px。協調者自己改，補 `TransactionList.test.tsx` 一個案例。Web 單元測試 615、Web e2e 51 全綠。
8. **修訂 2**（2026-10-04，開發者回饋，spec §10 T14）：圖示改成樣板的淡金圓底加金色線條，交易列與分類頁一起改。只動 CSS 與一層包圖示的 `span`。協調者自己改。
