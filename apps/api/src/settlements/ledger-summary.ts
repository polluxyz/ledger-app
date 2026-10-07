import { HttpStatus } from '@nestjs/common';
import {
  computeLedgerNets,
  ErrorCode,
  suggestSettlements,
  type LedgerNetEntry,
  type SettlementSummary,
} from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { LedgerPeopleService } from '../ledger-people/ledger-people.service';

/** 結清摘要的唯一計算入口；帳本頁與借還頁共用相同的轉帳建議，避免金額分叉。 */
interface SplitShareRow {
  transactionId: string;
  type: string;
  amount: number;
  payerId: string | null;
  personId: string | null;
  share: number | null;
}

interface SettlementNetRow {
  fromId: string;
  toId: string;
  amount: number;
}

const SPLIT_SUMMARY_SQL = [
  'SELECT t."id" AS "transactionId", t."type"::text AS "type", t."amount" AS "amount",',
  'COALESCE(t."payerPersonId", creator."id") AS "payerId",',
  'share."personId" AS "personId", share."share" AS "share"',
  'FROM "Transaction" t',
  'INNER JOIN "LedgerSplit" split ON split."transactionId" = t."id"',
  'LEFT JOIN "LedgerShare" share ON share."ledgerSplitId" = split."id"',
  'LEFT JOIN "LedgerPerson" creator ON creator."ledgerId" = t."ledgerId" AND creator."userId" = t."creatorId"',
  'WHERE t."ledgerId" = $1 AND t."deletedAt" IS NULL',
  'ORDER BY t."createdAt", t."id", share."sortOrder", share."id"',
].join(' ');

const SETTLEMENT_SUMMARY_SQL = [
  'SELECT settlement."fromPersonId" AS "fromId", settlement."toPersonId" AS "toId",',
  't."amount" AS "amount"',
  'FROM "Transaction" t',
  'INNER JOIN "LedgerSettlement" settlement ON settlement."transactionId" = t."id"',
  'WHERE t."ledgerId" = $1 AND t."deletedAt" IS NULL',
  'ORDER BY t."createdAt", t."id"',
].join(' ');

function summaryFailure(): AppException {
  return new AppException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    ErrorCode.INTERNAL_ERROR,
    'Unable to calculate the settlement summary.',
  );
}

export async function computeLedgerSummary(
  client: Prisma.TransactionClient,
  ledgerId: string,
  people: LedgerPeopleService,
): Promise<SettlementSummary> {
  const ledger = await client.ledger.findUnique({
    where: { id: ledgerId },
    select: { kind: true },
  });
  if (!ledger || ledger.kind !== 'SHARED') {
    throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Ledger not found.');
  }
  const [orderedPeople, splitRows, settlementRows] = await Promise.all([
    people.listPeople(client, ledgerId),
    client.$queryRawUnsafe<SplitShareRow[]>(SPLIT_SUMMARY_SQL, ledgerId),
    client.$queryRawUnsafe<SettlementNetRow[]>(SETTLEMENT_SUMMARY_SQL, ledgerId),
  ]);

  const entries: LedgerNetEntry[] = [];
  const grouped = new Map<
    string,
    {
      type: 'EXPENSE' | 'INCOME';
      amount: number;
      payerId: string | null;
      shares: { personId: string; share: number }[];
    }
  >();
  for (const row of splitRows) {
    let entry = grouped.get(row.transactionId);
    if (!entry) {
      if (row.type !== 'EXPENSE' && row.type !== 'INCOME') throw summaryFailure();
      entry = { type: row.type, amount: row.amount, payerId: row.payerId, shares: [] };
      grouped.set(row.transactionId, entry);
    }
    if (row.personId !== null && row.share !== null) {
      entry.shares.push({ personId: row.personId, share: row.share });
    }
  }
  for (const entry of grouped.values()) {
    if (entry.payerId === null) throw summaryFailure();
    entries.push({
      kind: entry.type,
      payerId: entry.payerId,
      total: entry.amount,
      shares: entry.shares,
    });
  }
  for (const settlement of settlementRows) {
    entries.push({
      kind: 'SETTLEMENT',
      fromId: settlement.fromId,
      toId: settlement.toId,
      amount: settlement.amount,
    });
  }

  const nets = computeLedgerNets({ personIds: orderedPeople.map((person) => person.id), entries });
  return {
    people: orderedPeople.map((person) => ({
      person: people.toView(person),
      net: nets.get(person.id) ?? 0,
    })),
    suggestions: suggestSettlements(
      orderedPeople.map((person) => ({ personId: person.id, net: nets.get(person.id) ?? 0 })),
    ),
  };
}
