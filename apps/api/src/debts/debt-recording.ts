import type { DebtEntryRecordTarget } from '@ledger/shared';
import type { Prisma } from '../generated/prisma/client';
import type { TransactionsService } from '../transactions/transactions.service';
import { assertLedgerWritable } from './debt-ledger-access';
import { currentBalance, transactionTypeFor } from './debt-entry-rules';

/**
 * 往來帳寫入的三個共用步驟：借還交易、結清差額、以及「撤銷還款＋差額」／「重算差額」（3g
 * 決策 156～158）。
 *
 * 使用者自己記一筆（`DebtEntriesService.create`）與接受對方的提議（`DebtProposalsService.accept`）
 * 走的是同一套規則，所以抽到這裡共用，不寫兩份。所有函式都必須在呼叫端的資料庫交易裡執行。
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
    kind: 'LEND' | 'BORROW' | 'COLLECT' | 'REPAY' | 'PAID_FOR_THEM' | 'RECEIVED_FOR_THEM';
    amount: number;
    date: Date;
    title?: string | null;
    splitId?: string;
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
    title: input.title,
    splitId: input.splitId,
  });
}

/**
 * 以此結清（決策 38）：讓往來餘額歸零。差額 `delta = −(寫入還款之後的餘額)`：正數表示對我
 * 有利（對方多給、或我少付），負數表示對我不利（spec 3b §3.3）。剛好還清就不必補，回傳 `null`。
 *
 * 差額同時記下它屬於哪一筆還款（3g 決策 156）：`settlesEntryId = repayment.id`。之後撤銷或
 * 修改那筆還款時，後端會一并處理差額，差額不能單獨撤銷（決策 157）。
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
      settlesEntryId: repayment.id,
      // 同一天的紀錄依建立時間排序（SC-L13），而 createdAt 只到毫秒：兩筆在同一毫秒寫入
      // 時順序不固定，差額可能排到還款前面。明確晚 1 毫秒，讓它永遠緊接在還款之後。
      createdAt: new Date(repayment.createdAt.getTime() + 1),
    },
  });
}

/**
 * 撤銷還款＋差額（3g 決策 156）：軟刪除還款與它綁定的差額，用同一個 `deletedAt`，稽核時看得出
 * 是同一次撤銷。差額不產生交易，所以只要還款自己的交易要作廢。沒有綁定差額時（一般還款、
 * 或 3g 之前的舊資料）就只撤還款，行為跟以前一樣。
 *
 * 自己記的（`DebtEntriesService.remove`）與接受對方的刪除提議（`DebtProposalsService` 的
 * `acceptDelete`）都走這裡，不各寫一份。必須在呼叫端的資料庫交易裡執行。
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
  await transactions.softDeleteDebtTransactions(
    tx,
    repayment.transactionId === null ? [] : [repayment.transactionId],
    deletedAt,
  );
}

/**
 * 重算差額（3g 決策 158）：還款的 `delta` 從 `repayment.delta`（改之前）變成 `newDelta` 時，
 * 綁定的差額跟著調整成 `舊差額 − (newDelta − oldDelta)`。還款與差額兩筆的合計不變，所以往來
 * 餘額不變（結清後仍然歸零）；改成超過原本欠款也可以，差額方向跟著反過來。不重讀餘額來算——
 * 餘額是全部紀錄加總，只要兩筆合計不變，它就不變。
 *
 * 重算結果是 0（還款金額剛好還清）就軟刪除差額，之後那筆是一般還款。沒有綁定差額時什麼都不做
 * （一般還款、或差額已被撤銷）。必須在呼叫端的資料庫交易裡執行。
 */
export async function recalculateSettlement(
  tx: Prisma.TransactionClient,
  repayment: Pick<DebtEntryRow, 'id' | 'delta'>,
  newDelta: number,
): Promise<void> {
  const settlement = await tx.debtEntry.findFirst({
    where: { settlesEntryId: repayment.id, deletedAt: null },
  });
  if (settlement === null) {
    return;
  }
  const nextDelta = settlement.delta - (newDelta - repayment.delta);
  if (nextDelta === 0) {
    // 剛好還清：差額沒有存在的理由，撤銷它（軟刪除）。settlesEntryId 留著也無妨：它指向的
    // 還款還在，只是差額本身已刪；同一筆還款不會再產生新的差額（writeSettlement 只在新增時
    // 執行），unique 約束不會被踩到。
    await tx.debtEntry.update({ where: { id: settlement.id }, data: { deletedAt: new Date() } });
    return;
  }
  await tx.debtEntry.update({ where: { id: settlement.id }, data: { delta: nextDelta } });
}
