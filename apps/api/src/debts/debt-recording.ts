import type { DebtEntryRecordTarget } from '@ledger/shared';
import type { Prisma } from '../generated/prisma/client';
import type { TransactionsService } from '../transactions/transactions.service';
import { assertLedgerWritable } from './debt-ledger-access';
import { transactionTypeFor } from './debt-entry-rules';

/**
 * 往來帳的三組共用步驟：依帳本記借還交易、記結清分支與免除方向，以及撤銷或重算還款。
 * `DebtEntriesService` 記自己的往來、`DebtProposalsService` 接受對方提議時都呼叫這裡，
 * 才不會讓兩邊的結清金額與方向各算一套。
 *
 * 所有寫入都沿用呼叫端的資料庫交易：往來紀錄、還款交易與分支要一起成功或一起回滾，
 * 否則個人往來餘額與帳本交易會不一致。3h 的差額只是一筆交易，不再新增 `SETTLEMENT`
 * 往來紀錄，因此也不需要舊版差額紀錄晚於還款 `createdAt` 1 毫秒的排序技巧。
 */
type DebtEntryRow = Prisma.DebtEntryGetPayload<object>;

/**
 * 在指定帳本記借還交易，回傳交易 id。先以實際寫入者 `userId` 查帳本權限：
 * 接受提議時，交易寫入接受者的帳本，不能沿用發起者的權限。帳戶歸屬與種類規則
 * 則交給 `TransactionsService`，避免兩個呼叫端各自驗證而有缺口。
 */
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
    categoryId?: string;
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
    categoryId: input.categoryId,
    splitId: input.splitId,
  });
}

/**
 * `diff = 實收 − 還清的欠款`，金額與以下方向都用整數分：
 *
 * | 還款方向 | diff < 0 | diff > 0 |
 * | --- | --- | --- |
 * | COLLECT（對方還我） | 少收，EXPENSE | 多收，INCOME |
 * | REPAY（我還對方） | 少付，INCOME | 多付，EXPENSE |
 *
 * diff 為 0 時已剛好還清，不必產生分支。
 */
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

/** 免除對方欠我的錢是呆帳支出；對方免除我欠的錢是收入，兩者都沒有帳戶金流。 */
export function forgivenessTypeFor(kind: 'FORGIVE' | 'FORGIVEN'): 'EXPENSE' | 'INCOME' {
  return kind === 'FORGIVE' ? 'EXPENSE' : 'INCOME';
}

/**
 * 新的以此結清只寫一筆還款紀錄：其 `delta` 清掉寫入前全部餘額，還款交易金額是欠款額；
 * 實收與它的差額由分支交易記帳。分支沿用還款的帳本、帳戶、建立者與日期，沒有分類。
 * 沒有差額就不寫分支，避免多出零元交易；`differenceOfId` 有 `@unique`，
 * 一筆還款最多只能綁一筆分支。
 */
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

/**
 * 撤銷還款時，還款紀錄、交易與分支共用呼叫者給的 `deletedAt`，稽核時能看出是同一次撤銷。
 * 仍處理 3g 舊資料的 `settlesEntryId` 差額紀錄；它們沒有交易，且不能被單獨撤銷。
 * 一般紀錄沒有分支也走同一路徑，不會誤刪其他交易。
 */
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

/**
 * 有分支的還款把 PATCH 金額當新實收，只改分支方向、金額與可選的日期；還款的 `delta`
 * 與交易金額仍是原本清掉的欠款。既然那筆 `delta` 不變，就不重讀全部往來餘額。
 * 剛好還清時軟刪分支，之後這筆是一般還款；`differenceOfId` 有 `@unique`，
 * 因此同一筆還款不會再建立第二個分支。沒有分支時查 3g 舊版差額：
 * 舊還款的新 `delta` 與舊差額的合計須保持不變，所以差額只扣除還款增量。
 * 兩種分支都沒有時回傳 false，呼叫端照一般還款改 `delta` 與交易金額。
 */
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
