import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { GetLedgerStatisticsDto, GetStatisticsTrendDto } from './dto/get-statistics.dto';
import { StatisticsService } from './statistics.service';

/** 直接呼叫 service 驗證授權與安全金額邊界；快照選項與查詢順序以 mock 檢查。 */
describe('StatisticsService', () => {
  const tx = { ledgerMember: { findUnique: jest.fn() }, $queryRaw: jest.fn() };
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
});
