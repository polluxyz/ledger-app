import { Injectable } from '@nestjs/common';
import {
  myLedgerAmounts,
  type CounterpartyLedgerPart,
  type LedgerGroup,
  type LedgerGroupPerson,
} from '@ledger/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerPeopleService } from '../ledger-people/ledger-people.service';
import { loadEffectivePointers } from '../ledger-people/ledger-pointers';
import { computeLedgerSummary } from '../settlements/ledger-summary';

/** 只查目前仍有成員資格的共享帳本，再批次取指向；封存仍保留欠款。 */
export interface MyLedgerDebt {
  ledger: { id: string; name: string; left: boolean };
  people: LedgerGroupPerson[];
}

@Injectable()
export class LedgerDebtsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerPeople: LedgerPeopleService,
  ) {}

  async loadMyLedgerDebts(userId: string): Promise<MyLedgerDebt[]> {
    const ledgers = await this.prisma.ledger.findMany({
      where: { kind: 'SHARED', members: { some: { userId } } },
      select: {
        id: true,
        name: true,
        people: { where: { userId }, select: { id: true } },
      },
    });
    const loaded = await Promise.all(
      ledgers.map(async (ledger) => {
        const summary = await this.prisma.$transaction((tx) =>
          computeLedgerSummary(tx, ledger.id, this.ledgerPeople),
        );
        const myPersonId = ledger.people[0]!.id;
        return {
          ledger: { id: ledger.id, name: ledger.name, left: false },
          people: summary.people
            .map(({ person }) => person)
            .filter((person) => person.id !== myPersonId),
          amounts: myLedgerAmounts(summary.suggestions, myPersonId),
        };
      }),
    );
    const ids = loaded.flatMap(({ people }) => people.map((person) => person.id));
    const pointers = await loadEffectivePointers(this.prisma, userId, ids);
    return loaded.map(({ ledger, people, amounts }) => ({
      ledger,
      people: people.map((person) => ({
        person,
        amount: amounts.get(person.id) ?? 0,
        pointer: pointers.get(person.id) ?? { counterpartyId: null, auto: true },
      })),
    }));
  }

  async partsByCounterparty(userId: string): Promise<Map<string, CounterpartyLedgerPart[]>> {
    const debts = await this.loadMyLedgerDebts(userId);
    const parts = new Map<string, CounterpartyLedgerPart[]>();
    for (const { ledger, people } of debts) {
      for (const { person, amount, pointer } of people) {
        if (amount === 0 || pointer.counterpartyId === null) continue;
        const part: CounterpartyLedgerPart = {
          ledgerId: ledger.id,
          ledgerName: ledger.name,
          personId: person.id,
          personName: person.name,
          amount,
          left: ledger.left,
        };
        parts.set(pointer.counterpartyId, [...(parts.get(pointer.counterpartyId) ?? []), part]);
      }
    }
    for (const value of parts.values()) {
      value.sort((a, b) => a.ledgerName.localeCompare(b.ledgerName, 'zh-Hant'));
    }
    return parts;
  }

  async groups(userId: string, unpointed = false, hasSettlements = false): Promise<LedgerGroup[]> {
    const debts = await this.loadMyLedgerDebts(userId);
    // hasSettlements 需要每組的結清筆數；一次查詢取回所有帳本，不逐本帳本查。
    // counts 為 null 時回應與現行完全相同（不帶 settlementCount）。
    const counts = hasSettlements ? await this.settlementCounts(userId) : null;
    return debts
      .map(({ ledger, people }) => ({
        ledger,
        people: people.filter(({ person, amount, pointer }) =>
          unpointed
            ? pointer.counterpartyId === null && amount !== 0
            : person.status !== 'LEFT' || amount !== 0,
        ),
        ...(counts ? { settlementCount: counts.get(ledger.id) ?? 0 } : {}),
      }))
      .filter(({ ledger, people }) =>
        counts ? (counts.get(ledger.id) ?? 0) > 0 : !unpointed || people.length > 0,
      )
      .sort((a, b) => a.ledger.name.localeCompare(b.ledger.name, 'zh-Hant'));
  }

  /**
   * 3k 決策 189：結清歷史也只算現任成員的共享帳本，避免退出後從彙總洩漏資料。
   */
  private async settlementCounts(userId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<Array<{ ledgerId: string; count: number | bigint }>>(
      Prisma.sql`
        SELECT t."ledgerId" AS "ledgerId", COUNT(*)::int AS "count"
        FROM "LedgerSettlement" st
        JOIN "Transaction" t ON t."id" = st."transactionId" AND t."deletedAt" IS NULL
        JOIN "LedgerMember" mem ON mem."ledgerId" = t."ledgerId" AND mem."userId" = ${userId}
        JOIN "Ledger" l ON l."id" = t."ledgerId" AND l."kind" = 'SHARED'
        GROUP BY t."ledgerId"
      `,
    );
    return new Map(rows.map((row) => [row.ledgerId, Number(row.count)]));
  }
}
