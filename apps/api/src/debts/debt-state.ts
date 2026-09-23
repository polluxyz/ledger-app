import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@ledger/shared';
import type { Debt, DebtDirection, DebtStatus, DebtTransactionType } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import type { Prisma } from '../generated/prisma/client';

/**
 * 債務的共用規則：狀態怎麼算、資料列怎麼轉成回應、怎麼安全地讀出「我的」債務。
 * `DebtsService`（W1）與 `DebtPaymentsService`（W2）**一律經過這裡**，不要各自重寫。
 *
 * 兩條貫穿全檔的規則：
 * - **未清餘額與狀態是算出來的**，不存在資料庫（spec 決策 5）。存下來的數字只要有一條
 *   路徑忘了更新，就會永遠錯下去。
 * - **債務只屬於擁有者**。不是自己的、已刪除的、根本不存在的，一律同樣的 404——三者
 *   若給出不同回應，就等於提供了一個探測他人債務 id 的管道。
 */

/** 讀債務時一律帶出的關聯：還款（含已刪除，由算式自己過濾），以及本金交易的帳本與帳戶。 */
export const DEBT_INCLUDE = {
  payments: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] },
  transaction: { select: { ledgerId: true, accountId: true } },
} satisfies Prisma.DebtInclude;

export type DebtRow = Prisma.DebtGetPayload<{ include: typeof DEBT_INCLUDE }>;

/** 能讀寫債務的 client：一般的 PrismaService，或 `$transaction` 裡的 tx。 */
type DebtClient = Pick<Prisma.TransactionClient, 'debt'>;

/**
 * 由本金、還款與是否免除算出未清餘額與狀態（spec §3.2）。已軟刪除的還款不計入。
 *
 * 已免除的債務照樣回傳算出的未清餘額（那是被免除掉的金額），是否還要收由 `status` 判斷。
 */
export function computeDebtState(debt: {
  principal: number;
  forgivenAt: Date | null;
  payments: ReadonlyArray<{ amount: number; deletedAt: Date | null }>;
}): { outstanding: number; status: DebtStatus } {
  const paid = debt.payments
    .filter((payment) => payment.deletedAt === null)
    .reduce((sum, payment) => sum + payment.amount, 0);
  const outstanding = debt.principal - paid;

  if (debt.forgivenAt !== null) {
    return { outstanding, status: 'FORGIVEN' };
  }
  return { outstanding, status: outstanding > 0 ? 'OPEN' : 'SETTLED' };
}

/** 已還總額（不含已刪除的還款）。改本金時用來確認新本金不小於它。 */
export function paidTotal(payments: ReadonlyArray<{ amount: number; deletedAt: Date | null }>) {
  return payments
    .filter((payment) => payment.deletedAt === null)
    .reduce((sum, payment) => sum + payment.amount, 0);
}

/** 本金那筆交易的型別：我借出 → `LEND`（錢出去）；我借入 → `BORROW`（錢進來）。 */
export function principalTransactionType(direction: DebtDirection): DebtTransactionType {
  return direction === 'LENT' ? 'LEND' : 'BORROW';
}

/**
 * 還款交易的型別，由方向決定，使用者不能指定（spec 決策 3）：我借出的債務收到還款是
 * `COLLECT`（錢進來）；我借入的債務還錢是 `REPAY`（錢出去）。債權人不可能是還錢的那一方。
 */
export function paymentTransactionType(direction: DebtDirection): DebtTransactionType {
  return direction === 'LENT' ? 'COLLECT' : 'REPAY';
}

/** 資料列轉成回應。已刪除的還款不出現在 `payments`。 */
export function toDebt(row: DebtRow): Debt {
  const { outstanding, status } = computeDebtState(row);
  return {
    id: row.id,
    direction: row.direction,
    counterpartyName: row.counterpartyName,
    principal: row.principal,
    date: row.date.toISOString(),
    note: row.note,
    outstanding,
    status,
    transactionId: row.transactionId,
    payments: row.payments
      .filter((payment) => payment.deletedAt === null)
      .map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        date: payment.date.toISOString(),
        note: payment.note,
        transactionId: payment.transactionId,
        createdAt: payment.createdAt.toISOString(),
      })),
    forgivenAt: row.forgivenAt === null ? null : row.forgivenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * 讀出呼叫者自己的、未刪除的債務。其餘情況一律 404（見檔頭第二條）。
 *
 * 在 `$transaction` 裡呼叫時傳 tx，讀與後續的寫才在同一個資料庫交易中。
 */
export async function loadOwnedDebt(
  client: DebtClient,
  userId: string,
  debtId: string,
): Promise<DebtRow> {
  const row = await client.debt.findFirst({
    where: { id: debtId, ownerId: userId, deletedAt: null },
    include: DEBT_INCLUDE,
  });
  if (row === null) {
    throw debtNotFound();
  }
  return row;
}

export function debtNotFound(): AppException {
  return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Debt not found.');
}

export function debtNotOpen(): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.DEBT_NOT_OPEN,
    'This debt is already settled or forgiven.',
  );
}

export function debtOverpayment(): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.DEBT_OVERPAYMENT,
    'The amount would make the total repaid exceed the principal.',
  );
}
