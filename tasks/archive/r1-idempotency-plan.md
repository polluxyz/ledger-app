# R1 實作計畫：防重複送出（Idempotency-Key）

spec：`docs/specs/r1-idempotency.md`（決策 361～372、W289～W292、SC-IK1～SC-IK16）。後端與網頁合成一個 PR（決策 372）。

> 核可：spec 由開發者 2026-11-17 回「核可」（含 §10 的 2 項）。本 plan 與 `tasks/archive/r1-idempotency-todo.md` 開發者 2026-11-17 回「同意」核可。

## 0. 起點

- 先開 docs PR（spec、plan、todo、編號登記、審查報告的進度註記），合進 `main`。
- 整合分支 `feature/r1-idempotency`，從合併後的 `main` 開，用 `review-specs` worktree，測試資料庫 `ledger_review_spec_test`（`.env.test` 已指向它）。只有協調者寫這條分支。
- worker 各開自己的 worktree 與測試資料庫，從整合分支開子分支，驗收後 merge 回整合分支。
- 角色（`docs/orca-multi-agent.md` §0）：
  - 交易邊界、鎖、並發、授權屬於高準確的工作，派 `backend`。
  - 既有 e2e 補 header 是機械性改動，派 `default`。
  - 網頁派 Codex（`apps/web` 只交給 Codex）。
- **schema 與 API 變更**開發者已同意（spec 依據第 3 行）。不加套件，不改 CI，不改 CORS 設定。

## 1. 元件與相依

### 1.1 協調者自己做（T0：契約與先紅的測試）

**shared 契約**（`packages/shared`）：

- `src/constants/error-codes.ts` 加 3 個 `errorCode`：`IDEMPOTENCY_KEY_INVALID`、`IDEMPOTENCY_KEY_REUSED`、`IDEMPOTENCY_RESOURCE_DELETED`。註解寫對應的決策號。
- 新增 header 名稱常數 `IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key'`，從 `src/index.ts` 匯出。
- 跑 `pnpm --filter @ledger/shared build`。

**e2e 輔助函式**（`apps/api/test/e2e-utils.ts`）：

- `idempotencyKey(): { 'Idempotency-Key': string }`，每次回一把新的 `randomUUID()`。用法：`.set(idempotencyKey())`。
- T0 就加，T1a 與 T1b 都用它，避免兩邊各寫一份。

**先紅的 API e2e**（新檔 `apps/api/test/idempotency-isolation.e2e-spec.ts`）：

- SC-IK9 第 1～3 項：
  1. A、B 用同一個鍵字串，各送自己帳本的交易。B 建立自己的紀錄，回應的 id、帳本、金額都是 B 的。資料庫裡 A、B 各 1 筆。
  2. A 在共享帳本建立交易後被移出，用同鍵重送 → 403 或 404，回應不含原交易的 id 與金額。
  3. A 被降為 viewer 後重送 → 403。
- SC-IK3：5 個端點各用同一把鍵 `Promise.all` 送 2 個請求。2 個都 201、id 相同；資料庫筆數與金額效果（帳戶餘額、對象欠款、份額、提議筆數）只有 1 次；沒有 500。
- 紅綠的分法：T0 時後端不認得 header，SC-IK3 會建立 2 筆（紅），SC-IK9 第 1 項會綠（各自建立）。SC-IK9 第 2、3 項靠 guard 已經是綠，保留當回歸。T1a 後 SC-IK3 轉綠。
- 驗證：`pnpm --filter @ledger/api test:e2e -- idempotency-isolation` 跑出預期的紅，typecheck 綠。

### 1.2 後端核心（T1a，`backend`）

依賴 T0。順序照下面寫，每步後跑 `pnpm --filter @ledger/api test`。

**1. schema 與 migration**（`apps/api/prisma/schema.prisma`）：

- 照 spec §3 新增 `IdempotencyKey`、`IdempotencyOperation`、`IdempotencyResultType`。`User` 加反向關聯。
- **欄位寫法的決定**（spec §3 交給 plan）：
  - `resultType` 不可為 null。它由 `operation` 決定，搶鍵時就知道：交易與結清是 `TRANSACTION`，借還帳與免除欠款是 `DEBT_ENTRY`，分帳是 `SPLIT`。
  - `resultId` 改成 `String?`。搶鍵時寫 null，業務寫入完成後在同一個交易內填回。
  - 「提交後一定有結果」由程式保證：共用服務在 callback 回傳後填 `resultId`，回傳值不是非空字串就丟錯，整個交易回滾。單元測試驗這條。
  - 不用暫時值（例如空字串）：暫時值看起來像真的 id，出錯時比 null 難發現。
- `prisma migrate dev --name r1_idempotency_key`，只對 worker 自己的 `.env.test` 資料庫。migration SQL 逐行列在交付說明。
- 確認 `resetDb`（`apps/api/test/e2e-utils.ts:74`）會清到新表。它靠 `User` 的 cascade 也行，但要實測。

**2. 共用服務**（新目錄 `apps/api/src/idempotency/`）：

- `IdempotencyModule` 匯出 `IdempotencyService`，給 transactions、debts、splits、settlements 的模組匯入。
- `parseIdempotencyKey(raw: string | string[] | undefined): string`：
  - 只接受 1 個字串，符合 UUID 格式（不分大小寫），回傳小寫。
  - 其他一律丟 400 `IDEMPOTENCY_KEY_INVALID`。
- `requestHash(input: unknown): string`：
  - 照決策 367 正規化：物件欄位依名稱排序；陣列保留順序；`undefined` 省略；`Date` 轉 ISO 字串。
  - 遇到不認得的型別（函式、`Map`、`BigInt` 等）丟錯，不要默默轉成 `{}`。
  - 回 `v1:` + SHA-256 hex。用 Node 內建 `node:crypto`。
- `run<T>(params, write, replay): Promise<T>`：
  - `params`：`userId`、`key`、`operation`、`scopeId`、`requestHash`。
  - `write(tx)`：領域的寫入，回傳 `resultId`。
  - `replay(resultId)`：領域的讀取，重建回應。
  - 流程：
    1. 開 `$transaction`。第一個語句 insert 鍵表（`resultId` 為 null）。
    2. 呼叫 `write(tx)`，把回傳的 id 寫回鍵表。
    3. 提交後回傳 `{ created: true, resultId }`，由呼叫端讀出回應（照現有寫法，提交後才讀）。
    4. `$transaction` 丟出 P2002 時，判斷是不是鍵表 `(userId, key)` 的索引。是 → 交易已回滾，另開查詢讀已提交的鍵，走重送。不是 → 原錯誤往外丟。
    5. 重送：比對 `operation`、`scopeId`、`requestHash`，任一不同丟 409 `IDEMPOTENCY_KEY_REUSED`。相同 → 呼叫 `replay(resultId)`。
  - P2002 的判斷：專案用 Prisma 7.8，錯誤的 `meta` 長相要實測，不要猜。測出來的結構寫進本 plan §7。判斷不出來時一律當「不是鍵表」往外丟（會變 500，不會變成重複寫入）。
  - 重送讀到的鍵 `resultId` 是 null：照理不會發生（決策 365 (a)）。丟 500 並記錄 `key` 以外的欄位，不要回 201。
  - 不設 `isolationLevel`：5 個端點現在都用預設等級（已查過，`isolationLevel` 只出現在 accounts、ai-quota、ledger-leave、ledgers、statistics）。
- 單元測試：搶到、P2002 轉重送、其他 P2002 往外丟、3 種比對不符各回 409、`write` 回空值時回滾、雜湊正規化（欄位順序不同結果相同、`undefined` 省略、陣列順序不同結果不同、`Date`）。

**3. header 的讀取與驗證順序**（決策 363 (e)、364）：

- 新增參數裝飾器 `@IdempotencyKeyHeader()`，只取出原始值，不驗證。
- controller 方法的第一行呼叫 `parseIdempotencyKey(raw)`，再呼叫 service。
- 理由：Nest 的參數 pipe 沒有保證先後，放在 pipe 裡可能比 DTO 驗證先報錯。放在方法本體，guard 與 `ValidationPipe` 一定都已經通過（SC-IK1 要驗「DTO 錯時回 `VALIDATION_FAILED`」）。
- OpenAPI：5 個端點加 `@ApiHeader({ name: 'Idempotency-Key', required: true })`，並列出 400、409 的回應。名稱用 shared 的常數。

**4. 5 個 service 接上共用服務**：

每個 service 把現有 `$transaction` 的內容抽成「收 `tx` 的寫入函式」，外層改由 `IdempotencyService.run` 開交易。業務規則、鎖的順序、錯誤碼都不動。

| 端點     | 現有交易                                              | `operation`／`scopeId`                   | 雜湊的輸入                                     | 重送時的讀取與權限                                                                                                                        |
| -------- | ----------------------------------------------------- | ---------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 交易     | `transactions.service.ts:398`（共享）、`:450`（個人） | `TRANSACTION_CREATE`／`ledgerId`         | DTO + `ledgerId`                               | 讀交易目前所在的帳本，驗目前使用者在那本帳本可寫入，再 `getById`。軟刪除 → `IDEMPOTENCY_RESOURCE_DELETED`                                 |
| 借還帳   | `debt-entries.service.ts:66`                          | `DEBT_ENTRY_CREATE`／null                | DTO                                            | 往來紀錄的對象要屬於目前使用者，再組回應，含提交後補的 `ledgerParts`（`:130`）。軟刪除 → DELETED                                          |
| 代墊分帳 | `splits.service.ts:39`                                | `SPLIT_CREATE`／null                     | DTO                                            | `loadOwned(userId)`，再驗分帳目前所在的帳本可寫入，再 `get`。軟刪除 → DELETED                                                             |
| 結清     | `settlements.service.ts:91`                           | `SETTLEMENT_CREATE`／`ledgerId`          | DTO + `ledgerId`                               | 同交易，`resultId` 是結清的交易 id。軟刪除 → DELETED                                                                                      |
| 免除欠款 | `counterparties.service.ts:306`                       | `COUNTERPARTY_FORGIVE`／`counterpartyId` | DTO（含 body 的 `ledgerId`）+ `counterpartyId` | 對象屬於目前使用者（`loadOwnedCounterparty`），免除紀錄對應的交易所在帳本可寫入，再組回應。不再檢查餘額（決策 366 (c)）。軟刪除 → DELETED |

- 「可寫入」沿用各領域現有的檢查（例如 `assertLedgerWritable`），不另寫一套。沒有權限照現有規則回 403 或 404。
- 讀不到資源（整本帳本已刪除、紀錄被真的刪除）→ 404，和現在相同（決策 366 (f)）。
- AI 確認走交易端點，AI 新分類在同一個 `tx` 內建立，回滾時一起消失（SC-IK7 第 2 項）。
- 既有單元測試因簽名改變而壞的，只改呼叫方式，斷言不放寬。

**5. 新 e2e**（新檔 `apps/api/test/idempotency.e2e-spec.ts`）：

- SC-IK1、SC-IK2、SC-IK4～SC-IK7、SC-IK10、SC-IK11。
- 每條都斷言資料庫筆數與金額效果（spec §5 開頭那句）。
- SC-IK7 第 2 項與 SC-IK8 的注入：從 `app.get(...)` 取得 service，用 `jest.spyOn` 讓某一步丟錯。SC-IK8 讓提交後的讀取丟錯一次，下一次恢復。
- SC-IK11 第 2 項（CORS 預檢）：`createE2EApp` 沒有套 CORS。把 `main.ts:27` 的 CORS 選項抽成一個函式，`main.ts` 與這條測試共用。這是搬程式，選項內容不變。
- SC-IK11 第 3 項：挑 2 個不在範圍內的 POST（例如建立分類、建立帳戶），不帶 header 照常 201。

### 1.3 既有 API e2e 補 header（T1b，`default`）

依賴 T0。和 T1a 平行。

- 範圍：`apps/api/test/` 中呼叫 5 個端點的所有地方，約 42 個檔案，包括共用的 fixture（`statistics-fixtures.ts`、`linking-utils.ts`、`concurrency-utils.ts`，有呼叫就算）。
- 每個請求加 `.set(idempotencyKey())`。迴圈或 helper 裡建立多筆時，每筆一把新鍵。
- 不改任何斷言、不改測試資料、不刪測試。
- 在 T1a 之前，後端不認得這個 header，加上去不影響結果，所以可以先跑全綠。
- 驗收的方法：在合併 T1a 之後跑全部 API e2e。漏加的地方會回 400，馬上看得出來。
- 不碰 T1a 會新增的 2 個 e2e 檔，不碰 `e2e-utils.ts`。

### 1.4 網頁（T2，Codex）

依賴 T0。和 T1a、T1b 平行。Vitest 用 mock，不需要後端。

**1. 產生鍵**（新檔，例如 `apps/web/src/lib/idempotency-key.ts`）：

- 用 `crypto.getRandomValues` 組 UUID v4（決策 371）。不用 `crypto.randomUUID`。
- SC-IK15：測試把 `crypto.randomUUID` 拿掉後仍產生合法 UUID v4。

**2. `api-client`**（`api-client.ts:35`、`:48`、`:56`）：

- `post` 加選填的 `idempotencyKey` 參數，有值就放進 header，名稱用 shared 的常數。
- `api-client` 不自己產生鍵（決策 371 (c)）。

**3. 手動表單**（W289）：

- `TransactionForm` 的新增交易與新增分帳、`DebtEntryForm`、`SettlementForm`、免除欠款對話框（`CounterpartyDetail.tsx:57`）。
- 開始一筆新記帳時產生鍵，存在元件狀態或 ref，不存進 `localStorage`。
- 網路錯誤、逾時、5xx 保留鍵與內容；失敗後改內容也不換鍵。
- 成功後換新鍵，包括 `TransactionForm.tsx:1230`、`:1324`、`:1373` 的清空點。
- 編輯模式不帶鍵。
- hook（`use-debts.ts:127`、`:190`，`use-settlements.ts:72`）把鍵往下傳給 `api-client`。

**4. AI**（W290、W291）：

- 草稿建立時每筆各配 1 把鍵（`ai-session.tsx:199`）。重新解析產生新鍵。
- 單筆確認、全部確認、草稿表單送出都用這筆草稿的鍵。草稿表單由 `TransactionWorkbench.tsx:146`、`:157` 把鍵傳進 `TransactionForm`。
- 網路錯誤、逾時、5xx 顯示「尚未確認，請重試」，取代 `ai-session.tsx:293` 的文字。其他錯誤照原文案。

**5. 新錯誤碼**（W292）：

- `IDEMPOTENCY_KEY_REUSED` 顯示「已記錄過」，重新抓列表；表單與草稿不清掉。
- `IDEMPOTENCY_RESOURCE_DELETED` 顯示「這筆已刪除」；表單與草稿不清掉。
- `IDEMPOTENCY_KEY_INVALID` 照現有的通用錯誤。
- 文字放在現有錯誤碼對應文字的地方，不另開一套。

**6. 測試**：

- Vitest：SC-IK12、SC-IK13、SC-IK15。既有 Vitest 的斷言不改，只補 header 相關的 mock。
- Web e2e 的 API 種資料（`apps/web/e2e/api.ts` 等）呼叫這 5 個端點的地方補 header。
- Playwright SC-IK14：寫好測試。要對後端跑，T1a 合併前會失敗，屬預期。T3 由協調者在整合分支跑。

### 1.5 整合、驗收、PR、部署（T3，協調者）

依賴 T1a、T1b、T2。

- 依序 merge T1a → T1b → T2 進整合分支。
- 逐行看 diff：
  - migration SQL。
  - 共用服務的交易邊界、P2002 判斷、`resultId` 的保證。
  - 5 個 service 的鎖順序、錯誤碼、權限檢查有沒有被搬動或漏掉。
  - 重送路徑的權限檢查。
  - T1b 只加 header，沒動斷言。
  - 網頁的換鍵時機與 `api-client`。
- 自己重跑：
  - 根目錄 lint、typecheck、test、format:check、build。
  - API e2e 全部，含 2 個新檔與 SC-IK9、SC-IK3。
  - Web e2e 全部，含 SC-IK14。跑之前確認 3100／5273 沒被占。
- 用 `pr` skill 開 PR，盯 CI，squash merge。
- 部署 dev（主工作區，spec §8）：`pg_dump` 備份 `ledger_dev` → `pnpm install` → build shared → `prisma generate` → `prisma migrate deploy` → 重開 API 與 Vite。提醒開發者按 `Ctrl + Shift + R`。
- 部署後用開發者的瀏覽器流程手動走一次：記 1 筆交易成功、列表 1 筆。
- 清掉 worker 的 worktree、分支、終端機、測試資料庫。

### 1.6 文件收尾（T4，協調者）

併進 T3 的 PR。

- `docs/reports/2026-11-11-project-review.md`：R1 標完成，附 PR 號。
- `apps/api/CLAUDE.md`：加 1 條「建立金錢紀錄的新端點要接 `IdempotencyService`」（spec §9）。
- `專案決策脈絡.md`：記「為什麼用通用鍵表與必填 header」，連回 spec。
- `CLAUDE.md` §4、`docs/README.md`、`docs/handoff/main.md`：進度與狀態。
- spec 狀態改成「已完成」。本 plan 與 todo 移到 `tasks/archive/`。

## 2. 實作順序

1. docs PR → 合進 `main`。
2. T0（協調者）→ 整合分支 commit。
3. T1a（`backend`）、T1b（`default`）、T2（Codex）同時派出。
4. T3（協調者）：合併、驗收、PR、部署。T4 併進同一個 PR。

T1a 只用 1 個 worker：共用服務和 5 個 service 的改法要一致，拆開容易各寫一套。T1b 與 T2 改的檔案和 T1a 不重疊。

## 3. 風險與對策

| 風險                                                                        | 對策                                                                                                                 |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 把 5 個 service 的交易搬進共用服務時，改到鎖的順序或漏掉檢查                | 寫入函式整段搬，不重排。既有 API e2e 全跑當回歸。T3 逐行看 diff                                                      |
| Prisma 7 的 P2002 `meta` 長相和舊版不同，判斷錯誤                           | 實測後寫進 §7。判斷不出來一律往外丟。SC-IK3 實際走過並發路徑                                                         |
| 後到的同鍵請求卡在唯一索引等待，算進 Prisma 互動式交易的逾時（預設 5 秒）   | 等待時間就是先到請求的寫入時間，平常遠小於 5 秒。真的逾時回錯誤、不寫入，網頁保留鍵，使用者重試會走重送。SC-IK3 實測 |
| 搶鍵放在交易第一句，可能和業務的鎖形成死鎖                                  | 後到的請求卡在鍵表，還沒拿任何業務鎖，不會互等。SC-IK3 的 5 個端點都實測                                             |
| 重送時漏驗權限，被移出帳本的人讀到舊資料                                    | 重送一律走 guard 加資源所在帳本的檢查。SC-IK9 由協調者先寫、先紅                                                     |
| 雜湊把 `class-transformer` 轉出的物件或 `Date` 轉錯，同一個請求算出不同的值 | 單元測試涵蓋；SC-IK2 用真的 HTTP 重送，雜湊不穩會變成 409                                                            |
| T1b 漏加 header                                                             | 合併 T1a 後全跑 API e2e，漏加的回 400，一看就知道                                                                    |
| T1b 動到斷言                                                                | 驗收時用 `git diff` 只看到 `.set(idempotencyKey())` 與 import；其他變動退回                                          |
| 網頁某個呼叫處漏帶鍵，部署後那個功能整個不能用                              | Web e2e 全跑；部署後手動走一次。5 個呼叫處列在 §1.4，逐一核對                                                        |
| 舊的瀏覽器分頁送出收到 400                                                  | 預期行為（決策 372）。部署後提醒開發者強制重新整理                                                                   |
| 鍵表一直變大                                                                | 決策 369 (d)：自用規模不處理，開放前依筆數再評估                                                                     |

## 4. 驗證點

- T0 後：SC-IK3 紅、SC-IK9 第 1 項綠；typecheck 綠；shared build 綠。
- T1a 後：共用服務單元測試綠；SC-IK1～SC-IK11 綠；既有 API 單元測試綠。既有 API e2e 要等 T1b 合併才會綠。
- T1b 後：在沒有 T1a 的分支上 API e2e 全綠，diff 只有 header。
- T2 後：Vitest 綠（SC-IK12、SC-IK13、SC-IK15）；Web typecheck、lint 綠。
- T3 後：SC-IK16 全綠；SC-IK14 綠；CI 全綠；dev 部署後手動記 1 筆成功。

## 5. 要開發者決定的事

- 沒有新的。`resultId` 可為 null、CORS 選項抽成函式，都是 spec 交給 plan 的細節，不改 spec 的語意。

## 6. 派工

- 用 `orca orchestration` 派工，Task spec 照 `docs/orca-multi-agent.md` 的格式：
  - T1a 給 `backend`，附本 plan §1.2 全文與 spec 決策 361～370、§3～§5。
  - T1b 給 `default`，附本 plan §1.3 全文與 SC-IK16。
  - T2 給 Codex，附本 plan §1.4 全文與 spec 決策 371、W289～W292、SC-IK12～SC-IK15。
- 派工前查各層額度（`docs/orca-multi-agent.md` §4）。
- 驗收：協調者逐行看 diff，自己重跑 SC-IK9、SC-IK3、全部 API e2e 與 Web e2e。
- worker 驗收合併後，立刻清 worktree、分支、終端機、測試資料庫。

## 7. 實作紀錄

### T1a：後端核心（2026-11-17）

- 工作分支：`feature/r1-api`，基底為整合分支的 `130bd7e`。
- 開始前完成 shared build 與 Prisma generate。所有資料庫操作只連 `ledger_r1_api_test`；沒有操作 `ledger_dev`、`ledger_test`。
- 新增鍵表、共用服務、原始 header 裝飾器與 5 個端點的接線。controller 第一行驗 header，DTO 驗證仍先執行。
- `run` 首次提交回 `{ created: true, resultId }`，重送回 `{ created: false, response }`。領域保留首次建立的回應方式，重送由讀取函式重建目前狀態。
- 沒有新增套件、修改 CI、變更 CORS 選項或修改既有 API e2e。`idempotency-isolation.e2e-spec.ts` 與共用 e2e 工具保持原樣。

#### Migration SQL（逐行完整內容）

檔案：`apps/api/prisma/migrations/20261117090000_r1_idempotency_key/migration.sql`。

只新增 1 張表、2 個 enum、鍵表的唯一索引與外鍵。`User` 只加 Prisma 反向關聯，沒有修改既有表的 SQL。

```sql
-- CreateEnum
CREATE TYPE "IdempotencyOperation" AS ENUM ('TRANSACTION_CREATE', 'DEBT_ENTRY_CREATE', 'SPLIT_CREATE', 'SETTLEMENT_CREATE', 'COUNTERPARTY_FORGIVE');

-- CreateEnum
CREATE TYPE "IdempotencyResultType" AS ENUM ('TRANSACTION', 'DEBT_ENTRY', 'SPLIT');

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "operation" "IdempotencyOperation" NOT NULL,
    "scopeId" TEXT,
    "requestHash" TEXT NOT NULL,
    "resultType" "IdempotencyResultType" NOT NULL,
    "resultId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_userId_key_key" ON "IdempotencyKey"("userId", "key");

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

依 `apps/api/CLAUDE.md` 的非互動環境指引，用 `prisma migrate diff --from-schema <基底 schema> --to-schema prisma/schema.prisma --script` 產生 SQL，再用 `prisma migrate deploy` 套用。沒有用 `db push` 或手動修改資料庫結構。

#### Prisma 7.8 P2002 實測

在真實 PostgreSQL 的 `$transaction` 內重複插入同一個 `(userId, key)`，印出一次 `JSON.stringify(error.meta)`，得到：

```json
{
  "modelName": "IdempotencyKey",
  "driverAdapterError": {
    "name": "DriverAdapterError",
    "cause": {
      "originalCode": "23505",
      "originalMessage": "duplicate key value violates unique constraint \"IdempotencyKey_userId_key_key\"",
      "kind": "UniqueConstraintViolation",
      "constraint": { "fields": ["\"userId\"", "key"] }
    }
  }
}
```

這個版本沒有 `meta.target`。`fields[0]` 的字串本身含雙引號，`fields[1]` 不含雙引號。判斷要求 P2002、正確的 `modelName`、`originalCode`、`kind` 與精確的 2 個欄位全部吻合；其他形狀一律往外丟，不依錯誤文字猜測。e2e 保留相同結構的斷言，移除臨時印出。

#### 5 個 service 搬動範圍與權限

1. `transactions.service.ts`：原共享與個人 `$transaction` 內容移進同一個 `write(tx)` 的 2 個分支。共享分支保留找本人、鎖人物、解析帳戶、分類、寫交易、寫份額的順序；個人分支保留帳戶、分類、交易的順序。帳本類型讀取與靜態檢查在搶鍵後執行，讀取使用同一個 `tx`，避免另取連線。個人交易的回應轉換仍在提交後。重送用結果目前的 `ledgerId` 呼叫既有 `assertLedgerWritable`，再查軟刪除，最後 `getById`。
2. `debt-entries.service.ts`：原建立交易整段移成 `write(tx)`。保留解析對象、鎖對象、讀餘額、寫交易、寫往來紀錄、差額、提議、同步狀態與組回應的順序。純輸入檢查 `assertEntryShape` 維持交易外，`ledgerParts` 維持提交後補齊。重送先限定紀錄對象屬於本人，再驗紀錄對應交易目前的帳本可寫，檢查軟刪除，重建同步狀態、差額與 `ledgerParts`；不重驗還款餘額。
3. `splits.service.ts`：保留交易外的份額計算；原交易整段移成 `write(tx)`。參照檢查、鎖對象、轉分帳時的原交易檢查及軟刪除、建分帳、建參與者、寫組合的順序不變。重送先查本人擁有的結果及目前帳本，驗可寫與軟刪除，再沿用 `loadOwned` 和 `get`。
4. `settlements.service.ts`：原建立交易整段移成 `write(tx)`。帳本類型、找本人、鎖人物、解析兩端帳戶、建交易、建結清的順序不變。重送沿用交易的 `replayCreated`，驗結果目前所在的帳本；`resultId` 是交易 id。
5. `counterparties.service.ts`：只搬 `forgive` 的原交易內容。保留驗對象擁有者、驗指定帳本、鎖對象、讀餘額、寫呆帳交易、寫免除紀錄、提議、同步狀態的順序。重送先驗結果對象擁有者，再驗對應交易目前帳本可寫及軟刪除；只為回應計算目前餘額，不再用餘額判斷能否免除。

5 個 service 都保留原業務錯誤碼與預設隔離等級。首次回應原本在交易內組合的部分保留原樣，只把結果 id 交給共用服務填回鍵表。

既有單元測試只補 constructor 的共用服務與 create 的鍵參數。首次寫入的測試替身仍呼叫原本的 `$transaction`。比對 TypeScript 語法樹，排除新鍵參數後，5 個既有測試檔的 334 個斷言敘述完全相同（20、104、51、37、122）。

#### 驗證證據

- 共用服務新增 31 個單元測試；包含搶鍵順序、P2002 重送及拒絕其他 P2002、3 種不符、空結果、雜湊正規化與未完成結果的拒絕。
- 新增 e2e 54 項，涵蓋 SC-IK1、SC-IK2、SC-IK4～SC-IK8、SC-IK10、SC-IK11。另補 5 個端點的結果搬帳本後失去寫入權、結果真的刪除、空結果造成真實回滾。
- SC-IK7 在交易內記錄已寫入的份額、差額、提議與 AI 分類筆數，再於 HTTP 回應外斷言；測試不會把斷言失敗誤當成預期的 500。
- `resetDb` 實測：建立交易與鍵後呼叫原工具，鍵從 1 筆變 0 筆，交易變 0 筆、金額加總為 null。原因是工具查 `pg_tables` 動態列出所有 public 表，再一次 `TRUNCATE ... CASCADE`，不需要修改工具或只靠 User cascade。
- CORS 選項只抽成 `src/config/cors-options.ts`，內容仍只有 `origin: config.get('CORS_ORIGIN', { infer: true })`。OpenAPI、真實預檢與不需鍵的分類及帳戶建立都實測通過。
- `pnpm --filter @ledger/api test:e2e -- idempotency`：`Test Suites: 2 passed, 2 total`；`Tests: 62 passed, 62 total`。包含未修改的 SC-IK3（5 項）與 SC-IK9（3 項）。
- 根目錄 `pnpm lint`：exit 0，shared、API、Web 全部通過。
- 根目錄 `pnpm typecheck`：exit 0，shared、API、Web 全部通過。
- 根目錄 `pnpm test`：exit 0；shared 160/160、API 1084/1084（70 suites）、Web 1290/1290（142 files）。
- 根目錄 `pnpm format:check`：exit 0，`All matched files use Prettier code style!`。
- 同時跑根目錄檢查與 API e2e 時，曾有 2 個未修改的 Web 測試超過既有的 5000ms 上限（`StatsPage` 鍵盤操作、`use-transactions` 建立後刷新餘額）。先前 2 次已通過，停止其他檢查後單獨重跑根目錄 `pnpm test`，全部通過；沒有調整測試或上限。高負載是推測原因。

#### 偏離與待辦

- 沒有需求或業務規則的偏離。migration 產生方式依後端指引改用 diff 與 deploy，沒有使用互動式 migrate dev。
- 既有完整 API e2e 留給 T1b 合併後驗證；本分支只跑 2 個 idempotency 檔。沒有執行 Web e2e。
- 待協調者合併、逐行驗收及跑完整回歸；本 worker 不 push、不開 PR。
- 交付時整合分支已前進到 `72bcebc`（T1b）；檢查本 worker 的改動請以 `130bd7e..feature/r1-api` 為準。對目前整合分支的 diff 也只含 `apps/api` 與本 plan，既有 API e2e 的差異來自整合分支已先合併 T1b。

### T1b：既有 API e2e 補 header（2026-11-17）

- 既有 API e2e 建立金錢紀錄的請求都補上 `.set(idempotencyKey())`，斷言沒有改。
- 合併進整合分支時，有 1 個檔案和 T1a 的 import 重複，協調者合併成 1 行（`385b131`）。

### T2：網頁（2026-11-17）

- 5 個建立入口都帶鍵：手動表單用 state 保留鍵，成功後換鍵；AI 草稿每筆各有一把鍵；「免除剩餘」每次打開對話框換鍵。
- 計畫外修正：`TransactionForm` 的分帳草稿路徑原本成功後不清草稿、不換鍵，再按一次會收到「已記錄過」。補上 `onDraftSavingChange` 與 `onSaved`，在核可範圍內。
- `AiEntry.voice.test` 的網路錯誤文字改成「尚未確認，請重試」，這是 spec 要求的新文字，不是放寬斷言。
- 協調者驗收時退回 1 次：新檔與新欄位缺檔頭說明和 suite 註解。worker 補在 `fefc4fc`，沒有改程式與斷言。

### T3：整合（2026-11-17）

- 整合分支 `feature/r1-idempotency` 依序合併 T1b、T1a、T2，沒有衝突以外的手動改動。
- CORS 只把既有選項抽成 `corsOptions()` 函式，選項內容不變，不屬於「改 CORS 設定」。
- 已知小事，不擋合併：「免除剩餘」關掉再開會換鍵。若第 1 次其實已成功，第 2 次會因剩餘欠款為 0 被擋下，不會重複免除。
- 已知風險：`isKeyConflict` 綁定 Prisma 7.8 的錯誤格式。升級 Prisma 後若格式改變，每次同鍵重送都會變成 500，但不會重複記帳；SC-IK2、SC-IK3 會抓到。
