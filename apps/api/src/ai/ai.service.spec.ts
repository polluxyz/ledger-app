import { AiService } from './ai.service';
import { LlmProviderError } from './llm-provider';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

/** mock 資料庫與 provider，確認拒絕發生在讀清單之前，以及只有指定例外會轉成 503。 */
describe('AiService', () => {
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
    const provider = { complete: jest.fn().mockResolvedValue({ content: { drafts: [] } }) };
    const service = new AiService(
      prisma as unknown as PrismaService,
      users as unknown as UsersService,
      provider,
    );
    return { service, prisma, provider, users };
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
  it.each(['http', 'network', 'timeout'] as const)(
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
});
