# 3h 實作計畫：每一筆帳都要對到帳戶

spec：`docs/specs/phase-3h-every-entry-has-account.md`（決策 159～175、W172～W177、SC-H1～SC-H14）。後端、migration、畫面、e2e 合成一個 PR。

> 核可：**已核可**（2026-10-14）。

## 0. 起點

- 整合分支：從 `main`（`3437904`）開 `feature/every-entry-account`。worker 從協調者的契約 commit 開分支，驗收後 merge 回來，最後一個 PR。
- 本步動到錢、帳戶與 migration 的地方多，**難的都派 `backend`**（`gpt-6-sol` high），其餘派 `default`（`gpt-6-luna` max）。順序照 `docs/orca-multi-agent.md` §0：Codex → GLM → Gemini。
- 為了讓 worker 能平行，`schema.prisma` 的欄位變更放在協調者的契約 commit（只改 schema、跑 `prisma generate`，不產 migration）。migration SQL 與資料搬移由 G1 寫。

## 1. 元件與相依

### 1.1 協調者自己做（G0：契約與隔離測試）

- `apps/api/prisma/schema.prisma`（spec §3.1）：`Account.isTemporary`、刪 `Ledger.tracksBalance`、`Transaction.differenceOfId` 自我關聯。跑 `prisma generate`，不產 migration。
- `packages/shared`：
  - `Ledger`、`CreateLedgerRequest`、`UpdateLedgerRequest` 拿掉 `tracksBalance`。
  - `Account` 加 `isTemporary: boolean`。
  - `Transaction` 加 `differenceOfId: string | null`、`difference: { id; type; amount } | null`。
  - `DebtEntry` 加 `difference: { transactionId; type; amount } | null`。
  - `CreateDebtEntryRequest.record` 改成不可為 null；`AcceptDebtProposalRequest.record` 的型別註解寫明「會產生交易時必填」。
  - `ForgiveCounterpartyRequest { ledgerId }`（新）；免除提議接受時的 `record` 允許只帶 `ledgerId`。
  - `RecordDefaults { ledgerId: string | null; accountId: string | null }`、`RecordDefaultsQuery { ledgerId?: string }`。
  - 錯誤碼 `TEMPORARY_ACCOUNT_NOT_SELECTABLE`、`TEMPORARY_ACCOUNT_LOCKED`；`apps/web/src/lib/error-messages.ts` 補中文訊息。
  - 純函式 `differenceLabelOf(parentType, childType)` → `少收`／`多收`／`少付`／`多付`，與 `forgivenessLabelOf(type)` → `呆帳`／`債務免除`，附 Node test。畫面只呼叫它們，不自己判斷方向。
- Web 共用 hook（避免兩個畫面 worker 同時改）：`useRecordDefaults(ledgerId?)`（`features/accounts/use-record-defaults.ts`），表單用它帶入預設值。
- `apps/api/test/every-entry-account-isolation.e2e-spec.ts`：SC-H11，先看到紅燈。內容：
  - 我用別人臨時帳戶的 id 當 `accountId`（交易、結清、借還、`PUT …/account`）→ 被拒（`404` 或 `400`，不透露帳戶存在）。
  - `GET /accounts` 只回我自己的帳戶（含我的臨時帳戶），看不到別人的。
  - `GET /users/me/record-defaults` 不回別人的帳戶；`?ledgerId=` 帶我沒權限的帳本 → `404`。
  - 別人的分支、別人的呆帳交易 → `404`。
  - 共享帳本裡別人替我記的交易，別的成員看到的 `accountId` 是 `null`（照舊遮蔽），`accountPending` 只對我是 true。

### 1.2 後端（worker）

1. **G1 schema、migration、臨時帳戶、拿掉 tracksBalance**（`backend`）：
   - migration（spec §3.3）：建臨時帳戶（同名衝突取名「臨時帳戶 2」）、部分唯一索引、搬移帳戶待補與不計入餘額的交易、差額轉分支（3g 綁定的用 `settlesEntryId`；舊的用「同對象、`createdAt` 差 1 秒內、中間沒有別的紀錄、還款有交易」配對）、刪 `tracksBalance`。**SQL 先給協調者，協調者列給開發者看**。
   - 註冊時（`AuthService` 建使用者的同一個資料庫交易）建臨時帳戶。
   - `AccountsService`：餘額拿掉 `ledger.tracksBalance` 條件；臨時帳戶 `PATCH`／`DELETE` → `409 TEMPORARY_ACCOUNT_LOCKED`；新增共用函式 `assertSelectableAccount(tx, userId, accountId)`（不是我的 → 照舊 `404`；是臨時帳戶 → `400 TEMPORARY_ACCOUNT_NOT_SELECTABLE`），給 G2、G3 使用。
   - `LedgersService` 與 DTO：拿掉 `tracksBalance`。
   - migration 驗證：在自己的測試資料庫灌 spec §6 的資料，跑 migration 前後比對每個帳戶餘額與往來餘額，數字寫進回報。
2. **G2 付款人帳戶規則改成臨時帳戶**（`backend`，依賴 G1 的 `assertSelectableAccount`；G1 先 commit 這個函式）：
   - `ledger-people/payer-account-rules.ts`：拿掉 `tracksBalance`。付款人是別的成員 → 回「用付款人的臨時帳戶」；非成員 → `null`。`isAccountPending` 改成「帳戶是看的人的臨時帳戶」。
   - `TransactionsService`、`SettlementsService`、`SplitsService` 改用新規則；付款人是我時 `accountId` 一律必填；所有使用者送進來的 `accountId`／`toAccountId` 走 `assertSelectableAccount`。
   - `PUT …/transactions/{id}/account`、`PUT …/settlements/{id}/account`：只能換到我的真正帳戶。
   - `toTransaction`：每次請求查一次看的人的臨時帳戶 id，用來算 `accountPending`。
3. **G3 借還一律綁帳戶、分支、免除**（`backend`）：
   - `record` 必填（`assertEntryShape`、接受提議）。
   - `debt-recording.ts`：`writeSettlement` 改成 `writeDifference`——還款紀錄的 `delta` 改成還清的欠款、交易金額跟著改，新增分支交易（同帳本、同帳戶、`differenceOfId`、沒有分類）；`voidRepaymentWithSettlement` 一併作廢分支（舊的綁定差額也照舊處理）；`recalculateSettlement` 改成重算分支（金額、收支方向；剛好還清就作廢）。新增與接受提議兩條路都走這裡。
   - 免除：`POST /counterparties/{id}/forgive` 收 `{ ledgerId }`，記支出「呆帳」；接受免除提議記收入「債務免除」；兩者沒有帳戶、沒有分類，`DebtEntry.transactionId` 指向它。撤銷免除時一起作廢。
   - `TransactionsService`：分支與免除交易從交易端點改或刪 → `409 DEBT_TRANSACTION_READ_ONLY`；回應帶 `differenceOfId`、`difference`。`DebtEntry` 回應帶 `difference`。
4. **G4 預設帶入**（`backend`，授權相關）：`GET /users/me/record-defaults`（spec §4.5、決策 174、W177）。查「我建立、帳戶是我的真正帳戶」的最近一筆交易；帳本要能寫入（EDITOR 以上、未封存、沒退出）；`?ledgerId=` 先查該帳本最近一筆，沒有再查整體。

### 1.3 畫面（worker）

前端只顯示，分支方向、標籤都來自 API 與 shared 純函式（spec §7 Never）。

| 區塊                    | 決策                                       | 主要檔案                                                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G5 帳本、帳戶、交易表單 | W173、W174（帳戶頁）、W177                 | `features/ledgers/`、`features/accounts/`（`use-record-defaults.ts` 除外）、`features/transactions/TransactionForm.tsx`、`features/settlements/SettlementForm.tsx`、`pages/LedgerDetailPage.tsx`、`pages/AccountsPage.tsx` |
| G6 借還與明細           | W172、W174（交易列）、W175、W176、決策 175 | `features/debts/`、`features/linking/PendingCard.tsx`、`features/transactions/TransactionList.tsx`                                                                                                                         |

- G5：帳本對話框、列表、帳本頁拿掉「計入餘額」與「不連動」；交易表單帳戶永遠必填，預設帶入「這本帳本最近用的帳戶」；結清表單同理；帳戶頁的臨時帳戶排最後、有交易才顯示、不能改名刪除。
- G6：借還表單（記一筆、還款）與接受連動拿掉「不記入帳本」，帳本與帳戶帶入預設；免除改成先選帳本；往來紀錄與明細把分支畫在還款下面（`└`、縮排、沒有「⋯」），還款多「還清」標記；呆帳與債務免除用名稱顯示；`undoDeltaOf` 簡化成只看這筆的 `delta`（分支不影響往來餘額，W176 自然成立）；交易列的「待補」改成顯示「臨時帳戶」。

### 1.4 e2e（worker）

- G7 API：`apps/api/test/every-entry-account.e2e-spec.ts` 走完 SC-H1～H10、SC-H14（用 spec §1 的資料）。既有 API e2e 改成一律綁帳戶：先 `grep -rln "record: null\|tracksBalance\|SETTLEMENT\|forgive" apps/api/test` 找出受影響的檔案。
- G8 Web：受影響的 Web e2e（`api.ts` 的建帳本 helper、`ledgers`、`ledger-split`、`debts-inline`、`unified-debts` 等）改成新流程；另加 spec §6 的兩條主線。

## 2. 實作順序

1. 協調者：開 `feature/every-entry-account`、G0 契約與隔離測試（紅燈）→ commit → 開 worker worktree 與資料庫 → 派第 1 波。
2. 第 1 波：G1、G3、G4、G5、G6 同時開始；G2 等 G1 commit `assertSelectableAccount` 後開始（G1 第一個 commit 就做它）。畫面依 shared 型別寫 mock。
3. 協調者列 G1 的 migration SQL 給開發者看，同意後才合進整合分支。
4. 第 2 波：G7、G8（依賴第 1 波全部 merge）。
5. 協調者整體驗收 → PR → CI → 合併。
6. 部署（問開發者）：備份 `ledger_dev` → 用 API 刪測試資料（明哥、房東、阿德三個對象；`ttt`、`家用（不連動測試）` 兩本帳本）→ `migrate deploy` → 重建 API → 用綁帳戶的方式重建 spec §1 的情境 → 請開發者重開 API 與 Vite。
7. 收尾：照 memory「做完的分支要關」清 worktree、分支、終端機、測試資料庫（刪除清單先給開發者看）。

## 3. 風險與對策

| 風險                                       | 對策                                                                                                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| migration 把錢搬錯，帳戶餘額或往來餘額改變 | G1 在測試資料庫跑「前後比對」，協調者自己再跑一次；套到 dev 前先 `pg_dump`，並先刪 spec §3.4 的測試資料，讓 dev 實際被搬的只有 3 筆交易與 1 筆舊差額，搬完逐筆核對                           |
| 舊差額配對錯（對到別的還款）               | 配對條件要「同對象、`createdAt` 差 1 秒內、中間沒有別的紀錄、還款有交易」四項都成立；對不到的保留原樣。單元／migration 測試放一筆「配不到」的舊差額，確認它沒被動                            |
| 分支的方向或金額寫錯，帳戶合計不等於實收   | 公式集中在 `debt-recording.ts`；單元測試涵蓋少收、多收、少付、多付、剛好還清，斷言「還款交易 ± 分支 = 實收」與「往來餘額 0」                                                                 |
| 撤銷還款漏掉分支，或連動對方那邊漏掉       | 撤銷與重算只有一份共用函式，兩個 service 都呼叫；SC-H6、H7 各有 API e2e                                                                                                                      |
| 使用者送入別人或自己的臨時帳戶 id 被接受   | 所有收 `accountId`／`toAccountId` 的地方只走 `assertSelectableAccount`；隔離測試逐一打交易、結清、借還、分帳、`PUT …/account`。協調者驗收時 `grep -rn "accountId" apps/api/src` 對過每個入口 |
| `record-defaults` 帶出沒權限的帳本         | 篩選條件寫在同一條查詢；隔離測試覆蓋封存、退出、VIEWER                                                                                                                                       |
| `record-defaults` 在交易多時變慢           | 依 `creatorId` 與 `createdAt` 排序取 1 筆。驗收時量 1 萬筆交易的回應時間，目標 < 200ms；不夠快要加索引時，先向開發者說明（schema 變更）                                                      |
| 兩個畫面 worker 改到同一個檔案             | §1.3 依檔案分開；`TransactionList.tsx` 只歸 G6，`use-record-defaults.ts` 由協調者在 G0 寫好                                                                                                  |
| migration 套到開發者的 `ledger_dev`        | 每個碰 Prisma 的 worktree，`.env` 與 `.env.test` 都指向 `ledger_eea_<名稱>_test`（協調者先建）                                                                                               |
| Codex 額度用完                             | 照 `docs/orca-multi-agent.md` §4 換層；`backend` 不降層，用完就等重置或問開發者                                                                                                              |

## 4. 驗證點

- 每個 worker：`pnpm lint / typecheck / test / format:check`；碰後端的再跑自己資料庫的相關 API e2e；碰 schema 的跑 `prisma migrate status`。
- 協調者：
  - 逐行看 migration SQL（列給開發者看）、`debt-recording.ts` 的分支函式、`payer-account-rules.ts`、`assertSelectableAccount` 的每個呼叫點、`record-defaults` 的查詢。
  - 自己重跑 migration 前後比對、隔離測試（要從紅轉綠）與兩套 e2e。
  - `grep -rn "tracksBalance" apps packages --include=*.ts --include=*.tsx`（`generated/`、migration 檔除外）沒有結果。
  - `pnpm lint / typecheck / test / build / format:check` 全綠。
- 部署後：dev 的臨時帳戶餘額、各帳戶餘額與部署前（扣掉刪掉的測試資料）一致；spec §1 的 1～7 實際點過一次。

## 5. 派工

| 波次 | worker            | 角色      | 範圍                                             | 驗收                                                                                  |
| ---- | ----------------- | --------- | ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 1    | 協調者            | —         | §1.1 契約、schema、錯誤訊息、共用 hook、隔離測試 | 隔離測試紅燈；shared build 後 API／Web typecheck 只剩「未實作」錯誤                   |
| 1    | `eea-migration`   | `backend` | §1.2 G1                                          | migration 前後比對一致；SC-H2、H9 的 service 測試；`assertSelectableAccount` 單元測試 |
| 1    | `eea-payer`       | `backend` | §1.2 G2                                          | SC-H8 的 API e2e；付款人規則單元測試（自己、成員、非成員、改付款人）                  |
| 1    | `eea-debts`       | `backend` | §1.2 G3                                          | SC-H1、H3～H7、H14 的 service 測試與 API e2e                                          |
| 1    | `eea-defaults`    | `backend` | §1.2 G4                                          | SC-H10 的 API e2e；隔離測試的 `record-defaults` 部分轉綠                              |
| 1    | `eea-web-ledgers` | `default` | §1.3 G5                                          | 元件測試涵蓋帳本對話框、帳戶頁的臨時帳戶、表單預設帳戶                                |
| 1    | `eea-web-debts`   | `default` | §1.3 G6                                          | 元件測試涵蓋 SC-H12 的借還與明細部分                                                  |
| 2    | `eea-api-e2e`     | `default` | §1.4 G7                                          | 新舊 API e2e 全綠                                                                     |
| 2    | `eea-web-e2e`     | `default` | §1.4 G8                                          | 兩套 Web e2e 全綠                                                                     |

- 檔案歸屬：`prisma/migrations/`、`accounts/`、`ledgers/`、`auth/` 歸 G1；`ledger-people/payer-account-rules.*`、`transactions/`（`toTransaction` 的分支欄位除外）、`settlements/`、`splits/` 歸 G2；`debts/`、`transactions/` 裡分支與免除交易的建立與唯讀規則歸 G3；`users/` 歸 G4。G2 與 G3 都要改 `transactions.service.ts`：G3 只新增函式（建立分支與免除交易、唯讀判斷、回應欄位），G2 改既有的帳戶規則；衝突由協調者在 merge 時處理。
- worker 不改 `packages/shared` 與 `schema.prisma`（要改先問協調者）。

## 6. 實作紀錄

1. **H0 多做的機械式修正**（2026-10-14）：拿掉 `tracksBalance` 後 API 編譯不過，四個後端 worker 會互相卡住。協調者在契約 commit 先做最小修正，讓 API typecheck 與 lint 全綠：
   - 帳本 DTO 與 `LedgersService` 拿掉 `tracksBalance`（原屬 H1）；`TRACKS_BALANCE_IMMUTABLE` 錯誤碼刪除，帶 `tracksBalance` 改由 `forbidNonWhitelisted` 回 400。
   - `AccountsService`：餘額拿掉 `ledger.tracksBalance` 條件、回應帶 `isTemporary`（原屬 H1）。
   - `TransactionsService`、`SettlementsService`、`SplitsService`：讀帳本的地方先固定成「計入餘額」，並刪掉 `assertAccountRules` 裡「不計入餘額」的分支（原屬 H2；H2 再把 `tracksBalance` 參數整個拿掉）。
   - 借還 DTO：`record` 不可為 null（原屬 H3）。`toDebtEntry` 先放 `difference: null`、`toTransaction` 先放 `differenceOfId: null`、`difference: null` 佔位（H3 改成讀資料）。
   - 刪掉兩個測舊行為的單元測試（`rename` 帶 `tracksBalance`、`record: null` 不產生交易）。
   - 仍有 6 個單元測試在測「不計入餘額」，留給 H1（`AccountsService` 1 個）與 H2（`TransactionsService` 3 個、`SettlementsService` 2 個）改。既有 API e2e 的 `record: null`、`tracksBalance` 型別錯誤留給 H7。
2. **隔離測試紅燈**：`every-entry-account-isolation.e2e-spec.ts` 8 個全紅（2026-10-14）。
3. **`assertSelectableAccount` 改由協調者在 H0 寫**：原本排給 H1 先交，H2 要等。協調者直接寫進契約（`apps/api/src/accounts/account-selection.ts`，另附 `temporaryAccountIdOf`，6 個單元測試），H1～H4 同時開工。
4. **H0 補的契約**（開工前已寫進 spec）：
   - `Account.hasTransactions`：W174「裡面有交易才顯示」需要它，餘額為 0 不代表沒有交易。spec §4.4 同步補上。H1 實作。
   - `GET /accounts` 臨時帳戶排最後：測試與畫面都有「預設選第一個帳戶」的寫法，排前面會選到臨時帳戶。
   - 註冊時建立臨時帳戶、migration 的結構部分（欄位、索引、補建臨時帳戶、刪 `tracksBalance`）：H2～H4 跑 e2e 需要新欄位，不能等 H1。H1 只補 migration 的資料搬移兩段。
   - shared `actualAmountOf`：修改還款表單要帶入實際收付金額，方向的判斷不能放前端。
   - Web `selectableAccounts`：表單的帳戶選單排除臨時帳戶，H5、H6 共用。
5. **migration 拆成兩個檔**：H3 發現既有的 CHECK 約束 `DebtEntry_transaction_by_kind` 規定免除不能帶交易。協調者另開 `20261014160000_forgiveness_has_transaction` 放寬（`SETTLEMENT` 照舊不能帶）。沒有改原本那個檔，是因為 Prisma 不讓 AI 執行 `migrate reset`，已套用的測試資料庫只能往後 `deploy`。spec §3.3 寫「同一個 migration」，實際是同一個 PR 的兩個 migration。
6. **H1 的 migration 補一條**：不計入餘額帳本裡的借還交易（`LEND`、`BORROW`、`COLLECT`、`REPAY`）沒有帳戶時也移到記帳人的臨時帳戶，放在差額轉分支之前，分支才會拿到同一個帳戶。H1 的比對資料裡 r6 就是這種情況，原本分支的帳戶是空的。
7. **migration 前後比對**（協調者用 H1 的比對資料重跑，2026-10-14）：一般帳戶 a1 845 → 845、a2 2000 → 2000；8 個對象的往來餘額全部不變；臨時帳戶 u1 −100（H1 回報時是 −140，差的 40 是第 6 項補上的 r6 實收）、u2 55；6 筆分支都符合「還款 ± 分支 = 原本實收」（80、120、45、80、120、40）；對不到還款的舊差額原樣保留；非成員付款、別人替我付的交易帳戶仍是空的。
8. **migration SQL 開發者同意**（2026-10-14）。驗收 H1 時協調者先在本機合進了整合分支（沒推、沒碰 `ledger_dev`），比 plan 寫的「同意後才合」早一步，已向開發者說明。
9. **H4 結果**：`record-defaults` 單元測試 11、e2e 5 全過；1 萬筆交易五次回應的中位數 6.6ms（目標 < 200ms），不需要加索引。
10. **H2 結果**：付款人規則、`assertSelectableAccount` 全面替換、換帳戶只限「目前在自己的臨時帳戶」；`every-entry-account-payer` 4 條全過。協調者逐行看過 `payer-account-rules.ts`、`transactions.service.ts`、`settlements.service.ts` 的 diff。
11. **H5 結果與協調者補正**：交易表單原本「沒選就用第一個帳戶」被改成只帶「最近一次」，從沒記過帳的新使用者會變成空欄位。協調者補回第三層預設（最近一次 → 第一個可選帳戶）。
12. **H3 退回**：功能正確，但 `debt-entries.service.spec.ts` 從 28 條 `describe`／`it` 刪到 5 條（含與 3h 無關的核心規則：借出正負號、先鎖對象、帳本不能寫就不寫），`debt-recording.ts` 的「為什麼」註解被刪成一行。退回補測試與註解（新的 dispatch，同一個 worktree）。
