import { requireLedgerAccess } from './require-ledger-access';
import { PrismaService } from '../prisma/prisma.service';

/** 共用授權函式以明確的呼叫順序證明 404 → 403 → 409，並保留讀取封存帳本的能力。 */
describe('requireLedgerAccess', () => {
  const setup = (role: string | null) => {
    const prisma = {
      ledgerMember: { findUnique: jest.fn().mockResolvedValue(role ? { role } : null) },
      ledger: { findUnique: jest.fn().mockResolvedValue({ archivedAt: new Date() }) },
    };
    return {
      prisma,
      check: (allowArchived = false) =>
        requireLedgerAccess(
          prisma as unknown as PrismaService,
          'me',
          'ledger',
          'EDITOR',
          allowArchived,
        ),
    };
  };
  it.each([
    [null, 404],
    ['VIEWER', 403],
  ] as const)('rejects %p before reading archive state', async (role, status) => {
    const { prisma, check } = setup(role);
    await expect(check()).rejects.toMatchObject({ status });
    expect(prisma.ledger.findUnique).not.toHaveBeenCalled();
  });
  it('rejects archived writes only after membership and role pass', async () => {
    const { check } = setup('EDITOR');
    await expect(check()).rejects.toMatchObject({ status: 409, errorCode: 'LEDGER_ARCHIVED' });
  });
  it('returns actual role and does not query archive state when allowed', async () => {
    const { prisma, check } = setup('OWNER');
    await expect(check(true)).resolves.toBe('OWNER');
    expect(prisma.ledger.findUnique).not.toHaveBeenCalled();
  });
});
