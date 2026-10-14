import type { DebtEntryKind } from './types/debt';
import type { TransactionType } from './types/transaction';

/**
 * 沒有分類的交易用的名稱（3h 決策 171、175）：以此結清的分支、免除產生的呆帳與債務免除。
 *
 * 這些交易刻意不掛分類（不必每本帳本都建一個「借還差額」分類），畫面改用名稱顯示。名稱由
 * 型別決定，規則寫在這裡一處，Web 與之後的 App 都呼叫它，前端不自己判斷方向（spec §7 Never）。
 */

/** 以此結清的分支名稱（決策 171）。 */
export type DifferenceLabel = '少收' | '多收' | '少付' | '多付';

/**
 * 分支的名稱，看還款的方向與分支的收支：
 *
 * | 還款                   | 分支 `EXPENSE` | 分支 `INCOME` |
 * | ---------------------- | -------------- | ------------- |
 * | `COLLECT`（對方還我）  | 少收           | 多收          |
 * | `REPAY`（我還對方）    | 多付           | 少付          |
 *
 * 其他還款型別不會有分支，回 `null`。
 */
export function differenceLabelOf(
  repaymentType: TransactionType,
  differenceType: 'EXPENSE' | 'INCOME',
): DifferenceLabel | null {
  if (repaymentType === 'COLLECT') return differenceType === 'EXPENSE' ? '少收' : '多收';
  if (repaymentType === 'REPAY') return differenceType === 'EXPENSE' ? '多付' : '少付';
  return null;
}

/**
 * 以此結清的還款實際收付了多少（決策 170）：還款記的是還清的欠款，分支補上差。
 *
 * - 對方還我（`COLLECT`，錢進來）：分支 `INCOME`（多收）加、`EXPENSE`（少收）減。
 * - 我還對方（`REPAY`，錢出去）：分支 `EXPENSE`（多付）加、`INCOME`（少付）減。
 *
 * 修改表單要帶入的就是這個數字（`PATCH /debt-entries/{id}` 的 `amount` 是實際收付）。沒有分支
 * 時就是還清的欠款本身。金額都是分。
 */
export function actualAmountOf(
  repaymentType: 'COLLECT' | 'REPAY',
  clearedAmount: number,
  difference: { type: 'EXPENSE' | 'INCOME'; amount: number } | null,
): number {
  if (difference === null) return clearedAmount;
  const adds = repaymentType === 'COLLECT' ? 'INCOME' : 'EXPENSE';
  return difference.type === adds
    ? clearedAmount + difference.amount
    : clearedAmount - difference.amount;
}

/** 免除產生的交易名稱（決策 162）。 */
export type ForgivenessLabel = '呆帳' | '債務免除';

/** 免除別人（`FORGIVE`）是「呆帳」，被免除（`FORGIVEN`）是「債務免除」；其他種類回 `null`。 */
export function forgivenessLabelOf(kind: DebtEntryKind): ForgivenessLabel | null {
  if (kind === 'FORGIVE') return '呆帳';
  if (kind === 'FORGIVEN') return '債務免除';
  return null;
}
