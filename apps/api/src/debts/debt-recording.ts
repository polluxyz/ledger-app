import type { DebtEntryRecordTarget } from '@ledger/shared';
import type { Prisma } from '../generated/prisma/client';
import type { TransactionsService } from '../transactions/transactions.service';
import { assertLedgerWritable } from './debt-ledger-access';
import { transactionTypeFor } from './debt-entry-rules';

/** 借還的交易、結清分支、撤銷與重算都在呼叫端的資料庫交易內完成。 */
type DebtEntryRow = Prisma.DebtEntryGetPayload<object>;

export async function recordDebtTransaction(
  tx: Prisma.TransactionClient,
  transactions: TransactionsService,
  input: {
    userId: string;
    record: DebtEntryRecordTarget;
    kind: 'LEND' | 'BORROW' | 'COLLECT' | 'REPAY' | 'PAID_FOR_THEM' | 'RECEIVED_FOR_THEM';
    amount: number;
    date: Date;
    title?: string | null;
    splitId?: string;
  },
): Promise<string> {
  await assertLedgerWritable(tx, input.userId, input.record.ledgerId);
  return transactions.createDebtTransaction(tx, {
    ledgerId: input.record.ledgerId,
    creatorId: input.userId,
    type: transactionTypeFor(input.kind),
    amount: input.amount,
    date: input.date,
    accountId: input.record.accountId,
    title: input.title,
    splitId: input.splitId,
  });
}

/** 實收與還清的欠款相減；差額的收支方向由收款或付款決定。 */
export function differenceFor(
  kind: 'COLLECT' | 'REPAY',
  clearedAmount: number,
  actualAmount: number,
): { type: 'EXPENSE' | 'INCOME'; amount: number } | null {
  const difference = actualAmount - clearedAmount;
  if (difference === 0) return null;
  return {
    type: (kind === 'COLLECT') === difference < 0 ? 'EXPENSE' : 'INCOME',
    amount: Math.abs(difference),
  };
}

/** 免除與被免除是相反的損益方向，兩邊都不經過帳戶。 */
export function forgivenessTypeFor(kind: 'FORGIVE' | 'FORGIVEN'): 'EXPENSE' | 'INCOME' {
  return kind === 'FORGIVE' ? 'EXPENSE' : 'INCOME';
}

/** 新結清只有一筆往來紀錄；分支是同帳本、同帳戶的普通收支交易。 */
export async function writeDifference(
  tx: Prisma.TransactionClient,
  transactions: TransactionsService,
  repayment: DebtEntryRow,
  actualAmount: number,
): Promise<void> {
  if (repayment.transactionId === null || !['COLLECT', 'REPAY'].includes(repayment.kind)) return;
  const difference = differenceFor(
    repayment.kind as 'COLLECT' | 'REPAY',
    Math.abs(repayment.delta),
    actualAmount,
  );
  if (difference !== null) {
    await transactions.createDebtDifference(tx, repayment.transactionId, difference);
  }
}

/** 撤銷還款時用同一個時間戳撤銷分支；舊版 SETTLEMENT 紀錄也一併處理。 */
export async function voidRepaymentWithSettlement(
  tx: Prisma.TransactionClient,
  transactions: TransactionsService,
  repayment: DebtEntryRow,
  deletedAt: Date,
): Promise<void> {
  await tx.debtEntry.updateMany({
    where: { settlesEntryId: repayment.id, deletedAt: null },
    data: { deletedAt },
  });
  await tx.debtEntry.update({ where: { id: repayment.id }, data: { deletedAt } });
  if (repayment.transactionId !== null) {
    await tx.transaction.updateMany({
      where: { differenceOfId: repayment.transactionId, deletedAt: null },
      data: { deletedAt },
    });
    await transactions.softDeleteDebtTransactions(tx, [repayment.transactionId], deletedAt);
  }
}

/** 有分支時 PATCH 的金額是新實收，還清的欠款保持不變；沒有分支則沿用一般還款。 */
export async function recalculateSettlement(
  tx: Prisma.TransactionClient,
  repayment: Pick<DebtEntryRow, 'id' | 'kind' | 'delta' | 'transactionId'>,
  actualAmount: number,
  date?: Date,
): Promise<boolean> {
  if (
    repayment.transactionId !== null &&
    (repayment.kind === 'COLLECT' || repayment.kind === 'REPAY')
  ) {
    const branch = await tx.transaction.findFirst({
      where: { differenceOfId: repayment.transactionId, deletedAt: null },
    });
    if (branch !== null) {
      const next = differenceFor(repayment.kind, Math.abs(repayment.delta), actualAmount);
      await tx.transaction.update({
        where: { id: branch.id },
        data:
          next === null
            ? { deletedAt: new Date() }
            : { type: next.type, amount: next.amount, ...(date !== undefined ? { date } : {}) },
      });
      return true;
    }
  }
  const settlement = await tx.debtEntry.findFirst({
    where: { settlesEntryId: repayment.id, deletedAt: null },
  });
  if (settlement === null) return false;
  const nextDelta =
    settlement.delta - (Math.sign(repayment.delta) * actualAmount - repayment.delta);
  await tx.debtEntry.update({
    where: { id: settlement.id },
    data: nextDelta === 0 ? { deletedAt: new Date() } : { delta: nextDelta },
  });
  return false;
}
