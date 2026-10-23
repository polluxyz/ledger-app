import type { TransactionType } from '../generated/prisma/client';
import { classifyStatisticsGroup, statisticsGroupKey } from './statistics-groups';
import type { StatisticsGroupSource } from './statistics-groups';
import type { StatisticsScope } from './statistics-sql';

/** 只給測試的獨立對照：正式查詢一律使用 statistics-sql.ts，不逐筆載入交易。 */
export interface AttributionTransaction extends StatisticsGroupSource {
  id: string;
  ledgerId: string;
  creatorId: string;
  creator: { name: string };
  payerPersonId: string | null;
  type: TransactionType;
  amount: number;
  date: Date;
  deletedAt: Date | null;
  ledgerSplit: { shares: Array<{ personId: string; share: number }> } | null;
}

export interface AttributionPerson {
  id: string;
  userId: string | null;
  name: string | null;
  user: { name: string } | null;
}

export interface AttributionRow {
  transactionId: string;
  personId: string;
  name: string;
  isMe: boolean;
  amount: bigint;
  direction: 'INCOME' | 'EXPENSE';
  kind: ReturnType<typeof classifyStatisticsGroup>;
  categoryId: string | null;
  key: string;
  month: string;
}

/** 已存份額優先，其次收付人，最後記帳者；份額為 0 的人仍可留在對照列。 */
export function attributeTransactions(
  transactions: readonly AttributionTransaction[],
  people: readonly AttributionPerson[],
  scope: StatisticsScope,
): AttributionRow[] {
  const byId = new Map(people.map((person) => [person.id, person]));
  const byUser = new Map(
    people.filter((person) => person.userId !== null).map((p) => [p.userId, p]),
  );
  return transactions.flatMap((transaction) => {
    if (
      transaction.ledgerId !== scope.ledgerId ||
      transaction.deletedAt !== null ||
      (transaction.type !== 'EXPENSE' && transaction.type !== 'INCOME') ||
      transaction.date < scope.start ||
      transaction.date >= scope.end
    ) {
      return [];
    }
    const direction = transaction.type;
    const kind = classifyStatisticsGroup(transaction, scope.userId);
    const shares = transaction.ledgerSplit?.shares;
    const allocations =
      shares && shares.length > 0
        ? shares.map((share) => ({ personId: share.personId, amount: share.share }))
        : [
            {
              personId: transaction.payerPersonId ?? byUser.get(transaction.creatorId)?.id ?? null,
              amount: transaction.amount,
            },
          ];
    return allocations.map(({ personId, amount }) => {
      if (!Number.isSafeInteger(amount) || amount < 0)
        throw new RangeError('Invalid stored amount');
      const person = personId === null ? undefined : byId.get(personId);
      const userId = person ? person.userId : transaction.creatorId;
      return {
        transactionId: transaction.id,
        personId: person?.id ?? transaction.creatorId,
        name: person ? (person.user?.name ?? person.name ?? '') : transaction.creator.name,
        isMe: userId === scope.userId,
        amount: BigInt(amount),
        direction,
        kind,
        categoryId: transaction.categoryId,
        key: statisticsGroupKey(kind, transaction.categoryId),
        month: new Date(transaction.date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7),
      };
    });
  });
}
