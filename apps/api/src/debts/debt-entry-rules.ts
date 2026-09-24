import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@ledger/shared';
import type {
  Counterparty,
  DebtEntry,
  DebtEntryKind,
  DebtTransactionType,
  ManualDebtEntryKind,
} from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import type { Prisma } from '../generated/prisma/client';

/**
 * 往來帳（spec 3b 往來帳版）的共用規則：`delta` 的正負號、往來餘額與 `balanceAfter` 怎麼算、
 * 資料列怎麼轉成回應、怎麼安全地讀出「我的」對象與紀錄。兩個 service 一律經過這裡。
 *
 * 兩條貫穿全檔的規則：
 * - **往來餘額是算出來的**（決策 34）：未刪除紀錄的 `delta` 加總，不存欄位。
 * - **對象與紀錄只屬於擁有者**。不是自己的、已刪除的、根本不存在的，一律同樣的 404——三者
 *   若給出不同回應，就等於提供了一個探測他人資料 id 的管道。
 */

/** 能讀寫往來帳的 client：一般的 PrismaService，或 `$transaction` 裡的 tx。 */
type DebtClient = Pick<Prisma.TransactionClient, 'counterparty' | 'debtEntry'>;

/**
 * 使用者記的 5 種往來，`delta` 的正負號（spec §3.2）。正數＝這筆讓對方多欠我。
 *
 * 借出、我還對方：錢從我這邊出去，對方多欠我（或我少欠對方）。
 * 借入、對方還我、對方幫我付：對方的錢到了我這邊（或花在我身上），我多欠對方。
 */
const DELTA_SIGN: Record<ManualDebtEntryKind, 1 | -1> = {
  LEND: 1,
  REPAY: 1,
  BORROW: -1,
  COLLECT: -1,
  PAID_FOR_ME: -1,
};

export function deltaFor(kind: ManualDebtEntryKind, amount: number): number {
  return DELTA_SIGN[kind] * amount;
}

/**
 * 一筆往來會產生哪種交易。`PAID_FOR_ME` 產生的是一般支出，另外處理，所以這裡只列 4 種。
 * 交易型別由種類決定，呼叫者指定不了（沿用決策 3 的精神）。
 */
export function transactionTypeFor(
  kind: Exclude<ManualDebtEntryKind, 'PAID_FOR_ME'>,
): DebtTransactionType {
  return kind;
}

/** 調整紀錄（結清差額、免除）：系統算出來的，不產生交易，不能改金額（決策 40）。 */
export function isAdjustment(kind: DebtEntryKind): boolean {
  return kind === 'SETTLEMENT' || kind === 'FORGIVE';
}

type EntryLike = { delta: number; deletedAt: Date | null };

/** 往來餘額：未刪除紀錄的 delta 加總。 */
export function balanceOf(entries: ReadonlyArray<EntryLike>): number {
  return entries.filter((entry) => entry.deletedAt === null).reduce((sum, e) => sum + e.delta, 0);
}

type OrderedEntry = { delta: number; date: Date; createdAt: Date };

/**
 * 依「日期、再依建立時間」由舊到新累加，回傳每筆寫入後的累計餘額（SC-L13）。
 * 輸入只含未刪除的紀錄；回傳的 Map 以原本的物件為鍵，呼叫端自己決定顯示順序。
 */
export function runningBalances<T extends OrderedEntry>(entries: ReadonlyArray<T>): Map<T, number> {
  const ordered = [...entries].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const result = new Map<T, number>();
  let running = 0;
  for (const entry of ordered) {
    running += entry.delta;
    result.set(entry, running);
  }
  return result;
}

type CounterpartyRow = Prisma.CounterpartyGetPayload<object>;
type DebtEntryRow = Prisma.DebtEntryGetPayload<object>;

export function toCounterparty(row: CounterpartyRow, balance: number): Counterparty {
  return {
    id: row.id,
    name: row.name,
    balance,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toDebtEntry(row: DebtEntryRow, balanceAfter?: number): DebtEntry {
  return {
    id: row.id,
    counterpartyId: row.counterpartyId,
    kind: row.kind,
    delta: row.delta,
    date: row.date.toISOString(),
    note: row.note,
    transactionId: row.transactionId,
    ...(balanceAfter !== undefined ? { balanceAfter } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 讀出呼叫者自己的對象，其餘一律 404（見檔頭第二條）。 */
export async function loadOwnedCounterparty(
  client: DebtClient,
  userId: string,
  counterpartyId: string,
): Promise<CounterpartyRow> {
  const row = await client.counterparty.findFirst({
    where: { id: counterpartyId, ownerId: userId },
  });
  if (row === null) {
    throw notFound('Counterparty');
  }
  return row;
}

/** 讀出呼叫者自己的、未刪除的往來紀錄，其餘一律 404。 */
export async function loadOwnedEntry(
  client: DebtClient,
  userId: string,
  entryId: string,
): Promise<DebtEntryRow> {
  const row = await client.debtEntry.findFirst({
    where: { id: entryId, deletedAt: null, counterparty: { ownerId: userId } },
  });
  if (row === null) {
    throw notFound('Debt entry');
  }
  return row;
}

/** 某個對象目前的往來餘額（在同一個資料庫交易裡讀，寫入後的計算才一致）。 */
export async function currentBalance(client: DebtClient, counterpartyId: string): Promise<number> {
  const result = await client.debtEntry.aggregate({
    where: { counterpartyId, deletedAt: null },
    _sum: { delta: true },
  });
  return result._sum.delta ?? 0;
}

export function notFound(what: string): AppException {
  return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, `${what} not found.`);
}

export function badRequest(message: string): AppException {
  return new AppException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, message);
}
