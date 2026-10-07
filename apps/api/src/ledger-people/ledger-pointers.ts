import { resolvePointer, type LedgerPointer } from '@ledger/shared';
import { Prisma } from '../generated/prisma/client';
import { ownSideCounterparty } from '../debts/counterparty-links';

/**
 * 批次載入一位使用者對多個帳本人的有效指向，供 `/ledger-groups` 與借還總額共用。
 * 三次查詢分別取人、明確設定與我的連動；沒有逐人查詢，且明確 null 會蓋過自動指向。
 * 呼叫端須先限定使用者有權讀取的 ledgerPersonIds，並排除使用者自己那一筆。
 */
export async function loadEffectivePointers(
  client: Pick<
    Prisma.TransactionClient,
    'ledgerPerson' | 'ledgerPersonPointer' | 'counterpartyLink'
  >,
  userId: string,
  ledgerPersonIds: readonly string[],
): Promise<Map<string, LedgerPointer>> {
  const ids = [...new Set(ledgerPersonIds)];
  if (ids.length === 0) return new Map();

  const [people, explicitRows, links] = await Promise.all([
    client.ledgerPerson.findMany({
      where: { id: { in: ids } },
      select: { id: true, userId: true },
    }),
    client.ledgerPersonPointer.findMany({
      where: { userId, ledgerPersonId: { in: ids } },
      select: { ledgerPersonId: true, counterpartyId: true },
    }),
    client.counterpartyLink.findMany({
      where: { OR: [{ userLowId: userId }, { userHighId: userId }] },
    }),
  ]);
  const explicit = new Map(explicitRows.map((row) => [row.ledgerPersonId, row.counterpartyId]));
  const linkedCounterpartyByUserId = new Map(
    links.map((link) => [
      link.userLowId === userId ? link.userHighId : link.userLowId,
      ownSideCounterparty(link, userId),
    ]),
  );
  return new Map(
    people
      .filter((person) => person.userId !== userId)
      .map((person) => [
        person.id,
        resolvePointer({
          explicit: explicit.get(person.id),
          personUserId: person.userId,
          linkedCounterpartyByUserId,
        }),
      ]),
  );
}
