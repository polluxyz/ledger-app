import { Injectable } from '@nestjs/common';
import {
  myLedgerAmounts,
  type CounterpartyLedgerPart,
  type LedgerGroup,
  type LedgerGroupPerson,
} from '@ledger/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerPeopleService } from '../ledger-people/ledger-people.service';
import { loadEffectivePointers } from '../ledger-people/ledger-pointers';
import { computeLedgerSummary } from '../settlements/ledger-summary';

/** 先用我的 LedgerPerson 限定帳本，再批次取指向；退出與封存均不能抹掉既有欠款。 */
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
      where: { kind: 'SHARED', people: { some: { userId } } },
      select: {
        id: true,
        name: true,
        members: { where: { userId }, select: { userId: true } },
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
          ledger: { id: ledger.id, name: ledger.name, left: ledger.members.length === 0 },
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

  async groups(userId: string, unpointed = false): Promise<LedgerGroup[]> {
    const debts = await this.loadMyLedgerDebts(userId);
    return debts
      .map(({ ledger, people }) => ({
        ledger,
        people: people.filter(({ person, amount, pointer }) =>
          unpointed
            ? pointer.counterpartyId === null && amount !== 0
            : ledger.left
              ? amount !== 0
              : person.status !== 'LEFT' || amount !== 0,
        ),
      }))
      .filter(({ ledger, people }) => (!unpointed && !ledger.left) || people.length > 0)
      .sort((a, b) => a.ledger.name.localeCompare(b.ledger.name, 'zh-Hant'));
  }
}
