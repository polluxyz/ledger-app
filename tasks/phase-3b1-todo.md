# 任務清單：階段三 (3b-1) — 單邊借還

> 依據：`docs/specs/phase-3b-debts.md`、`tasks/phase-3b1-plan.md`。
> 依相依順序排列。worker 一律是 Claude Code + `claude-opus-5`。

| #   | 任務                     | 負責   | 相依   |
| --- | ------------------------ | ------ | ------ |
| T1  | shared 契約              | 協調者 | —      |
| T2  | schema + migration       | 協調者 | T1     |
| T3  | 餘額加總窮舉             | 協調者 | T2     |
| T4  | 交易端點與帳本刪除的調整 | 協調者 | T2     |
| T5  | 債務模組骨架與共用函式   | 協調者 | T2     |
| T6  | 授權與隔離測試先行       | 協調者 | T5     |
| T7  | `DebtsService`           | W1     | T6     |
| T8  | `DebtPaymentsService`    | W2     | T6     |
| T9  | Web 最小相容改動         | W3     | T1     |
| T10 | 最終驗收                 | 協調者 | T7～T9 |

T7、T8、T9 彼此獨立，平行派出。worker 不准修改 T6 的測試、Prisma schema、shared 契約、controller 與 DTO。

---

## T1｜shared 契約

- `transaction.ts`：`TRANSACTION_TYPES` 擴充為 7 種；新增 `MANUAL_TRANSACTION_TYPES`、`DEBT_TRANSACTION_TYPES`；`Transaction` 加 `debtId: string | null`。
- 新增 `debt.ts`：`DEBT_DIRECTIONS`、`DEBT_STATUSES`、`Debt`、`DebtPayment`、`DebtSummary`、`CreateDebtRequest`、`UpdateDebtRequest`、`CreateDebtPaymentRequest`、`DebtRecordTarget`（`{ ledgerId, accountId? }`）。
- 錯誤碼：`DEBT_OVERPAYMENT`、`DEBT_NOT_OPEN`、`DEBT_NOT_FORGIVABLE`、`DEBT_TRANSACTION_READ_ONLY`、`LEDGER_HAS_DEBT_TRANSACTIONS`。

**驗收**：`pnpm --filter @ledger/shared build` 與 `pnpm typecheck` 通過（Web 此時預期會因 `Record<型別, …>` 失敗，由 T9 修）。

## T2｜schema + migration

- spec §4.1、§4.2 中 3b-1 用到的部分：`TransactionType` 的 4 個新值、`DebtDirection`、`Debt`、`DebtPayment`。`DebtLink`、`DebtProposal` 留到 3b-2。
- 手寫 CHECK：`Debt.principal > 0`、`DebtPayment.amount > 0`。
- **套用前給開發者看 SQL。**

**驗收**：`prisma migrate status` 無 pending；`psql` 手動插入本金 0 的債務會被擋下。

## T3｜餘額加總窮舉

- 先寫測試：7 種型別對餘額的方向（spec §4.1 的表），看到紅燈。
- 改寫 `accounts.service.ts` 為窮舉 `switch`。

**驗收**：新測試綠燈；既有帳戶的單元測試與 e2e 維持綠燈。

## T4｜交易端點與帳本刪除的調整

- create / update DTO 改用 `MANUAL_TRANSACTION_TYPES`。
- `PATCH` / `DELETE` 借還交易 → `409 DEBT_TRANSACTION_READ_ONLY`。
- 回應帶 `debtId`（plan §2.5）。
- `TransactionsService.createDebtTransaction`（plan §2.3）。
- `LedgersService.remove`：帳本內有借還交易（含已軟刪除）→ `409 LEDGER_HAS_DEBT_TRANSACTIONS`。

**驗收**：SC-D8、SC-D9 的單元測試通過；既有交易測試維持綠燈。

## T5｜債務模組骨架與共用函式

- `debt-state.ts`（含單元測試）、`debt-ledger-access.ts`（含單元測試）。
- `debts.module.ts`、兩個 controller、所有 DTO、兩個 service 的空殼（方法簽章固定）。

**驗收**：`pnpm typecheck`、`pnpm lint` 通過；端點出現在 `/docs`。

## T6｜授權與隔離測試先行（SEC-10）

- `test/debts-isolation.e2e-spec.ts`：SC-D10（債務端點與交易端點的帳本授權一致）、SC-D12（帳本其他成員看得到交易、`debtId` 為 `null`、讀不到債務）。
- `test/debts.e2e-spec.ts`：SC-D1～D9、D11 的流程。
- 兩個 service 的「非擁有者一律 404」單元測試。

**驗收**：測試存在，而且在 T7、T8 完成前是紅燈。

## T7｜`DebtsService`（W1）

建立（含選擇性的本金交易）、列表（狀態篩選與分頁）、單筆、修改（本金交易一起改；本金不得小於已還總額）、刪除（plan §2.6）、每人淨額（spec §5.4）。

**驗收**：T6 中屬於 W1 的測試轉綠；自己的單元測試涵蓋每人淨額的分組規則。

## T8｜`DebtPaymentsService`（W2）

記還款（型別依方向決定、超額 409、非 `OPEN` 409）、刪還款（`SETTLED` 回到 `OPEN`）、免除（限 `LENT` 且 `OPEN`）。

**驗收**：T6 中屬於 W2 的測試轉綠；自己的單元測試涵蓋每一條錯誤分支。

## T9｜Web 最小相容改動（W3）

依 spec §7：正負號、顏色、中文標籤；借還交易不顯示編輯與刪除；篩選下拉不加新型別。

**驗收**：`pnpm --filter @ledger/web typecheck`、`lint`、`test` 通過；新增一個元件測試，確認借還交易沒有編輯與刪除按鈕、正負號正確。

## T10｜最終驗收

- 合併 W1～W3，跑兩套 e2e，對照 SC-D1～SC-D12、SC-D22 逐條打勾，寫進 plan 的實作紀錄。
- 更新 spec 狀態與 `docs/README.md`；開 PR。

**驗收**：CI 全綠。
