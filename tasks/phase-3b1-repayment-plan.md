# 實作計畫：3b-1 往來帳版修訂 1（還款合併）

> 依據：`docs/specs/phase-3b-debts.md` §2.3（決策 46～50）、§3.2.1、SC-L17～L21；`docs/specs/phase-3b1-web.md` §2.1（W17～W21）、SC-W31～W34。
> 分支：`feature/3b1-repayment-merge`。後端與畫面一個 PR（改動小，拆開反而要處理中間狀態：後端先拒收 `COLLECT`／`REPAY`，舊畫面就壞了）。

## 影響範圍

- **資料模型**：不改。`DebtEntryKind` 仍存 `COLLECT`／`REPAY`；不需要 migration。
- **API 介面**（開發者已同意假設 7）：`POST /debt-entries` 的 `kind` 改成 `LEND | BORROW | REPAYMENT | PAID_FOR_ME`；新增 2 個 409 錯誤碼。受影響的前端只有 Web（App 尚未建立）。
- **新增套件、CI**：無。

## 元件與相依

```
A1 shared 契約 ──► A2 後端規則（純函式＋單元測試） ──► A3 service：鎖、方向、超額 ──► A4 後端 e2e
      │
      └──────────► B1 web 表單（worker） ──► B2 web e2e 與整體驗收
```

### A1 shared 契約（協調者）

- `packages/shared/src/types/debt.ts`：
  - `MANUAL_DEBT_ENTRY_KINDS` 改名語意為「`POST` 接受的種類」：`['LEND', 'BORROW', 'REPAYMENT', 'PAID_FOR_ME']`，型別 `CreateDebtEntryKind`。
  - `SETTLEABLE_DEBT_ENTRY_KINDS` → `['REPAYMENT']`。
  - `DebtEntryKind`（存下來的 7 種）不變。
- `error-codes.ts`：`NOTHING_TO_REPAY`、`REPAYMENT_EXCEEDS_BALANCE`。

### A2 後端規則（協調者）

`debt-entry-rules.ts` 新增純函式，單元測試涵蓋 spec §3.2.1 的表格：

- `resolveRepayment(balance, amount, settle)` → `{ kind: 'COLLECT' | 'REPAY', delta }`，或丟對應的 409。
- `DELTA_SIGN` 改成只涵蓋存下來的使用者種類（`LEND`、`BORROW`、`COLLECT`、`REPAY`、`PAID_FOR_ME`）；`deltaFor` 不再接 `REPAYMENT`。

### A3 service（協調者：授權、並發、API 介面）

- `create`：`resolveCounterparty` 之後 `lockCounterparty(tx, id)`（`SELECT id FROM "Counterparty" WHERE id = $1 FOR UPDATE`，走 `$queryRaw` 樣板參數化）。`REPAYMENT` 先讀餘額、`resolveRepayment` 決定種類，**再**建立交易（交易型別要跟著方向）。
- `update`、`remove`：不改（決策 48：修改與刪除不擋）。
- `assertEntryShape`：`settle` 只允許 `REPAYMENT`。
- DTO：`@IsIn` 改用新的種類清單；OpenAPI 描述同步。
- `settle` 路徑的鎖同時修掉結清差額的競態（決策 50）。

### A4 後端 e2e（協調者）

- `debts.e2e-spec.ts`：SC-L3 改寫；新增 SC-L17～L21。把原本送 `COLLECT`／`REPAY` 的步驟改送 `REPAYMENT`。
- `debts-isolation.e2e-spec.ts`：送 `COLLECT`／`REPAY` 的地方同步改。
- 需要「我欠對方」狀態時用 `BORROW` 建立。

### B1 Web 表單（worker：Codex `gpt-6-luna` max）

- `DebtEntryForm.tsx`：種類 3 個；還款的方向說明、帳戶標籤、停用狀態、超額提示、送出鈕停用、換對象時退回借出（W17～W21）。`kind: 'REPAYMENT'` 送出。預覽沿用 W16 的例外。
- `lib/error-messages.ts`：2 個新訊息。
- `CounterpartyDetail.tsx`、`TransactionList.tsx`：`COLLECT`／`REPAY`／`PAID_FOR_ME` 的既有顯示不變（只確認，不改）。
- 元件測試：SC-W31～W34，改寫原本「對方還我」「對方幫我付」的測試。

### B2 web e2e 與驗收（協調者）

- `apps/web/e2e/debts.spec.ts`：SC-W22 改用「還款」；SC-W23 的代付主線拿掉（改由元件測試驗既有紀錄顯示）；加 SC-W33、W34 的主線。
- 完整 CI：format:check、lint、typecheck、test、build、兩套 e2e。

## 風險與對策

| 風險                                                    | 對策                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 前端判斷方向與後端不一致（前端的餘額快取過期）          | 前端只做說明與預覽；方向以後端為準。送出後以回應更新畫面，409 顯示後端訊息並重新取對象餘額 |
| `FOR UPDATE` 在 Prisma interactive transaction 裡的行為 | SC-L21 用 `Promise.all` 真的同時送出驗證；e2e 對 PostgreSQL 跑，不是 mock                  |
| 既有 dev 資料有翻轉過的紀錄（截圖裡的「我還對方 +1」）  | 不遷移。那是歷史紀錄；開發者可自行刪除                                                     |

## 驗證點

1. A2 完成：`pnpm --filter api test -- debt-entry-rules` 綠。
2. A4 完成：`debts*.e2e-spec.ts` 綠。
3. B1 驗收：看完整 diff；元件測試綠。
4. 合併前：完整 CI 綠。之後提醒開發者 `pnpm build` 重開 API、重開 Vite。

## 實作紀錄

（實作時補）
