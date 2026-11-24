import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { GetLedgerStatisticsDto, GetStatisticsTrendDto } from './dto/get-statistics.dto';
import { StatisticsService } from './statistics.service';
import { INVALID_STATISTICS_FILTER } from './dto/get-statistics.dto';

/** 直接呼叫 service 驗證授權與安全金額邊界；快照選項與查詢順序以 mock 檢查。 */
describe('StatisticsService', () => {
  const tx = {
    ledgerMember: { findUnique: jest.fn() },
    ledgerPerson: { count: jest.fn() },
    category: { count: jest.fn() },
    account: { count: jest.fn() },
    transaction: { findFirst: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const transaction = jest.fn((run: (client: typeof tx) => unknown) => run(tx));
  const service = new StatisticsService({ $transaction: transaction } as unknown as PrismaService);
  const statisticsQuery = () =>
    Object.assign(new GetLedgerStatisticsDto(), { from: '2026-10-01', to: '2026-10-31' });
  const trendQuery = () => Object.assign(new GetStatisticsTrendDto(), { endMonth: '2026-10' });

  beforeEach(() => {
    jest.resetAllMocks();
    transaction.mockImplementation((run) => run(tx));
    tx.ledgerMember.findUnique.mockResolvedValue({ ledger: { kind: 'SHARED' } });
    tx.$queryRaw.mockResolvedValue([]);
    tx.transaction.findFirst.mockResolvedValue(null);
  });

  it.each(['statistics', 'trend'])(
    'rejects a non-member before %s SQL, even without a guard',
    async (endpoint) => {
      tx.ledgerMember.findUnique.mockResolvedValue(null);
      const call =
        endpoint === 'statistics'
          ? service.getStatistics('other', 'secret', statisticsQuery())
          : service.getTrend('other', 'secret', trendQuery());
      await expect(call).rejects.toMatchObject({ status: 404, message: 'Ledger not found.' });
      expect(tx.ledgerMember.findUnique).toHaveBeenCalledWith({
        where: { ledgerId_userId: { ledgerId: 'secret', userId: 'other' } },
        select: { ledger: { select: { kind: true } } },
      });
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      });
    },
  );

  it('reads membership and all three aggregates through the transaction client', async () => {
    await service.getStatistics('me', 'ledger', statisticsQuery());
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(tx.ledgerMember.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[0]!,
    );
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  });

  it.each([
    [{ from: '2026-02-30' }, 'statistics'],
    [{ to: '2026-09-30' }, 'statistics'],
    [{ endMonth: '2026-13' }, 'trend'],
  ] as const)('turns invalid periods into a safe 400: %j', async (overrides, endpoint) => {
    const call =
      endpoint === 'statistics'
        ? service.getStatistics('me', 'ledger', Object.assign(statisticsQuery(), overrides))
        : service.getTrend('me', 'ledger', Object.assign(trendQuery(), overrides));
    await expect(call).rejects.toMatchObject({
      status: 400,
      message: 'Invalid statistics period.',
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(['totals', 'groups', 'people', 'trend'])(
    'rejects unsafe %s amounts without exposing internal details',
    async (target) => {
      const unsafe = 9007199254740992n;
      if (target === 'totals')
        tx.$queryRaw.mockResolvedValueOnce([
          { perspective: 'LEDGER', income: unsafe, expense: 0n },
        ]);
      if (target === 'groups')
        tx.$queryRaw
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            { direction: 'EXPENSE', kind: 'UNCATEGORIZED', key: 'UNCATEGORIZED:', amount: unsafe },
          ]);
      if (target === 'people')
        tx.$queryRaw
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            { personId: 'me', name: '我', isMe: true, income: unsafe, expense: 0n },
          ]);
      if (target === 'trend')
        tx.$queryRaw.mockResolvedValueOnce([{ month: '2026-10', income: 0n, expense: unsafe }]);
      const call =
        target === 'trend'
          ? service.getTrend('me', 'ledger', trendQuery())
          : service.getStatistics('me', 'ledger', statisticsQuery());
      await expect(call).rejects.toMatchObject({
        status: 500,
        message: 'Statistics could not be calculated.',
      });
    },
  );

  it('does not turn database failures into client validation errors', async () => {
    tx.$queryRaw.mockRejectedValue(new Error('database unavailable'));
    await expect(service.getTrend('me', 'ledger', trendQuery())).rejects.toThrow(
      'database unavailable',
    );
  });

  it.each(['personIds', 'categoryIds', 'accountIds'] as const)(
    'scopes %s validation before reading aggregates',
    async (key) => {
      const id = '00000000-0000-4000-8000-000000000001';
      const query = Object.assign(statisticsQuery(), { [key]: [id] });
      tx.ledgerPerson.count.mockResolvedValue(0);
      tx.category.count.mockResolvedValue(0);
      tx.account.count.mockResolvedValue(0);
      await expect(service.getStatistics('me', 'ledger', query)).rejects.toMatchObject({
        status: 400,
        response: { message: [INVALID_STATISTICS_FILTER] },
      });
      const reader = {
        personIds: tx.ledgerPerson,
        categoryIds: tx.category,
        accountIds: tx.account,
      };
      const scope = key === 'accountIds' ? { userId: 'me' } : { ledgerId: 'ledger' };
      expect(reader[key].count).toHaveBeenCalledWith({ where: { ...scope, id: { in: [id] } } });
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    },
  );

  it('builds filtered totals and basis points from the same groups without changing summaries', async () => {
    tx.account.count.mockResolvedValue(1);
    tx.$queryRaw
      .mockResolvedValueOnce([
        { perspective: 'LEDGER', income: 100n, expense: 90n },
        { perspective: 'MINE', income: 100n, expense: 60n },
      ])
      .mockResolvedValueOnce([
        {
          direction: 'EXPENSE',
          kind: 'CATEGORY',
          key: 'CATEGORY:food',
          categoryId: 'food',
          categoryName: '餐飲',
          categoryIcon: null,
          amount: 2n,
        },
        { direction: 'EXPENSE', kind: 'UNCATEGORIZED', key: 'UNCATEGORIZED:', amount: 1n },
        { direction: 'INCOME', kind: 'UNCATEGORIZED', key: 'UNCATEGORIZED:', amount: 7n },
      ])
      .mockResolvedValueOnce([
        { personId: 'me', name: '我', isMe: true, income: 100n, expense: 60n },
      ]);
    const body = await service.getStatistics(
      'me',
      'ledger',
      Object.assign(statisticsQuery(), { accountIds: ['cash', 'cash'] }),
    );
    expect(body.totals).toEqual({ income: 7, expense: 3, net: 4 });
    expect(body.ledger).toEqual({ income: 100, expense: 90, net: 10 });
    expect(body.mine).toEqual({ income: 100, expense: 60, net: 40 });
    expect(body.people).toEqual([
      { personId: 'me', name: '我', isMe: true, income: 100, expense: 60 },
    ]);
    expect(body.expenseGroups.map(({ amount, percentageBps }) => [amount, percentageBps])).toEqual([
      [2, 6667],
      [1, 3333],
    ]);
    expect(body.incomeGroups.map(({ amount, percentageBps }) => [amount, percentageBps])).toEqual([
      [7, 10000],
    ]);
  });

  it('averages from the opening month, including a zero month and excluding the unfinished month', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-31T15:59:59.999Z'));
    tx.transaction.findFirst.mockResolvedValue({ date: new Date('2026-08-31T15:59:59.999Z') });
    tx.account.count.mockResolvedValue(1);
    tx.$queryRaw.mockResolvedValue([
      { month: '2026-08', income: 3n, expense: 1n },
      { month: '2026-10', income: 100n, expense: 200n },
    ]);
    try {
      const query = Object.assign(trendQuery(), { months: 4, accountIds: ['cash'] });
      const result = await service.getTrend('me', 'ledger', query);
      expect(result).toMatchObject({ averageIncome: 2, averageExpense: 1, averageMonthCount: 2 });
      expect(result.months.map(({ income, expense }) => [income, expense])).toEqual([
        [0, 0],
        [3, 1],
        [0, 0],
        [100, 200],
      ]);
      expect(tx.transaction.findFirst).toHaveBeenCalledWith({
        where: { ledgerId: 'ledger', deletedAt: null },
        orderBy: { date: 'asc' },
        select: { date: true },
      });
      clock.mockReturnValue(Date.parse('2026-10-31T16:00:00.000Z'));
      await expect(service.getTrend('me', 'ledger', query)).resolves.toMatchObject({
        averageIncome: 34,
        averageExpense: 67,
        averageMonthCount: 3,
      });
    } finally {
      clock.mockRestore();
    }
  });

  it.each([null, { date: new Date('2026-11-01T00:00:00+08:00') }])(
    'returns null averages when no month qualifies (%j)',
    async (first) => {
      tx.transaction.findFirst.mockResolvedValue(first);
      await expect(service.getTrend('me', 'ledger', trendQuery())).resolves.toMatchObject({
        averageIncome: null,
        averageExpense: null,
        averageMonthCount: 0,
      });
    },
  );
});
