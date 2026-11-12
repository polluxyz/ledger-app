# 專案審查報告（2026-11-11）

審查基準是 `main` 的 `81b48a9`。審查期間沒有修改任何程式，結束時 `git status` 是乾淨的。

這是一次性報告，寫完不動。後續處理的進度記在各自的 spec、plan 或 PR，不回寫本檔。

分類用語：

- **缺陷**：已確認的缺陷。
- **改善**：有證據支持的改善。
- **假設**：需要驗證的假設，還沒有實際重現。

---

## 1. 整體判斷

核心記帳規則與資料隔離做得紮實，自用沒有大問題。開放給別人用之前，主要缺口在「重複送出」「正式環境的防護設定」「部署與備份」三處。

### 優點（已讀程式確認）

- 授權預設拒絕。全域 JWT（登入憑證）檢查加上帳本角色檢查，非成員一律拿到 404。
- 金額全程用整數（分）。餘額由交易即時算出，不存欄位。
- AI 只回草稿。網頁端只有使用者按確認才寫入，走一般的新增交易 API（`apps/web/src/features/ai/ai-session.tsx`）。
- 隔離測試覆蓋廣。`apps/api/test` 有 20 個以上的 `*-isolation` 檔案。
- CI 會跑兩套 e2e，`main` 最近一次 CI 是綠燈。

### 最該先處理的 5 件事

1. 新增交易沒有防重複機制。網路失敗後重試會記成 2 筆。
2. 正式環境的防護設定不足：API 文件頁永遠公開、`JWT_SECRET` 只要求 1 個字、沒有登出失效機制。
3. 部署、備份、還原全靠人工步驟，repo 內找不到還原程序。
4. `docs/handoff/main.md` 把測試帳號與共用密碼提交進版控。
5. 幾處「先檢查再寫入」不在同一個資料庫交易內，並行操作時檢查可能失效。

---

## 2. 審查覆蓋範圍

### 已檢查

- 規範與文件：根目錄與兩份分層 `CLAUDE.md`、`docs/README.md`、`docs/handoff.md`、`docs/handoff/main.md`、根 `README.md`、`.env.example`、CI 設定。
- 後端：`main.ts`、認證與 guard、`schema.prisma`、交易、帳戶、帳本與成員、分帳、借還、結清、往來提案、AI 服務與額度、例外處理。
- 前端：API 呼叫層、token 存放、登入狀態、路由、AI 草稿流程、日期工具、快取失效清單、`vite.config.ts`。
- `packages/shared` 的匯出清單。

### 部分檢查（只掃過結構或關鍵字）

- `ledger-leave.service.ts`、`categories.service.ts`、`statistics.service.ts`、好友相關服務。
- 前端各頁面的實際畫面、空狀態、手機版面。只讀程式，沒有開瀏覽器操作。
- e2e 測試內容。只統計檔案與 403/404 斷言數量，沒有逐檔讀。

### 沒有檢查

- `專案決策脈絡.md`、`docs/orca-multi-agent.md`、多數 spec 的內文。
- `docs/artifacts/`（專案規定不掃描）。
- 正式環境與 `ledger_dev` 資料庫，完全沒有連線。

### 執行過的指令與結果

| 指令                  | 結果                                        |
| --------------------- | ------------------------------------------- |
| `pnpm format:check`   | 通過                                        |
| `pnpm lint`           | 失敗：`apps/web` 17 個錯誤，集中在 2 個檔案 |
| `pnpm typecheck`      | 失敗：`apps/web` 4 個錯誤，同樣 2 個檔案    |
| `pnpm test`（api）    | 68 個 suite、1039 個測試全過                |
| `pnpm test`（shared） | 160 個測試全過                              |
| `pnpm test`（web）    | 1286 個測試中 6 個失敗，全部是 5000ms 逾時  |

沒有執行：兩套 e2e（會清空共用的 `ledger_test`）、`pnpm build`、效能測試、`pnpm install`、任何 `prisma` 指令。

### lint 與 typecheck 失敗的原因

失敗的檔案是 `apps/web/src/features/home/dnd-adapter.tsx` 與 `resizable-panels-adapter.tsx`。

型別解析的追蹤結果：拖曳套件裡的 `react` 被解析到沒有型別的 `react/index.js`。主工作區的 `node_modules/.pnpm/node_modules/@types` 底下有 `react-dom`，沒有 `react`。

同一個 commit 在 CI 是綠燈。判斷是主工作區的安裝狀態問題，不是程式缺陷。重跑 `pnpm install` 可能會修好，審查時沒有執行，這個修法未驗證。

### 網頁測試的 6 個逾時

6 個失敗分布在 5 個檔案，耗時都在 5.0～5.7 秒，剛好超過預設上限，沒有斷言錯誤。判斷是整套平行跑時機器負載造成的，沒有單獨重跑驗證。

失敗的測試檔：

- `src/features/transactions/transaction-filters.test.tsx`
- `src/features/transactions/use-transactions.test.tsx`
- `src/features/transactions/transaction-edit.test.tsx`
- `src/pages/TransactionsPage.ai.test.tsx`（2 個）
- `src/features/linking/PendingCard.test.tsx`

---

## 3. 問題與改善清單

每項有編號，派工時引用編號。

### 高優先

**R1　新增沒有防重複（缺陷，未實際重現）**

- 證據：全專案搜尋 idempotency（防重複鍵）只出現在 2 個測試檔。`apps/web/src/features/ai/ai-session.tsx` 寫入失敗後保留草稿，可以重試。
- 影響：伺服器已寫入但回應遺失時，重試會多記 1 筆，餘額與欠款跟著錯。
- 修法：新增類請求帶一次性鍵，後端用唯一索引擋下。
- 工作量中；修改風險中（要改 schema 與 API）；信心高。

**R2　Swagger（API 文件頁）永遠開啟（缺陷）**

- 證據：`apps/api/src/main.ts:47-56` 沒有環境判斷。
- 影響：正式環境對外公開完整 API 結構。
- 修法：只在非正式環境掛載。
- 工作量小；修改風險低；信心高。

**R3　`JWT_SECRET` 強度沒把關（缺陷）**

- 證據：`apps/api/src/config/env.validation.ts:9` 只要求 `min(1)`。
- 影響：設成弱密鑰時，別人可以偽造登入憑證。
- 修法：要求至少 32 字元。
- 工作量小；修改風險低（啟動會擋掉弱設定，部署前要先確認現有密鑰夠長）；信心高。

**R4　測試帳密提交進版控（缺陷）**

- 證據：`docs/handoff/main.md` 列出測試帳號與共用密碼。
- 影響：目前只是測試資料。若 dev 環境對外可達，任何讀得到 repo 的人都能登入。
- 修法：移出版控，改放本機檔案，並更換那組密碼。git 歷史裡仍查得到舊密碼，所以一定要換。
- 工作量小；修改風險低；信心高。

**R5　沒有備份與還原程序（改善）**

- 證據：repo 內沒有部署腳本或排程備份。`docs/handoff/main.md` 只寫人工 `pg_dump`。
- 影響：資料損毀時沒有可照做的還原步驟。
- 修法：寫排程備份與還原演練文件。
- 工作量中；修改風險低；信心高。

### 中優先

**R6　登出不會讓憑證失效（改善）**

- 證據：`JWT_EXPIRES_IN` 預設 `7d`（`env.validation.ts:10`）。`apps/web/src/features/auth/AuthProvider.tsx` 登出只清本機。
- 影響：憑證外洩後 7 天內都有效，改密碼也擋不住。
- 修法：縮短效期，或在使用者資料加憑證版本欄位。
- 工作量中；修改風險中；信心高。

**R7　檢查與寫入不在同一交易（假設）**

- 證據：`apps/api/src/transactions/transactions.service.ts:610-616, 695-701, 1328-1334` 的 `assertAccountRules` 沒傳 `tx`。`apps/api/src/accounts/accounts.service.ts:245-263` 先數再刪。
- 影響：並行操作時可能寫入違反帳戶規則的交易，或刪掉仍被引用的帳戶。
- 修法：檢查移進交易並先鎖定該列。
- 工作量中；修改風險中；信心中（未實際重現）。

**R8　最後一位擁有者檢查有競態（假設）**

- 證據：`apps/api/src/ledgers/ledgers.service.ts:545-569, 640-651` 先數擁有者再改。
- 影響：2 位擁有者同時互相降級，帳本可能沒有擁有者。
- 修法：交易內先鎖帳本列。
- 工作量小；修改風險低；信心中。

**R9　401 後畫面狀態沒同步（假設）**

- 證據：`apps/web/src/lib/api-client.ts:81-82` 只清 token，`AuthProvider` 的狀態沒更新。
- 影響：憑證過期後畫面仍顯示已登入，每個請求都失敗，重新整理才恢復。
- 修法：401 時通知 `AuthProvider` 登出。
- 工作量小；修改風險低；信心中（未在瀏覽器驗證）。

**R10　流量限制在代理後面可能失準（假設）**

- 證據：`apps/api/src` 內沒有 `trust proxy` 設定。限流存在記憶體（`app.module.ts:36-37`）。
- 影響：放在反向代理後面時，所有人共用同一個 IP 額度。
- 修法：依部署方式設定 `trust proxy`。
- 工作量小；修改風險低；信心中（取決於部署架構）。

**R11　缺少標準安全標頭與優雅關機（改善）**

- 證據：`apps/api/src/main.ts` 沒有 helmet（設定安全標頭的套件）與 `enableShutdownHooks`。
- 影響：重啟時進行中的請求被切斷。API 回應缺少防護標頭。
- 修法：加上兩項設定。
- 工作量小；修改風險低；信心高。helmet 是新增相依，要先同意。

**R12　日期假設瀏覽器在台北時區（假設）**

- 證據：`TransactionForm.tsx:1155`、`DebtEntryForm.tsx:252`、`DebtEntryEditDialog.tsx:139`、`SettlementForm.tsx:131` 用 `new Date(date).toISOString()`。
- 影響：在負時差時區的瀏覽器，顯示日期可能差 1 天。
- 修法：日期改送純字串，由後端解讀。
- 工作量中；修改風險中；信心中（未實測）。

### 低優先

**R13　路徑參數沒驗證格式（假設）**

- 證據：全專案沒有 `ParseUUIDPipe`。
- 影響：亂填 id 可能變成 500 而不是 400/404。
- 修法：先實際打 API 確認回應，再決定要不要加 UUID 檢查。
- 工作量小；修改風險低；信心低。

**R14　重複加入成員的錯誤碼（假設）**

- 證據：`ledgers.service.ts:498` 建立成員。該檔沒有處理 `P2002`（唯一鍵衝突）。
- 影響：可能回 500 而不是 409。
- 修法：確認有沒有前置檢查，沒有就補對應。
- 工作量小；修改風險低；信心低。

**R15　大檔案難維護（改善）**

- 證據：`transactions.service.ts` 1937 行；`TransactionForm.tsx` 1865 行。
- 影響：改動容易互相影響，審查成本高。
- 修法：下次動到時順手拆，不必專門重構。
- 工作量大；修改風險中；信心高。

**R16　CI 沒有相依套件漏洞檢查（改善）**

- 證據：CI 步驟只有安裝到 e2e。`codeql.yml` 只掃自己的程式。
- 影響：套件已知漏洞不會被發現。
- 修法：加 `pnpm audit` 步驟。
- 工作量小；修改風險低；信心高。改 CI 要先同意。

### 效能（全部沒有量測，都是讀程式的推測）

- **P1**　`balanceTrend` 每個月跑 2 次查詢。
- **P2**　往來對象列表先全部載入再分頁。
- **P3**　往來提案列表有 N+1（列表每一筆再各查一次）。
- **P4**　任何金錢寫入後，前端重抓 12 組查詢（`apps/web/src/lib/invalidate-after-money-write.ts`）。

驗證方法：用 `apps/api/test/stats-perf.perf-spec.ts` 的做法灌入 1 萬筆交易，量這幾個端點的回應時間。資料量小時不必處理。

### 已記錄的取捨（不算缺陷）

- token 放在 `localStorage`。`apps/web/src/lib/token-storage.ts` 有寫明風險，並用 CSP（限制頁面能載入哪些腳本的規則）補強。
- 用 email 加成員會洩漏該 email 有沒有註冊。`ledgers.service.ts:444` 的註解已說明這個取捨。被加入的人不需同意就成為成員，這點開放前值得再討論。

### 文件與程式不一致

- **D1**　根 `README.md` 說 AI 記帳是規劃中，也沒提統計與語音。
- **D2**　`apps/api/CLAUDE.md` 列 6 個模組；`apps/web/CLAUDE.md` 列 5 個 feature 資料夾，實際有 13 個。`app.module.ts` 的檔頭同樣只列 6 個模組。
- **D3**　`docs/README.md` 階段表寫階段三、四「進行中」，根 `CLAUDE.md` §4 寫已完成。
- **D4**　`docs/specs/phase-4a-voice.md` 標「草稿」，語音介面已在 #212 合併。
- **D5**　`docs/specs/phase-3b-debts.md` 標「3b-1 完成」，後續 3b-2 已完成。
- **D6**　`tasks/` 還留著 3e～3l 已完成的 plan 與 todo，共 18 個檔。
- **D7**　`apps/api/CLAUDE.md` 寫金額不可用 `number` 運算，實際是整數的 `number`。規則的寫法該修正。
- **D8**　`docs/handoff/main.md` 的現況停在 2026-10-22。

---

## 4. 死函數與瘦身清單

標記：1＝證據足夠可移除；2＝疑似，需確認；3＝少用但有理由保留。

| 編號 | 候選                                                                                     | 引用證據                                           | 標記 | 效益                          | 驗證方式                        |
| ---- | ---------------------------------------------------------------------------------------- | -------------------------------------------------- | ---- | ----------------------------- | ------------------------------- |
| X1   | `TransactionFilterBar`（`apps/web/src/features/transactions/TransactionFilters.tsx:25`） | 全專案只有定義處                                   | 1    | 少一個元件與其樣式            | 刪除後跑 typecheck 與 web 測試  |
| X2   | `AI_WIRE_UNMATCHED`、`AiWireResponse`（`apps/api/src/ai/ai-wire-format.ts:25, 46`）      | 只有定義處                                         | 1    | 很小，只少 2 個匯出           | 刪除後跑 typecheck              |
| X3   | `useMembers`（`apps/web/src/features/ledgers/use-members.ts:18`）                        | 只有定義處                                         | 2    | 該檔 109 行，要看同檔其他匯出 | 確認成員列表用的是哪個 hook     |
| X4   | `useOpenSettleIntent`（`apps/web/src/features/settlements/settle-intent.ts:31`）         | 只有定義處                                         | 2    | 小                            | 確認結清入口是否改用別的方式    |
| X5   | `useRemovalPreview`（`apps/web/src/features/ledgers/use-ledgers.ts:168`）                | 只有定義處                                         | 2    | 小                            | 確認移除成員的預覽畫面還在不在  |
| X6   | `useDeleteLedger`、`useClearLedgerPointer`                                               | 只被 `invalidate-after-money-write.test.ts` 引用   | 2    | 小                            | 確認刪帳本的畫面走哪個 hook     |
| X7   | `DeleteLedgerQuery`（`packages/shared/src/types/ledger.ts:172`）                         | 只有定義處                                         | 2    | 很小                          | 確認是否對應某個 API 的查詢參數 |
| X8   | `apps/api` 的 `ts-loader`、`source-map-support`、`@eslint/eslintrc`                      | 只出現在 `package.json`                            | 2    | 少 3 個開發相依               | 移除後跑 lint、build、test      |
| X9   | `attributeTransactions`（`apps/api/src/statistics/attribution.ts`，91 行）               | 只被自己的測試引用；檔頭寫明「只給測試的獨立對照」 | 3    | 不建議移除                    | 無                              |

掃描範圍是 703 個檔的匯出引用。另有一批「只在自己檔案內使用卻標了 `export`」的項目，價值低，沒有列出。沒有檢查字串形式的動態載入，所以標記 2 的項目刪除前要再搜尋一次。

---

## 5. 功能調整與新增建議

依使用者價值排序。畫面相關的判斷來自讀程式，沒有實際操作。

| 編號 | 類型 | 建議                                   | 誰遇到什麼問題                                             | 最小範圍                  | 效益與維護成本                        | 階段   |
| ---- | ---- | -------------------------------------- | ---------------------------------------------------------- | ------------------------- | ------------------------------------- | ------ |
| F1   | 新增 | 防重複送出（同 R1）                    | 網路不穩時記帳的人會記成 2 筆，現有流程沒有任何攔截        | 新增交易與 AI 確認先做    | 直接影響帳目可信度；要多維護 1 個欄位 | 現在   |
| F2   | 修改 | 憑證過期時導回登入頁（同 R9）          | 7 天後回來的使用者看到每個操作都失敗                       | 只改 401 的處理           | 成本很低                              | 現在   |
| F3   | 新增 | 加成員改成邀請加同意                   | 被加入的人沒同意就出現在別人的帳本，email 也被全體成員看到 | 沿用好友邀請的做法        | 開放給外人前才需要；要改資料模型      | 開放前 |
| F4   | 新增 | 隱私政策與 AI 使用同意                 | `docs/handoff.md` 已列為開放前的必要條件                   | 依該文件                  | 必要項目                              | 開放前 |
| F5   | 修改 | 頁面載入中的畫面                       | `apps/web/src/app/routes.tsx:32` 載入分頁時整頁空白        | 放一個固定的骨架畫面      | 成本很低                              | 下一輪 |
| F6   | 簡化 | 歸檔已完成的 `tasks/` 檔案並更新階段表 | 新接手的人會讀到過期狀態                                   | 搬檔與改表格（同 D3、D6） | 降低交接成本                          | 下一輪 |

---

## 6. 建議執行順序

### 立即處理（小修，可直接做）

- R2　Swagger 只在非正式環境開啟。
- R3　`JWT_SECRET` 加長度下限。
- R4　把測試帳密移出 `docs/handoff/main.md`，並更換那組密碼。
- 主工作區重跑 `pnpm install`，再確認 lint 與 typecheck 恢復綠燈。
- D1～D8　更新文件。

### 下一輪處理

- 需要先寫 spec 討論：R1 防重複送出（改 schema 與 API）、R6 憑證失效機制、R5 備份與還原程序。
- 可直接做：R9、R7、R8、R11 的 `enableShutdownHooks`、R13、R14、X1、X2、F5。

### 後續評估

- R10　依實際部署架構決定 `trust proxy` 與限流的存放位置。
- R12　日期改成純字串傳遞。
- P1～P4　灌大量資料後量測。
- F3　加成員改成邀請制。
- R16、R11 的 helmet（各需要先同意）。
- X3～X8　確認後再決定。

### 目前不建議投入

- R15　專門拆分 `transactions.service.ts` 與 `TransactionForm.tsx`。有隔離測試保護，動到時再拆即可。
- 把 token 改成 httpOnly cookie（腳本讀不到的瀏覽器儲存方式）。現有 CSP 已有補強，改動範圍大。
- 效能最佳化。目前沒有量測數字支持。

---

## 剩餘範圍

以下沒有讀，結論不涵蓋它們：`專案決策脈絡.md`、各 spec 內文、`statistics.service.ts` 細節、好友服務、e2e 測試內文、前端各頁面的實際畫面與手機版面。
