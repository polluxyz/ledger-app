import { AiService } from './ai.service';
import { LlmProviderError } from './llm-provider';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AiQuotaService } from './ai-quota.service';
import { Logger } from '@nestjs/common';

/** mock 資料庫與 provider，確認拒絕發生在讀清單之前，以及只有指定例外會轉成 503。 */
describe('AiService', () => {
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());
  const dto = { text: '  早餐 60  ', ledgerId: 'own', today: '2040-01-01' };
  function setup(role: string | null = 'OWNER', archivedAt: Date | null = null) {
    const prisma = {
      ledgerMember: { findUnique: jest.fn().mockResolvedValue(role ? { role } : null) },
      ledger: {
        findUnique: jest.fn().mockResolvedValue({ archivedAt }),
        findMany: jest.fn().mockResolvedValue([{ id: 'own', name: '日常' }]),
      },
      category: { findMany: jest.fn().mockResolvedValue([]) },
      account: { findMany: jest.fn().mockResolvedValue([{ id: 'cash', name: '現金' }]) },
    };
    const users = { getRecordDefaults: jest.fn().mockResolvedValue({ accountId: 'cash' }) };
    const provider = {
      descriptor: { configured: true, provider: 'stub', model: null },
      complete: jest.fn().mockResolvedValue({ truncated: false, content: { drafts: [] } }),
    };
    const quota = {
      reserve: jest.fn().mockResolvedValue({ day: '2040-01-01' }),
      record: jest.fn().mockResolvedValue(undefined),
    };
    const limits = { perUserDaily: 50, globalDaily: 500, maxOutputTokens: 3072 };
    const service = new AiService(
      prisma as unknown as PrismaService,
      users as unknown as UsersService,
      provider,
      quota as unknown as AiQuotaService,
      limits,
    );
    return { service, prisma, provider, users, quota, limits };
  }
  it.each([
    [null, null, 404],
    ['VIEWER', new Date(), 403],
    ['OWNER', new Date(), 409],
  ] as const)(
    'rejects role %p with %p as %p without reading or sending data',
    async (role, archived, status) => {
      const { service, prisma, provider, users } = setup(role, archived);
      await expect(service.parseTransaction('me', dto)).rejects.toMatchObject({ status });
      expect(prisma.ledger.findMany).not.toHaveBeenCalled();
      expect(provider.complete).not.toHaveBeenCalled();
      expect(users.getRecordDefaults).not.toHaveBeenCalled();
    },
  );
  it('looks up defaults and sends only the trimmed sentence as user', async () => {
    const { service, provider, users } = setup();
    await expect(service.parseTransaction('me', dto)).resolves.toEqual({ drafts: [] });
    expect(users.getRecordDefaults).toHaveBeenCalledWith('me', 'own');
    expect(provider.complete.mock.calls[0]).toEqual([expect.objectContaining({ user: '早餐 60' })]);
  });
  it.each(['http', 'network', 'timeout', 'auth'] as const)(
    'maps provider %s errors to a safe 503',
    async (kind) => {
      const { service, provider } = setup();
      provider.complete.mockRejectedValue(new LlmProviderError(kind, 500, 15000));
      await expect(service.parseTransaction('me', dto)).rejects.toMatchObject({
        status: 503,
        errorCode: 'AI_UNAVAILABLE',
      });
    },
  );
  it('does not reclassify programming errors as provider failures', async () => {
    const { service, provider } = setup();
    const error = new Error('programming error');
    provider.complete.mockRejectedValue(error);
    await expect(service.parseTransaction('me', dto)).rejects.toBe(error);
  });

  it('checks configuration before catalog and quota', async () => {
    const { service, provider, prisma, quota } = setup();
    provider.descriptor.configured = false;
    await expect(service.parseTransaction('me', dto)).rejects.toMatchObject({
      errorCode: 'AI_NOT_CONFIGURED',
    });
    expect(prisma.ledger.findMany).not.toHaveBeenCalled();
    expect(quota.reserve).not.toHaveBeenCalled();
  });

  it('loads catalog before quota and commits quota before provider; limits remain live', async () => {
    const { service, provider, prisma, quota, limits } = setup();
    await service.parseTransaction('me', dto);
    expect(prisma.account.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      quota.reserve.mock.invocationCallOrder[0]!,
    );
    expect(quota.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      provider.complete.mock.invocationCallOrder[0]!,
    );
    expect(provider.complete).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxOutputTokens: 3072 }),
    );
    limits.maxOutputTokens = 4096;
    await service.parseTransaction('me', dto);
    expect(provider.complete).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxOutputTokens: 4096 }),
    );
  });

  it('does not reserve when reading catalog fails', async () => {
    const { service, prisma, quota } = setup();
    prisma.category.findMany.mockRejectedValue(new Error('catalog failure'));
    await expect(service.parseTransaction('me', dto)).rejects.toThrow('catalog failure');
    expect(quota.reserve).not.toHaveBeenCalled();
  });

  it('SC-P25.2: discards complete JSON when truncated and records usage exactly once', async () => {
    const { service, provider, quota } = setup();
    const usage = { promptTokens: 4, completionTokens: 2 };
    provider.complete.mockResolvedValue({ truncated: true, content: { drafts: [{}] }, usage });
    expect(await service.parseTransaction('me', dto)).toEqual({ drafts: [] });
    expect(quota.record).toHaveBeenCalledTimes(1);
    expect(quota.record).toHaveBeenCalledWith('me', '2040-01-01', usage);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('outcome=truncated'));
  });

  it('SC-P37.5 / SC-P37.6: appends timings and reasoning tokens without changing quota usage', async () => {
    const { service, provider, quota } = setup();
    const usage = { promptTokens: 10, completionTokens: 20, reasoningTokens: 7 };
    provider.complete.mockResolvedValue({
      content: { drafts: [] },
      truncated: false,
      usage,
      timings: { tokenMs: 1, headersMs: 12, bodyMs: 14 },
    });
    await service.parseTransaction('me', dto);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/tokenMs=1 headersMs=12 bodyMs=14 reasoningTokens=7$/),
    );
    expect(quota.record).toHaveBeenCalledWith('me', '2040-01-01', usage);
  });

  it('SC-P37.5: logs only the auth duration when token acquisition fails', async () => {
    const { service, provider, quota } = setup();
    provider.complete.mockRejectedValue(new LlmProviderError('auth', null, 5, { tokenMs: 5 }));
    await expect(service.parseTransaction('me', dto)).rejects.toMatchObject({
      status: 503,
      errorCode: 'AI_UNAVAILABLE',
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/tokenMs=5 headersMs=unknown bodyMs=unknown reasoningTokens=unknown$/),
    );
    expect(quota.record).toHaveBeenCalledWith('me', '2040-01-01', null);
  });

  it('SC-P37.6: absent diagnostics are unknown, never zero', async () => {
    const { service } = setup();
    await service.parseTransaction('me', dto);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /tokenMs=unknown headersMs=unknown bodyMs=unknown reasoningTokens=unknown$/,
      ),
    );
  });
});
