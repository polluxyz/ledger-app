# 記帳流程與內部程式審查

審查基底 `cd067a1`。依金額錯誤、重複寫入、讀取失敗、查詢成本與維護成本排序。以下操作一律使用合成資料。行號指該項修正提交，已刪除的函數使用基底行號。

## 帳務與資料正確性

| 影響與處理                                                                                                   | 重現方式與結果                                                                                                                                                                             | 程式與驗證位置                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 高。2 個視窗可把同一筆支出轉成 2 份分帳。已將原交易改為單次條件更新。                                        | 2 次轉換使用不同防重鍵與對象。原本兩次都成功。修後 301 分只拆成 151 與 150 分各一筆，另一個請求回 409。資料庫案例另驗原支出 300,000 分、1 份分帳、2 筆有效交易與餘額 −300,000 分。         | `b2e721e`，`apps/api/src/splits/splits.service.ts:49`、`apps/api/src/splits/splits.service.spec.ts:82`、`apps/api/test/splits.e2e-spec.ts:371`。                                                   |
| 高。貼上逗號可能放大記帳金額。依開發者核可的千分位規則修正 6 類輸入。                                        | Chromium 原本把 `1,23` 顯示成 123 元。修後貼 `1,23` 與 `1,,23` 都送出 0 次。貼 `1,234.56` 只寫入 123456 分。分帳自訂金額也保留錯誤文字，避免當成零。                                       | `7529fab`，`packages/shared/src/money.ts:81`、`packages/shared/src/money.test.ts:84`、`apps/web/e2e/transactions.spec.ts:176`、`apps/web/src/features/transactions/SplitOptionsView.test.tsx:58`。 |
| 高。連按儲存或重試可能建立 2 位同名付款人。已在建立付款人前鎖定送出，重試沿用已建立的付款人。                | 在畫面重新繪製前連按 2 次。另模擬已建立付款人後遺失交易回應並重試。3 個案例的付款人寫入都由 2 次降為 1 次，重試沿用原請求與防重鍵。                                                        | `5ba5336`，`apps/web/src/features/transactions/TransactionForm.tsx:1143`、同目錄 `TransactionForm.test.tsx:1024`、`:1408`、`:1456`。                                                               |
| 中。只改交易金額也會改動原交易時間。已在日期未改時保留原時間。                                               | 編輯原時間 04:00Z 的交易，只改金額。原本送出 00:00Z，修後送出原來的 04:00Z。新建交易及刻意改日期沿用現行寫入規則。                                                                         | `5ba5336`，`apps/web/src/features/transactions/TransactionForm.tsx:1167`、同目錄 `transaction-edit.test.tsx:180`。                                                                                 |
| 中。讀列表時，如有其他人刪除或移走一筆交易，整頁會失敗。已略過第二次查詢中消失的列。                         | 先選到 3 筆，再刪除或移走中間一筆。原本 2 個案例都拋出例外。修後 2 個都回傳其餘 2 筆，順序正確。總數維持第一次讀取時的 3 筆。                                                              | `a6e7776`，`apps/api/src/transactions/transactions.service.ts:563`、`:589`、同目錄 `transactions.service.spec.ts:587`。                                                                            |
| 中。海外使用者可能在選定的日期找不到交易。依本次決議保留現行日期歸屬。                                       | 在洛杉磯時區新增 10/1，寫入 00:00Z。當地顯示 9/30，10/1 篩選從 07:00Z 起。台灣統計仍列為 10/1。兩位 advisor 都建議保留寫入。若另訂台灣日顯示規格，須涵蓋手動、AI、借還與結清。             | `apps/web/src/lib/format.ts:73`、`apps/web/src/features/transactions/transaction-query.ts:46`、`docs/specs/phase-2j-stats.md:89`。用 Node 設 `TZ=America/Los_Angeles` 比對顯示與篩選。             |
| 中。AI 草稿已記帳但回應遺失，換入口重試會回 409。依開發者核可，快速與全部確認使用和表單相同的 UTC 零點字串。 | 洛杉磯時區的 4 個雙向案例原本失敗，修後都送出相同鍵、日期與本文。Chromium 在真實寫入後丟棄回應，改金額仍回 409。恢復原值重試取得原交易 ID，草稿清空。3 筆各 6,000 分，餘額只扣 18,000 分。 | `81f78f4`，`apps/web/src/features/ai/ai-session.tsx:462`、`apps/web/src/pages/TransactionsPage.ai.test.tsx:266`、`apps/web/e2e/ai-icon-entry.spec.ts:39`。                                         |

## 查詢成本

數字是資料庫用戶端的呼叫次數。測量使用同一組輸入與查詢替身。

| 使用流程                            | 前後數字與驗證                                                                                                                                                                        | 位置                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 重播已完成的分帳、處理 1 位往來對象 | 分帳查詢 3 → 2 次，對象鎖定 2 → 1 次。保留帳本權限及刪除狀態檢查。                                                                                                                    | `b2e721e`，`apps/api/src/splits/splits.service.ts:111`、`:182`、同目錄 `splits.service.spec.ts:127`、`:136`。               |
| 一般與標註交易的空首頁              | 兩種列表的選列及計數各從 2 → 1 次。空的第 99 頁仍查 2 次，總數正確回 7。                                                                                                              | `cf4f3c8`，`apps/api/src/transactions/transactions.service.ts:335`、`:569`。單元測試用 `-t 'recount\|beyond the last'`。    |
| 帳戶餘額趨勢                        | 1 個帳戶、無交易，讀 1／12／24 個月分別呼叫 3／25／49 次。重現方式為呼叫 `balanceTrend(userId, endMonth, months)`，計數帳戶查詢及交易分組查詢。尚無真實延遲數據。保留目前的逐月計算。 | `apps/api/src/accounts/accounts.service.ts:84`、`:162`、`:168`；同目錄 `accounts.service.spec.ts:321` 有 2 個月的既有測試。 |

## 已確認無執行入口與保留項目

- 已交叉核對畫面、路由、動態載入、排程、命令、測試及舊資料用途。`7b0856f` 移除 5 個無生產入口的 Web 函數。基底位置為 `apps/web/src/features/ledgers/use-members.ts:18`、`use-ledgers.ts:124` 與 `:168`、`apps/web/src/features/ledger-people/use-ledger-pointers.ts:71`、`apps/web/src/features/settlements/settle-intent.ts:31`。可用 `git show 7b0856f` 逐項核對名稱與原本只測舊包裝的測試。
- 現有入口仍可用。帳本詳情讀取成員（`LedgerDetailPage.tsx:38`），離開帳本先預覽（`DeleteLedgerDialog.tsx:64`），解除指向經 `PointerDialog.tsx:45`，結清經 `SettlementView.tsx:154`。舊瀏覽紀錄仍在 `settle-intent.ts:18` 讀取。後端刪帳本相容路由仍有路由註冊及測試，見 `apps/api/src/ledgers/ledgers.controller.ts:152`、`:164` 與 `apps/api/test/ledger-delete-move.e2e-spec.ts:319`。缺少外部使用率資料，保留相容端點及已匯出的型別。未下架使用者功能。
- `a8fb650` 移除 API 對 `@eslint/eslintrc` 與 `source-map-support` 的 2 個多餘直接宣告。基底位置為 `apps/api/package.json:44`、`:63`。已查套件本身的執行入口及鎖檔。ESLint 和 Jest 仍能載入各自需要的間接相依。Nest CLI 會動態查找 `ts-loader`，因此保留。鎖檔安裝、lint、預設 build 及 API 單元測試通過。
- 除錯指令原本用 Node 執行 pnpm 的 shell 啟動檔，在 Windows 出現語法錯誤。改為使用 Jest 隨套件提供的 JavaScript 入口。在 API 目錄使用相同載入參數，列表的 2 個回歸測試通過。位置為 `apps/api/package.json:20` 的 `test:debug`。
- 尚無銀行明細、發票或 CSV 交易匯入入口。已查 Web 路由、後端模組、排程及套件指令。規劃見 `docs/handoff/ai-4a.md:8`。重複寫入的驗證涵蓋現有記帳入口。

## 其他驗證與範圍

金額解析以 1,000 筆正負金額驗證格式化後還原。分帳以 112 組比例及精度對照整數計算。兩組均通過。帳戶餘額重算的既有測試涵蓋軟刪除、收入、支出與轉帳方向，見 `apps/api/src/accounts/accounts.service.spec.ts:201`、`:232`、`:348`。同鍵防重驗證在 `apps/api/src/idempotency/idempotency.service.spec.ts:49`、`:69`。瀏覽器貼上使用 Chromium。此次沒有量測 Firefox、Safari、真實模型或正式資料。

各工作區的驗證分開計算。API 修正測過 1,221 項 API 單元測試。Web 與金額修正測過 1,313 項 Web、161 項 shared 與 1,213 項當時的 API 單元測試。兩份結果含重疊案例。文件前後計量與重跑方式見[Session 文件讀取量](2026-11-18-session-input.md)。

## 主工作區驗收

主工作區以 `80d91b2` 整合上述改動。凍結鎖檔離線安裝、共用套件建置、格式、lint、型別檢查與正式版建置通過。共 2,695 項單元測試通過，分別是 API 1,221、Web 1,313、shared 161。

專用測試資料庫的 API 端對端測試通過 68 組、766 項。包含同一筆支出同時轉分帳、編輯後餘額 −150 分及刪除後餘額 −500 → 0 分。案例在 `apps/api/test/splits.e2e-spec.ts:371`、`apps/api/test/transactions.e2e-spec.ts:340` 與 `:240`。Web 工作區以 Chromium 跑完 144 項，包含剪貼簿金額與記帳後餘額。複驗指令為 `pnpm --filter @ledger/api test:e2e` 與 `pnpm --filter @ledger/web test:e2e`。需先依[測試環境](../operations/test-environment.md)準備專用資料庫。

實作及檢查紀錄見[分帳扣款 #234](https://github.com/polluxyz/ledger-app/pull/234)、[表單重試 #235](https://github.com/polluxyz/ledger-app/pull/235)、[金額輸入 #236](https://github.com/polluxyz/ledger-app/pull/236)、[列表讀取 #237](https://github.com/polluxyz/ledger-app/pull/237)、[內部程式與相依清理 #238](https://github.com/polluxyz/ledger-app/pull/238)及[AI 草稿跨入口重試 #239](https://github.com/polluxyz/ledger-app/pull/239)。

另以 `81f78f4` 跑過 AI 草稿相關的 78 項測試及 Chromium 的 2 項 SC-IK14 情境。後者以專用 PostgreSQL 執行，使用合成模型結果。
