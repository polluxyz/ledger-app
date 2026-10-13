import type { PrismaService } from '../prisma/prisma.service';
import type { LedgerPeopleService } from '../ledger-people/ledger-people.service';
import { LedgerDebtsService, type MyLedgerDebt } from './ledger-debts.service';

/**
 * 群組規則用已計算好的欠款資料測試，確認退出、零額與指向不改動金額；
 * hasSettlements 的筆數則 mock $queryRaw，驗證過濾與 settlementCount 的對接。
 */
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

describe('LedgerDebtsService.groups with hasSettlements', () => {
  const person = (id: string, status: 'MEMBER' | 'LEFT' | 'GUEST', amount: number) => ({
    person: { id, name: id, userId: status === 'GUEST' ? null : id, status },
    amount,
    pointer: { counterpartyId: null, auto: true },
  });
  // 現任的「乙帳本」（還有轉帳）、已退出且沒有轉帳的「甲帳本」、沒有結清的「丙帳本」。
  const debts: MyLedgerDebt[] = [
    {
      ledger: { id: 'z', name: '乙帳本', left: false },
      people: [person('member', 'MEMBER', 0), person('gone', 'LEFT', 0)],
    },
    {
      ledger: { id: 'a', name: '甲帳本', left: true },
      people: [],
    },
    {
      ledger: { id: 'empty', name: '丙帳本', left: false },
      people: [person('zero', 'GUEST', 0)],
    },
  ];
  const counts = [
    { ledgerId: 'z', count: 3n },
    { ledgerId: 'a', count: 1 },
  ];
  let queryRaw: jest.Mock;
  let service: LedgerDebtsService;

  beforeEach(() => {
    queryRaw = jest.fn().mockResolvedValue(counts);
    service = new LedgerDebtsService(
      { $queryRaw: queryRaw } as unknown as PrismaService,
      {} as LedgerPeopleService,
    );
    jest.spyOn(service, 'loadMyLedgerDebts').mockResolvedValue(debts);
  });

  it('keeps only ledgers with visible settlements and carries settlementCount', async () => {
    const groups = await service.groups('owner', false, true);

    // 排序照現行規則（依帳本名稱的 zh-Hant 定序）：乙（1 劃）在甲（5 劃）前面。
    expect(groups.map(({ ledger }) => ledger.id)).toEqual(['z', 'a']);
    // 已退出且沒有轉帳的帳本也列出（不受「已退出只在還有轉帳時列」的限制），
    // people 照現行規則——沒有轉帳就是空的。
    expect(groups[0]).toMatchObject({
      ledger: { id: 'z' },
      settlementCount: 3,
    });
    expect(groups[1]).toMatchObject({
      ledger: { id: 'a', left: true },
      people: [],
      settlementCount: 1,
    });
    // 筆數是一次查詢取回，不是逐本帳本查。
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('omits ledgers without visible settlements', async () => {
    const groups = await service.groups('owner', false, true);
    expect(groups.map(({ ledger }) => ledger.id)).not.toContain('empty');
  });

  it('treats a ledger missing from the count rows as zero settlements', async () => {
    queryRaw.mockResolvedValue([{ ledgerId: 'z', count: 2n }]);
    const groups = await service.groups('owner', false, true);
    expect(groups.map(({ ledger }) => ledger.id)).toEqual(['z']);
    expect(groups[0]!.settlementCount).toBe(2);
  });

  it('leaves the response untouched without the flag', async () => {
    const groups = await service.groups('owner');

    expect(queryRaw).not.toHaveBeenCalled();
    for (const group of groups) {
      expect('settlementCount' in group).toBe(false);
    }
  });
});
