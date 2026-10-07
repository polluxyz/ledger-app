import type { PrismaService } from '../prisma/prisma.service';
import type { LedgerPeopleService } from '../ledger-people/ledger-people.service';
import { LedgerDebtsService, type MyLedgerDebt } from './ledger-debts.service';

/** 群組規則用已計算好的欠款資料測試，確認退出、零額與指向不改動金額。 */
describe('LedgerDebtsService.groups', () => {
  const person = (
    id: string,
    status: 'MEMBER' | 'LEFT' | 'GUEST',
    amount: number,
    pointed = false,
  ) => ({
    person: { id, name: id, userId: status === 'GUEST' ? null : id, status },
    amount,
    pointer: { counterpartyId: pointed ? 'counterparty' : null, auto: true },
  });
  const debts: MyLedgerDebt[] = [
    {
      ledger: { id: 'z', name: '乙帳本', left: false },
      people: [
        person('member', 'MEMBER', 0),
        person('guest', 'GUEST', 200, true),
        person('gone', 'LEFT', 0),
      ],
    },
    {
      ledger: { id: 'a', name: '甲帳本', left: true },
      people: [person('stillOwed', 'MEMBER', -100), person('zero', 'GUEST', 0)],
    },
    {
      ledger: { id: 'empty', name: '丙帳本', left: true },
      people: [person('zeroLeft', 'MEMBER', 0)],
    },
  ];
  const service = new LedgerDebtsService({} as PrismaService, {} as LedgerPeopleService);
  jest.spyOn(service, 'loadMyLedgerDebts').mockResolvedValue(debts);

  it('sorts groups and retains current people plus nonzero left people', async () => {
    const groups = await service.groups('owner');
    expect(groups.map(({ ledger }) => ledger.id)).toEqual(['z', 'a']);
    expect(groups[0]!.people.map(({ person }) => person.id)).toEqual(['member', 'guest']);
    expect(groups[1]!.people.map(({ person }) => person.id)).toEqual(['stillOwed']);
  });

  it('keeps only nonzero unpointed people and omits empty groups', async () => {
    const groups = await service.groups('owner', true);
    expect(groups.map(({ ledger }) => ledger.id)).toEqual(['a']);
    expect(groups[0]!.people.map(({ person }) => person.id)).toEqual(['stillOwed']);
  });
});
