# 3l 實作計畫：刪除私人帳本時搬走交易、複製交易、標註交易

spec：`docs/specs/phase-3l-move-and-copy.md`（決策 209～226、W194～W200、SC-N1～SC-N14）。後端、畫面、e2e 合成一個 PR。

> 核可：開發者 2026-10-21 核可。

## 0. 起點

- 整合分支：`feature/ledger-delete-move`，從 docs PR 合併後的 `main` 開。只有總控寫整合分支。
- 分工照 3k 的三個 session：總控（契約、隔離測試、整合、驗收、部署）、後端 session（L1～L3，子分支 `feature/ldm-api`）、前端 session（L4～L6，子分支 `feature/ldm-web`）。兩個 session 各自用 worker 實作，驗收後 merge 進自己的子分支，里程碑傳回總控。
- 角色：migration、搬移計畫、授權派 `backend`；畫面與 e2e 派 `default`。模型看 `docs/orca-multi-agent.md` §0。
- 1 個 migration（spec §3：只建 `TransactionMark` 表）。部署前備份 `ledger_dev`。
- 不改餘額公式（`accounts.service.ts` 的 `directionOf`）。不改 3k 共享帳本的退出規則（spec §10 第 7 項）。

## 1. 元件與相依

### 1.1 總控自己做（L0：契約與隔離測試）

- `packages/shared`：
  - `types/ledger-leave.ts`：新型別 `LeaveMove`；`LeaveRequest` 加 `moves?`。`targetLedgerId`、`excludedItemIds` 改成可省略：spec §4.1 規定私人帳本不能帶這兩個欄位，型別必須允許不帶。共享帳本仍然必帶，由 DTO 檢查。檔頭註解補「私人帳本刪除也用這組型別，搬移不是合併」。
  - `LedgerLeaveItemKind` 的 `SHARED` 註解改成「一般交易」：私人帳本的一般收支與互轉也用這個值。spec §4.1 規定預覽回應形狀不變，所以不加新值。
  - 交易型別：`Transaction.marked`、`MarkedTransaction`、`ListMarkedTransactionsQuery`（spec §4.2）。
- API 端 `marked` 先一律回 `false`，L3 填值（比照 3k K0 的 `merge: null`）。
- `apps/api/test/ledger-delete-move-isolation.e2e-spec.ts`：SC-N7、SC-N12，先看到紅燈。

### 1.2 後端 A：migration（L1，`backend`）

- `schema.prisma`：`TransactionMark`（spec §3），`User`、`Transaction` 補反向關聯。
- migration 只建表。在自己的 `_test` 資料庫套用；用 SQL 驗證 2 件事：同一人同一筆重複插入被主鍵擋；刪交易時標註跟著刪。
- 只改 schema 與 migration，不改 service。

### 1.3 後端 B：刪除私人帳本時搬走（L2，`backend`）

只依賴 L0，跟 L1 平行。

- 新檔 `ledgers/ledger-delete-move-plan.ts`（純函式）：輸入私人帳本的項目、`moves`、各目標帳本的分類，輸出：
  - 每組的分類對應（決策 213：同類型同名用既有的，沒有就新建）；
  - 每組要改 `ledgerId` 的交易與個人分帳；
  - 沒搬的項目（照 3j 決策 186 撤銷）；
  - `retainedTransactionIds`（算 `balanceAfter` 用）與 `withdrawals`；
  - §4.1 的 5 種 `moves` 錯誤。
- 項目分組（決策 211）：從 `LedgerLeaveService.loadPlan` 把「個人借還＋結清分支」「個人分帳」的分組抽成共用函式，3k 與 3l 共用，避免兩套分組不一致。私人帳本另外要分的：
  - 一般收支、帳戶互轉：一筆一項，`kind: 'SHARED'`。
  - 合併來的「我付、有分帳」：同一個 `mergedFromId` 的兩筆合成一項，id 用份額那一筆（同 3k K4 交易列表的合成規則）。
- `ledger-leave.service.ts`：`preview`、`leave` 依 `ledger.kind` 分流。私人帳本走新函式，共享帳本照舊。私人帳本：
  - 檢查：擁有者；`deleteLedger: true`；必須帶 `moves`；不能帶 `targetLedgerId`、`excludedItemIds`；封存 → 預覽 `blockedBy: 'LEDGER_ARCHIVED'`、執行 409。
  - 每本目標帳本照 3k 的規則檢查（編輯者以上、沒封存、不是來源）。執行時依 id 排序逐一鎖目標帳本與自己的成員列，避免兩個請求互相等待。
  - 執行順序（spec §4.1）：分類對應 → 各組改 `ledgerId`（交易、`Split`）→ 沒搬的撤銷（`removeInTransaction`）→ `deleteLedgerRows`。不建 `LedgerMerge`，搬過去的交易 `mergeId` 不動。
  - 預覽的 `balanceAfter` 沿用 3k 的算法（目前 − 這本帳本的影響 ＋ 搬走的項目的影響）。`carryOvers` 恆為空陣列。
- DTO `leave-ledger.dto.ts`：`moves` 的形狀驗證（陣列、`targetLedgerId` 是 uuid、`itemIds` 非空）。跟帳本種類有關的規則在 service 檢查，因為 DTO 不知道帳本種類。
- 單元：計畫函式的分組（SC-N6）、分類對應（SC-N5）、`moves` 的檢查（SC-N14）、中途一步失敗整筆回滾。
- API e2e：SC-N1～N4、SC-N14；隔離測試 SC-N7 轉綠。SC-N4 在同一份資料上分別走 `moves: []` 與舊的 `DELETE ?withdrawDebts=true`，比對帳戶與往來結果。

### 1.4 後端 C：標註（L3，`backend`）

依賴 L1；SC-N13 要 L2 的搬移，所以等 L1、L2 都合併進 `feature/ldm-api` 後再派。

- 新模組 `marks/`（或放在 `transactions/`，由 worker 照既有結構決定，驗收時看）：
  - `PUT`／`DELETE /ledgers/{ledgerId}/transactions/{transactionId}/mark` → 204，可重複呼叫。成員（檢視者以上、封存也可以）；交易不在這本或已刪除 → 404。
  - `GET /transactions/marked?page=&limit=`：只算我現在是成員的帳本、沒刪除的交易、我自己的標註；依日期、建立時間由新到舊；`limit` 預設 10、最多 100。
- `marked` 填值：`TransactionsService.toTransaction` 統一帶。查詢時用關聯篩選只取呼叫者自己的標註，不另外逐筆查。結清、借還等其他回傳 `Transaction` 的端點也經過 `toTransaction`，驗收時逐一確認。
- 合併來的「我付、有分帳」在列表合成一列（3k K4），id 是份額那一筆。標註標在這個 id 上；`GET /transactions/marked` 也照同一套合成規則回傳，金額是合計。
- 單元與 API e2e：SC-N10～N13；隔離測試 SC-N12 轉綠。

### 1.5 畫面 A：刪除對話框（L4，`default`）

只依賴 L0 的契約，可以跟後端平行（元件測試用 `vi.mock` 替換 API）。

| 區塊                             | 決策 | 主要檔案                                                                          |
| -------------------------------- | ---- | --------------------------------------------------------------------------------- |
| 按鈕合成一顆                     | W194 | `pages/LedgerDetailPage.tsx`                                                      |
| 私人帳本刪除對話框               | W194 | `features/ledgers/DeleteLedgerDialog.tsx`（改寫私人帳本的分支）、`use-ledgers.ts` |
| 選交易、選帳本、搬移段的修改與 × | W195 | 沿用 `LeaveItemPicker.tsx` 的列樣式；新元件放 `features/ledgers/`                 |
| 刪除後數字加粗上色（3k 一起改）  | W194 | `LeaveItemPicker.tsx` 的 `LeavePreviewSections`                                   |

- 數字一律來自 `leave-preview`。每次新增、修改、取消一組，就帶新的 `moves` 重新取預覽；query key 含 `moves`，只採用最新一次的結果。
- 顏色只比較 `balance` 與 `balanceAfter`，3k 的帳本轉入列不上色。
- 選帳本畫面：其他組已選的帳本灰掉、標「已選」；修改時這組自己的帳本可選。
- 共享帳本按「刪除帳本」照舊打開 3k 的對話框。
- 元件測試涵蓋 W194、W195 與上色。

### 1.6 畫面 B：⋯ 選單、複製、標註（L5，`default`）

只依賴 L0，跟 L4 平行。

| 區塊                   | 決策                | 主要檔案                                                  |
| ---------------------- | ------------------- | --------------------------------------------------------- |
| 每列的「⋯」選單        | W196、W198          | `features/transactions/TransactionList.tsx`               |
| 複製：帶入欄位、帳本欄 | 決策 218～221、W197 | `TransactionDialog.tsx`、`TransactionForm.tsx`            |
| 色條                   | W199                | `TransactionList.tsx`、`pages/HomePage.tsx` 的最近交易    |
| 首頁「標註」卡         | W200                | `pages/HomePage.tsx`、新的 `use-marked-transactions` hook |

- 複製換帳本時，從新帳本的分類清單找同類型、同名的分類帶入，找不到就空著。這是表單預填，存檔前使用者看得到、改得了，不算業務邏輯。
- 不能複製的（借還、結清、合併來的「我付、有分帳」）選單沒有「複製」（SC-N9）。
- 標註與取消後，讓交易列表與首頁標註卡的 query 失效重抓。
- 元件測試涵蓋 W196～W200、SC-N8、SC-N9。

### 1.7 e2e（L6，`default`）

依賴 L2～L5。

- Web e2e `ledger-delete-move.spec.ts`：SC-N2 分兩組搬（含「×」與「修改」）、SC-N8 複製一筆、標註後首頁出現再取消。
- 既有 Web e2e 用到「封存帳本」按鈕或 3j 刪除對話框的，照 W194 改；意圖不變的只改找元素的方式。

## 2. 實作順序

1. L0（總控）→ push 契約 commit，通知兩個 session。
2. 第 1 波平行：L1、L2（後端 session）；L4、L5（前端 session）。
3. L1、L2 合併進 `feature/ldm-api` 後派 L3。
4. 總控把 `feature/ldm-api`、`feature/ldm-web` 合進整合分支，通知前端開 L6。
5. 總控整體驗收、spec §9 的文件影響、PR、部署（L7）。

## 3. 風險與對策

| 風險                                           | 對策                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 綁在一起的項目只搬了一半                       | 分組抽成 3k、3l 共用的函式；SC-N6 單元測試逐種涵蓋；e2e 斷言搬完後來源帳本沒有殘留                     |
| 搬過去的交易或分帳還指著被刪帳本的分類         | 分類對應在改 `ledgerId` 前完成；e2e 斷言每筆交易與 `Split` 的分類都屬於自己所在的帳本（spec §7 Never） |
| 預覽數字跟執行結果不一樣                       | 預覽與執行共用計畫函式；SC-N3 比對預覽的 `balanceAfter` 與執行後 `GET /accounts`                       |
| 寫到一半失敗，帳本刪了一半、搬了一半           | 全部在一個 Serializable 資料庫交易；單元測試讓中途一步失敗，斷言帳本還在、交易沒動                     |
| 同時鎖好幾本目標帳本，兩個請求互相等待         | 依帳本 id 排序後逐一鎖                                                                                 |
| 搬到沒有寫入權或已封存的帳本                   | 目標檢查放進同一個資料庫交易並鎖；SC-N7 涵蓋 403、409                                                  |
| `moves: []` 跟 3j 舊刪除結果不同               | SC-N4 在同一份資料上兩條路各跑一次比對                                                                 |
| 每個交易回應都帶 `marked`，列表變慢            | 用關聯篩選一次查回；驗收時量交易列表 API，維持 < 500ms                                                 |
| 合併來的合成列，標註列表的金額跟交易列表不一樣 | `GET /transactions/marked` 沿用交易列表的合成規則；SC-N11 涵蓋                                         |
| 改 `LeavePreviewSections` 弄壞 3k 退出對話框   | 3k 的元件測試與 `ledger-leave-merge.spec.ts` 一起跑                                                    |
| 合成按鈕讓既有 e2e 找不到「封存帳本」          | L6 照 W194 改既有 e2e；總控驗收時跑兩套 e2e                                                            |

## 4. 驗證點

- 每個 worker：`pnpm lint / typecheck / test / format:check`；後端再跑自己資料庫的相關 API e2e。
- 總控：
  - 逐行看 migration SQL、`ledger-delete-move-plan.ts`、`ledger-leave.service.ts`、標註端點的授權部分的 diff。
  - 自己重跑隔離測試（紅轉綠）、兩套 e2e；`pnpm build`。
- 部署後：dev 上用 a@a.com 建一本暫時的私人帳本，記 spec §1「旅行基金」的 3 筆，分兩組搬到兩本既有帳本後刪除。比對帳戶餘額與借還頁，並複製、標註一筆。做完把暫時建的資料刪掉。

## 5. 派工

| 波次 | worker        | 角色      | 範圍 | 驗收                                                         |
| ---- | ------------- | --------- | ---- | ------------------------------------------------------------ |
| 0    | 總控          | —         | §1.1 | 隔離測試紅燈；shared build 後 typecheck 通過                 |
| 1    | `ldm-migrate` | `backend` | §1.2 | migration 在自己的資料庫套用成功；主鍵與 cascade 用 SQL 驗證 |
| 1    | `ldm-move`    | `backend` | §1.3 | SC-N1～N7、N14；隔離測試 SC-N7 轉綠                          |
| 1    | `ldm-web-del` | `default` | §1.5 | W194、W195、上色的元件測試；Web 檢查全綠                     |
| 1    | `ldm-web-row` | `default` | §1.6 | W196～W200、SC-N8、N9 的元件測試；Web 檢查全綠               |
| 2    | `ldm-mark`    | `backend` | §1.4 | SC-N10～N13；隔離測試 SC-N12 轉綠                            |
| 3    | `ldm-web-e2e` | `default` | §1.7 | 兩套 Web e2e 全綠                                            |

- 每個 worker 一個 `ledger_ldm_<名>_test` 資料庫，`.env` 與 `.env.test` 都指向它（`docs/orca-multi-agent.md` §5）。
- worker 不改 `packages/shared`（要改先問總控）。
- L4 與 L5 都改 `apps/web`，但檔案分開（L4 在 `features/ledgers` 與 `LedgerDetailPage`，L5 在 `features/transactions` 與 `HomePage`）。有衝突由前端 session 處理。

## 6. 實作紀錄

### L0（總控，2026-10-21）

- shared：`LeaveMove`、`LeaveRequest.moves`；`targetLedgerId`、`excludedItemIds` 改成可省略（spec §4.1 私人帳本不能帶）。共享帳本仍由 DTO 要求，service 內以 `?? null`、`?? []` 收斂。`LedgerLeaveItemKind` 的 `SHARED` 註解改成「一般交易」。`Transaction.marked`、`MarkedTransaction`、`ListMarkedTransactionsQuery`。
- API 端 `marked` 先一律回 `false`（`toTransaction`、結清的 Swagger DTO）；Web `useLeavePreview` 的參數改成 3k 兩個欄位必帶；測試 fixture 補 `marked: false`。
- 隔離測試 `ledger-delete-move-isolation.e2e-spec.ts` 9 條全紅：SC-N7 的 5 條是私人帳本預覽被 DTO 擋成 400；SC-N12 的 4 條是路由不存在、`TransactionMark` 表不存在。404 類的斷言都配了正向對照，實作前不會假綠。表還沒有 Prisma model，測試用 raw SQL 數標註，L1 之後可以換成 model。
- 驗證：shared 116、API 582、Web 102 檔全綠；API e2e 44 檔 391 條，只有新的 9 條紅；lint、typecheck、format 通過。整合分支的 worktree 用 `ledger_ldm_int_test`。
