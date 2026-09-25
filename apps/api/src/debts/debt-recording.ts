import type { DebtEntryRecordTarget } from '@ledger/shared';
import type { Prisma } from '../generated/prisma/client';
import type { TransactionsService } from '../transactions/transactions.service';
import { assertLedgerWritable } from './debt-ledger-access';
import { currentBalance, transactionTypeFor } from './debt-entry-rules';

/**
 * 「記一筆往來」時會寫到的兩件附帶的東西：交易與結清差額。
 *
 * 使用者自己記一筆（`DebtEntriesService.create`）與接受對方的提議
 * （`DebtProposalsService.accept`）走的是同一套規則，所以抽到這裡共用，不寫兩份。
 * 兩個函式都必須在呼叫端的資料庫交易裡執行。
 */

type DebtEntryRow = Prisma.DebtEntryGetPayload<object>;

/**
 * 依 `record` 產生借還交易，回傳交易 id；`record: null` 就不產生（決策 7）。
 *
 * 帳本權限以 `userId`（寫入者本人）檢查：不是成員、只有 VIEWER、或已封存，整個資料庫
 * 交易就回滾。帳戶規則（連動帳本必填、帳戶屬於本人）由 `TransactionsService` 把關。
 * 接受提議時 `userId` 是**接受者**——寫進誰的帳，就以誰的身分檢查。
 */
export async function recordDebtTransaction(
  tx: Prisma.TransactionClient,
  transactions: TransactionsService,
  input: {
    userId: string;
    record: DebtEntryRecordTarget | null;
    kind: 'LEND' | 'BORROW' | 'COLLECT' | 'REPAY';
    amount: number;
    date: Date;
  },
): Promise<string | null> {
  if (input.record === null) {
    return null;
  }
  await assertLedgerWritable(tx, input.userId, input.record.ledgerId);
  return transactions.createDebtTransaction(tx, {
    ledgerId: input.record.ledgerId,
    creatorId: input.userId,
    type: transactionTypeFor(input.kind),
    amount: input.amount,
    date: input.date,
    accountId: input.record.accountId,
  });
}

/**
 * 以此結清（決策 38）：讓往來餘額歸零。差額 `delta = −(寫入還款之後的餘額)`：正數表示對我
 * 有利（對方多給、或我少付），負數表示對我不利（spec 3b §3.3）。剛好還清就不必補，回傳 `null`。
 */
export async function writeSettlement(
  tx: Prisma.TransactionClient,
  counterpartyId: string,
  repayment: DebtEntryRow,
): Promise<DebtEntryRow | null> {
  const remaining = await currentBalance(tx, counterpartyId);
  if (remaining === 0) {
    return null;
  }
  return tx.debtEntry.create({
    data: {
      counterpartyId,
      kind: 'SETTLEMENT',
      delta: -remaining,
      date: repayment.date,
      note: null,
      transactionId: null,
      // 同一天的紀錄依建立時間排序（SC-L13），而 createdAt 只到毫秒：兩筆在同一毫秒寫入
      // 時順序不固定，差額可能排到還款前面。明確晚 1 毫秒，讓它永遠緊接在還款之後。
      createdAt: new Date(repayment.createdAt.getTime() + 1),
    },
  });
}
