import { Logger } from '@nestjs/common';
import { AiQuotaService } from './ai-quota.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AiQuotaLimits } from './ai-quota.tokens';

/** 模擬交易邊界，釘住台灣日期、停用的優先順序與資料庫例外遮蔽。併發另用真 DB e2e。 */
describe('AiQuotaService', () => {
  function setup(instant = '2026-10-24T15:59:59Z') {
    const query = jest
      .fn<Promise<{ calls: number }[]>, [TemplateStringsArray, ...unknown[]]>()
      .mockResolvedValue([{ calls: 1 }]);
    const transaction = jest
      .fn()
      .mockImplementation(async (action: (tx: unknown) => Promise<unknown>) =>
        action({ $queryRaw: query }),
      );
    const prisma = { $transaction: transaction };
    const limits: AiQuotaLimits = { perUserDaily: 2, globalDaily: 3, maxOutputTokens: 2048 };
    const service = new AiQuotaService(
      prisma as unknown as PrismaService,
      limits,
      () => new Date(instant),
    );
    return { service, query, transaction, limits };
  }

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['2026-10-24T15:59:59Z', '2026-10-24'],
    ['2026-10-24T16:00:00Z', '2026-10-25'],
  ])('uses Taiwan day at %s', async (instant, day) => {
    const { service, query } = setup(instant);
    expect(await service.reserve('me')).toEqual({ day });
    expect(query.mock.calls[0]!.slice(1)).toContain(day);
    expect(query.mock.calls[1]!.slice(1)).toContain(day);
  });

  it.each([
    [0, 3, 429],
    [2, 0, 503],
    [0, 0, 429],
  ])('zero limits %i/%i do not access DB', async (personal, global, status) => {
    const { service, transaction, limits } = setup();
    limits.perUserDaily = personal;
    limits.globalDaily = global;
    await expect(service.reserve('me')).rejects.toMatchObject({ status });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('does not write when usage is absent', async () => {
    const { service, transaction } = setup();
    await service.record('me', '2026-10-24', null);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('replaces raw reserve errors and swallows record errors with fixed logs', async () => {
    const { service, transaction } = setup();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    transaction.mockRejectedValue(new Error('PRIVATE me'));
    await expect(service.reserve('me')).rejects.toMatchObject({
      status: 500,
      errorCode: 'INTERNAL_ERROR',
    });
    await expect(
      service.record('me', '2026-10-24', { promptTokens: 1, completionTokens: 2 }),
    ).resolves.toBeUndefined();
    expect(error.mock.calls).toEqual([['AI quota reserve failed'], ['AI usage record failed']]);
  });
});
