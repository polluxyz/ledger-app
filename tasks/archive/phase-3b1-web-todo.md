# 任務清單：3b-1 修訂「以此結清」＋ 3b-1 的 Web 畫面

> 依據：`docs/specs/phase-3b-debts.md`（決策 30～32、SC-D23～SC-D30）、`docs/specs/phase-3b1-web.md`、`tasks/phase-3b1-web-plan.md`。
> 依相依順序排列。worker 模型派工前再確認。

| #   | 任務                                | 負責   | 相依   | PR  |
| --- | ----------------------------------- | ------ | ------ | --- |
| A1  | shared 契約                         | 協調者 | —      | A   |
| A2  | schema + migration                  | 協調者 | A1     | A   |
| A3  | 狀態計算與規則                      | 協調者 | A2     | A   |
| A4  | 測試與 PR A 驗收                    | 協調者 | A3     | A   |
| B1  | `use-debts.ts`＋錯誤訊息            | 協調者 | A 合併 | B   |
| B2  | 借還檢視                            | worker | B1     | B   |
| B3  | 借還分頁的新增表單＋`PaymentFields` | worker | B1     | B   |
| B4  | 債務詳情與明細的連結                | worker | B3     | B   |
| B5  | e2e 與 PR B 驗收                    | 協調者 | B2～B4 | B   |

B2 與 B3 平行派出。worker 不准修改 `packages/shared`、`apps/api`、`use-debts.ts`、既有測試的斷言。

---

## A1｜shared 契約

- `CreateDebtPaymentRequest`：加 `settles?: boolean`；`record` 型別改成 `DebtRecordTarget | null`，註解寫明省略與 `null` 的差別。
- `DebtPayment`：加 `settles: boolean`。
- `Debt`：加 `settlementDifference: number | null`，註解寫明正負號從擁有者角度看。

**驗收**：`pnpm --filter @ledger/shared build`、`pnpm typecheck` 通過。

## A2｜schema + migration

- `DebtPayment.settles Boolean @default(false)`。
- 手寫部分唯一索引（plan §2.3）。**套用前 SQL 已在 plan 給開發者看過；有任何變動要再給一次。**

**驗收**：`prisma migrate status` 無 pending；`psql` 手動對同一筆債務插入兩筆 `settles = true` 且未刪除的還款會被擋下。

## A3｜狀態計算與規則

- 先寫測試看到紅燈：`debt-state.spec.ts`（差額的正負號、結清時 `outstanding = 0`、刪掉結清還款回到 `OPEN`）、`debt-payments.service.spec.ts`（`settles` 跳過超額檢查、`record: null`）、`debts.service.spec.ts`（有結清還款時改本金 → 409）。
- 改 `debt-state.ts` 的 `computeDebtState` 與 `toDebt`。
- 改 `DebtPaymentsService.create`：`settles`、`record: null`、`P2002` 轉 `409 DEBT_NOT_OPEN`。
- 改 `DebtsService.update`：結清後不能改本金。
- DTO：`CreateDebtPaymentDto` 加 `settles`（`@IsOptional() @IsBoolean()`）；`record` 接受 `null`（`@ValidateIf` 區分 `null` 與省略）。OpenAPI 標註正確。

**驗收**：新測試綠燈；3b-1 既有的債務單元測試全部維持綠燈。

## A4｜測試與 PR A 驗收

- `debts.e2e-spec.ts` 補 SC-D23～SC-D30。
- 跑完整 CI 指令組。PR 描述連回 spec 決策 30 與 SC-D23～SC-D30，並標明「動到資料模型與 API」。

**驗收**：CI 全綠；合併後提醒開發者 dev DB 跑 `prisma migrate deploy`。

---

## B1｜`use-debts.ts`＋錯誤訊息

- TanStack Query hooks：`useDebts(query)`、`useDebt(id)`、`useDebtSummary()`、`useCreateDebt()`、`useUpdateDebt()`、`useDeleteDebt()`、`useCreateDebtPayment()`、`useDeleteDebtPayment()`、`useForgiveDebt()`。
- 任何寫入成功後讓以下快取失效：債務列表、單筆、淨額、交易列表、帳戶餘額。
- `lib/error-messages.ts` 補 spec §4.5 的 5 條。

**驗收**：hooks 的單元測試（mock api-client）驗證打的路徑、body 與失效的 query key。

## B2｜借還檢視（worker）

- `TransactionsPage` 加「明細／借還」切換，狀態放在 `?view=debts`。
- `DebtsView`、`DebtSummaryCards`、`DebtList`：spec §4.2。點一列呼叫 `onSelectDebt(id)`（由頁面接到右側欄，B4 接）。

**驗收**：元件測試涵蓋淨額正負號的文字、狀態分頁、空狀態、分頁、舊債標籤；SC-W9。

## B3｜借還分頁的新增表單＋`PaymentFields`（worker）

- `TransactionForm` 加第 4 個分頁「借還」，選了改渲染 `DebtEntryForm`。
- `DebtEntryForm`：借出／借入／還款，spec §4.1。
- `PaymentFields`：金額、日期、帳戶、不記入帳本、以此結清。B4 的記還款視窗要共用。
- body 規則見 plan §2.4。

**驗收**：元件測試涵蓋 SC-W5 的 body、還款明確帶 `record` 或 `record: null`、結清勾選框在少於／等於／多於未清餘額時的顯示與預覽文字；既有 `TransactionForm.test.tsx` 維持綠燈。

## B4｜債務詳情與明細的連結（worker）

- `TransactionsPage` 的右側欄狀態改成 plan §2.5 的聯集。
- `DebtDetail`、`DebtEditDialog`、`DebtPaymentDialog`：spec §4.3。
- `TransactionList`：`debtId` 有值可點、`null` 不可點且沒有可點樣式（spec §4.4）。

**驗收**：元件測試涵蓋按鈕依狀態顯示、確認視窗文案、結清差額取自回應、SC-W6 的可點與不可點；既有 `TransactionWorkbench.test.tsx`、`transaction-edit.test.tsx`、`TransactionList.test.tsx` 維持綠燈。

## B5｜e2e 與 PR B 驗收

- `apps/web/e2e/debts.spec.ts`：SC-W1 → W2 → W3 → W6 → W8，加 SC-W5。
- 審查 `features/debts/` 沒有前端計算（SC-W10）。
- 跑完整 CI 指令組。PR 描述連回 `phase-3b1-web.md`。

**驗收**：SC-W1～SC-W11 全部通過；CI 全綠。
