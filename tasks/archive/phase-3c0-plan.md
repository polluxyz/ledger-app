# 3c-0 實作計畫：金額單位改成分

spec：`docs/specs/phase-3c0-money-cents.md`（決策 M1～M8、SC-M1～SC-M10）。一個 PR，後端、shared、Web 一起改。

## 1. 元件與相依

- **`packages/shared/src/money.ts`（新）**：`Cents`、`formatMoney`、`centsToInput`、`parseMoneyInput`（spec §4），加上上下限常數 `MAX_AMOUNT_CENTS = 2_000_000_000`、`MAX_INITIAL_BALANCE_CENTS = 2_000_000_000`。`parseMoneyInput` 用正規表示式 `^-?\d+(\.\d{1,2})?$` 檢查（先去掉千分位逗號與前後空白），整數部分與小數部分分開轉成整數再組合，不經過浮點數。
- **shared 的單元測試**：shared 目前沒有測試工具。用 **Node 內建的 test runner**（`node:test`、`node:assert`），**不新增套件**。新增 `tsconfig.test.json` 把 `src/**/*.test.ts` 編譯到 `dist-test/`，`package.json` 加 `"test": "tsc -p tsconfig.test.json && node --test dist-test/"`。主 `tsconfig.json` 排除 `*.test.ts`，`dist-test` 加進 `.gitignore` 與 `.prettierignore`。根目錄的 `pnpm test` 是 `pnpm -r test`，會自動跑到它；CI 設定不用改。
- **migration `…_money_to_cents`（新）**：schema 沒有變（仍是 `Int`），只有資料換算，手寫一份 SQL：`Transaction.amount`、`Account."initialBalance"`、`DebtEntry.delta`、`DebtProposal.amount` 各 `× 100`。`schema.prisma` 只改這 4 個欄位的註解（單位：分）。
- **後端 DTO**：`create/update-transaction.dto.ts`、`create/update-debt-entry.dto.ts` 的 `amount` 加 `@Max(MAX_AMOUNT_CENTS)`；`create-account.dto.ts` 的 `initialBalance` 加 `@Min(-MAX…)`、`@Max(MAX…)`。所有金額欄位的 `@ApiProperty` 說明加「單位：分」，`example` ×100。
- **shared 型別**：`account.ts`、`transaction.ts`、`debt.ts` 的金額欄位改用 `Cents` 型別別名、註解改成「單位：分」（`Transaction.amount` 的註解目前寫「TWD 的最小單位即為元」）。
- **Web**：`lib/format.ts` 的 `formatAmount`、`formatMoney`、`formatTransactionAmount` 改成以分為輸入，內部呼叫 shared 的 `formatMoney`。4 個表單改走 `parseMoneyInput`、`centsToInput`，`inputMode="decimal"`、`step="0.01"`：`TransactionForm`、`DebtEntryForm`、`DebtEntryEditDialog`、`AccountDialog`（期初餘額 `allowNegative`）。其餘顯示金額的元件（`AccountBalances`、`AccountList`、`CounterpartyDetail`、`CounterpartyList`、`CounterpartyPicker`、`PendingCard`、`TransactionList`、`TransactionWorkbench`、`HomePage`）確認都經過 `format.ts`。

## 2. 實作順序

1. **T1（協調者）**：shared `money.ts` 的型別與單元測試先寫、看到紅燈，再實作到綠燈。測試案例涵蓋 spec §4 註解的每一個例子與 SC-M7。
2. **T2、T3 平行**（都只依賴 T1）：
   - T2 後端：migration、DTO 上下限、OpenAPI 說明、shared 型別註解、API e2e 補 SC-M5、SC-M6。
   - T3 Web：`format.ts` 與 4 個表單、元件測試的 API 假資料 ×100、Web e2e 用 API 建資料的金額 ×100、補 SC-M2、SC-M3。
3. **T4（協調者）**：合併 T2、T3，跑全套檢查與兩套 e2e（依序），手動驗 SC-M1，grep 驗 SC-M9，開 PR。

## 3. 風險與對策

| 風險                                       | 對策                                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 某個畫面漏改，顯示成 100 倍或 1/100        | Web 不准有 `* 100`、`/ 100`、`toFixed`（SC-M9 grep）。Web e2e 對帳戶餘額、交易、往來餘額、待確認卡片各至少斷言一次金額                                |
| 表單漏改，`Number(amount)` 直接送出元      | T3 先 grep `Number(` 盤點 4 個表單之外有沒有別的金額輸入；協調者驗收時再 grep 一次                                                                    |
| Prisma `_sum` 加總超過 int4                | SC-M6 在 API e2e 實測。不過就改成在 service 裡逐筆加總，記進實作紀錄                                                                                  |
| `toLocaleString('zh-TW')` 在 Node 測試環境 | Node 22 內建完整 ICU；shared 的測試直接斷言 `$3,000`，跑不過就改用自己寫的千分位                                                                      |
| T2、T3 平行改到同一個檔案                  | 只有 shared 型別註解可能重疊。分工：shared 的檔案只有 T2 能改（T1 之後），T3 只改 `apps/web`                                                          |
| 開發者 dev 伺服器跑舊的 build              | 合併後替開發者在 `web-redesign` worktree `git checkout --detach origin/main`、重建 shared 與 API、`prisma migrate deploy`，再請開發者重開 API 與 Vite |

## 4. 驗證點

- T1：`pnpm --filter @ledger/shared test` 全綠。
- T2：API 單元測試與 API e2e 全綠；SC-M5、SC-M6 有對應測試。
- T3：Web 單元測試與 Web e2e 全綠；SC-M2、SC-M3 有對應斷言。
- T4：
  - `pnpm lint / typecheck / test / build / format:check`；API e2e、Web e2e 依序跑（不同時）。
  - SC-M1 手動：在 e2e 資料庫先用 `main` 的程式灌一組資料（帳戶、交易、往來、提議），記下 `GET /accounts`、`GET /counterparties`、交易列表的回應；跑 migration 後再取一次，比對每個金額剛好 ×100。
  - SC-M9：`grep -rnE "\* ?100|/ ?100|toFixed" apps/web/src --include=*.tsx`，除了測試以外沒有結果。
  - `prisma migrate status` 沒有 pending。

## 5. 派工

- T1 由協調者自己做（`packages/shared` 的型別契約與測試，`CLAUDE.md` §11 的例外）。
- **T2 派 Codex `gpt-6-sol`（xhigh）**：涉及 migration 與 API 介面，依 `CLAUDE.md` §11 只能派這一層。
- **T3 派 Codex `gpt-6-luna`（max）**：純前端；額度用盡照備援順序往下換。
- T2、T3 各自一個 worktree、一個分支，都從 T1 的 commit 開出。協調者驗收兩邊的完整 diff 後合進同一個 PR 分支。
- 同時只有一個 worktree 跑 e2e：T2 跑 API e2e 時，T3 只跑單元測試；Web e2e 由協調者在 T4 統一跑。

## 6. 之後

3c 後端的 plan 等 3c-0 合併後再寫，要以改完單位的程式為準。

## 7. 實作紀錄

1. **T1 只寫契約，不實作**（2026-10-03）：開發者核可 plan 時要求「盡量調度 worker」。協調者寫 `money.ts` 的簽名、常數與 `money.test.ts`（紅燈），實作併進 T3 派給 worker。T2 只需要常數與 `Cents` 型別，所以 T2、T3 可以立刻平行開工。
2. **shared 的測試直接跑 `.ts`**：`packages/shared` 解析不到 `@types/node`（pnpm 不提升相依），照 §1 原本的「tsc 編譯再跑」就得新增相依。改成 `node --test "src/**/*.test.ts"`，靠 Node 22.18 起預設開啟的型別剝除；測試檔用 `./money.ts` 帶副檔名 import，並從主 `tsconfig.json` 排除。CI 的 `.node-version` 是 `22`，會裝到最新的 22.x。不新增套件、不改 CI。`dist-test` 因此不需要，`.gitignore`、`.prettierignore` 不改。
3. **派工**：T2 `ctx_74839aac153f`（worktree `money-cents-api`）、T3 `ctx_d4ff0eebcd78`（worktree `money-cents-web`），Run `run_c1865dc5b0a2`。兩個 Codex 啟動時都跳出更新提示，選「Skip until next version」後重開終端機。兩個 worktree 開得比 docs PR #86 合併早，看不到 spec 與 plan；請 worker 把 `refactor/money-cents` 併進自己的分支解決。
4. **驗收時的修正**：
   - T3 為了讓 SC-M9 的 grep 沒有結果，把 `DebtEntryForm`、`TransactionForm` 滑動方塊的 `translateX(${index * 100}%)` 改成字串拼接 `${index}00%`。那個 `* 100` 是 CSS 百分比、不是金額，改寫只讓程式更難讀。協調者改回原寫法；SC-M9 的判讀改成「grep 結果只剩 CSS 百分比這兩處」。
   - T2 的 SC-M5 只測了期初餘額的負向上限，協調者補上 `+2_000_000_001` → 400。
5. **SC-M1 改在開發者的 dev 資料上做**：e2e 資料庫每個測試前都清空，在上面灌資料再比對，證明的只是 4 行 `UPDATE` 本身。改成合併後替開發者部署時，先 `pg_dump` 備份 dev 資料庫，記下 4 個金額欄位的筆數與總和，跑 migration 後確認每個總和剛好 ×100。這比原計畫更接近 spec SC-M1 的「同一份 dev 資料」。
6. **Web e2e 漏改 7 處**：`debts.spec.ts`、`debt-linking.spec.ts` 在畫面輸入元（`120`），再用 API 讀現金餘額（分）比對 `before - 120`。T3 只改了「用 API 建資料」的金額，漏了這種「畫面輸入、API 斷言」的組合。協調者改成分，並在兩個檔的 `cash()` 上註明單位。
7. **本機 Vite 快取**：第一次跑 Web e2e 有 37 個失敗，全部是 `formatMoney is not a function`。原因是 `apps/web/node_modules/.vite` 裡 `@ledger/shared` 的預先打包是 09-25 的舊版（`vite.config.ts` 的 `optimizeDeps` 註解已寫明改了 shared 要重開）。刪掉快取後重跑。CI 每次都是乾淨環境，不受影響；替開發者部署時要一併刪掉 `web-redesign` 的快取。
8. **驗證**（合併後的 `refactor/money-cents`）：format:check、lint、typecheck、build 通過；單元測試 shared 52、API 320、Web 548；API e2e 145、Web e2e 47 全綠（依序跑）。
9. **SC-M1 通過**（2026-10-03，#87 合併後部署到開發者的 dev 資料庫時）：先 `pg_dump` 備份。migration 前後，4 個金額欄位的筆數不變（交易 22、帳戶 30、往來 6、提議 1），總和與絕對值總和都剛好 ×100（交易 6,107 → 610,700、往來絕對值 448 → 44,800、提議 123 → 12,300），最大值 1,234 → 123,400。同時刪掉 `web-redesign` 的 Vite 快取。
