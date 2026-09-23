import { assertLedgerWritable } from './debt-ledger-access';

/**
 * `assertLedgerWritable` 必須與 `LedgerAccessGuard` 對寫入的判斷完全一致：非成員 404、
 * VIEWER 403、封存 409、EDITOR 與 OWNER 放行。e2e（SC-D10）另外比對兩條路徑的實際回應。
 */
describe('assertLedgerWritable', () => {
  function clientWith(membership: unknown) {
    return { ledgerMember: { findUnique: jest.fn().mockResolvedValue(membership) } };
  }
  const open = { archivedAt: null };

  it('404s for a non-member, without revealing the ledger exists', async () => {
    await expect(
      assertLedgerWritable(clientWith(null) as never, 'user-1', 'ledger-1'),
    ).rejects.toMatchObject({ status: 404, errorCode: 'NOT_FOUND' });
  });

  it('403s for a VIEWER', async () => {
    await expect(
      assertLedgerWritable(
        clientWith({ role: 'VIEWER', ledger: open }) as never,
        'user-1',
        'ledger-1',
      ),
    ).rejects.toMatchObject({ status: 403, errorCode: 'FORBIDDEN' });
  });

  it('409s LEDGER_ARCHIVED for an archived ledger, even for its owner', async () => {
    await expect(
      assertLedgerWritable(
        clientWith({ role: 'OWNER', ledger: { archivedAt: new Date() } }) as never,
        'user-1',
        'ledger-1',
      ),
    ).rejects.toMatchObject({ status: 409, errorCode: 'LEDGER_ARCHIVED' });
  });

  it.each(['EDITOR', 'OWNER'])('lets an %s write to an open ledger', async (role) => {
    await expect(
      assertLedgerWritable(clientWith({ role, ledger: open }) as never, 'user-1', 'ledger-1'),
    ).resolves.toBeUndefined();
  });
});
