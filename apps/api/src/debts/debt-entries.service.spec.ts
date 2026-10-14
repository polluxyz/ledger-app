import type { Prisma } from '../generated/prisma/client';
import type { TransactionsService } from '../transactions/transactions.service';
import { deltaFor } from './debt-entry-rules';
import {
  differenceFor,
  forgivenessTypeFor,
  recalculateSettlement,
  voidRepaymentWithSettlement,
  writeDifference,
} from './debt-recording';

/** 結清的五種整數分情境：往來歸零，交易金流與實收相等。 */
describe('debt settlement differences', () => {
  const date = new Date('2026-10-14T12:00:00.000Z');
  const cases = [
    ['少收', 'COLLECT', 9300, 9000, 'EXPENSE', 300],
    ['多收', 'COLLECT', 10000, 10500, 'INCOME', 500],
    ['少付', 'REPAY', 10000, 9500, 'INCOME', 500],
    ['多付', 'REPAY', 10000, 10500, 'EXPENSE', 500],
    ['剛好還清', 'COLLECT', 9300, 9300, null, 0],
  ] as const;

  it.each(cases)(
    '%s keeps the balance zero and cash movement equal to actual amount',
    async (_label, kind, cleared, actual, type, amount) => {
      const before = kind === 'COLLECT' ? cleared : -cleared;
      const delta = deltaFor(kind, cleared);
      expect(before + delta).toBe(0);
      const difference = differenceFor(kind, cleared, actual);
      expect(difference).toEqual(type === null ? null : { type, amount });
      const cashSign = kind === 'COLLECT' ? 1 : -1;
      const branchSign = difference?.type === 'INCOME' ? 1 : -1;
      expect(cashSign * cleared + (difference?.amount ?? 0) * branchSign).toBe(cashSign * actual);

      const transactions = { createDebtDifference: jest.fn().mockResolvedValue('branch') };
      const entry = { id: 'entry', kind, delta, transactionId: 'repayment', date };
      await writeDifference(
        {} as Prisma.TransactionClient,
        transactions as unknown as TransactionsService,
        entry as Prisma.DebtEntryGetPayload<object>,
        actual,
      );
      expect(transactions.createDebtDifference).toHaveBeenCalledTimes(type === null ? 0 : 1);
    },
  );

  it('recalculates, changes direction, and removes a zero difference without changing the repayment', async () => {
    const branch = { id: 'branch', type: 'EXPENSE', amount: 300, deletedAt: null };
    const transaction = {
      findFirst: jest.fn().mockResolvedValue(branch),
      update: jest.fn().mockResolvedValue(branch),
    };
    const tx = {
      transaction,
      debtEntry: { findFirst: jest.fn() },
    } as unknown as Prisma.TransactionClient;
    const repayment = {
      id: 'entry',
      kind: 'COLLECT' as const,
      delta: -9300,
      transactionId: 'repayment',
    };
    expect(await recalculateSettlement(tx, repayment, 9100)).toBe(true);
    expect(transaction.update).toHaveBeenLastCalledWith({
      where: { id: 'branch' },
      data: { type: 'EXPENSE', amount: 200 },
    });
    expect(await recalculateSettlement(tx, repayment, 9500)).toBe(true);
    expect(transaction.update).toHaveBeenLastCalledWith({
      where: { id: 'branch' },
      data: { type: 'INCOME', amount: 200 },
    });
    expect(await recalculateSettlement(tx, repayment, 9300)).toBe(true);
    expect(transaction.update).toHaveBeenLastCalledWith({
      where: { id: 'branch' },
      data: { deletedAt: expect.any(Date) as Date },
    });
  });

  it('withdraws the repayment, branch, and old settlement with one timestamp', async () => {
    const deletedAt = new Date();
    const debtEntry = { updateMany: jest.fn(), update: jest.fn() };
    const transaction = { updateMany: jest.fn() };
    const transactions = { softDeleteDebtTransactions: jest.fn() };
    const tx = { debtEntry, transaction } as unknown as Prisma.TransactionClient;
    await voidRepaymentWithSettlement(
      tx,
      transactions as unknown as TransactionsService,
      { id: 'entry', transactionId: 'repayment' } as Prisma.DebtEntryGetPayload<object>,
      deletedAt,
    );
    expect(debtEntry.updateMany).toHaveBeenCalledWith({
      where: { settlesEntryId: 'entry', deletedAt: null },
      data: { deletedAt },
    });
    expect(transaction.updateMany).toHaveBeenCalledWith({
      where: { differenceOfId: 'repayment', deletedAt: null },
      data: { deletedAt },
    });
    expect(transactions.softDeleteDebtTransactions).toHaveBeenCalledWith(
      tx,
      ['repayment'],
      deletedAt,
    );
  });
});

/** 免除的損益方向固定，由往來紀錄種類決定。 */
describe('forgiveness transaction directions', () => {
  it('records FORGIVE as expense and FORGIVEN as income', () => {
    expect(forgivenessTypeFor('FORGIVE')).toBe('EXPENSE');
    expect(forgivenessTypeFor('FORGIVEN')).toBe('INCOME');
  });
});
