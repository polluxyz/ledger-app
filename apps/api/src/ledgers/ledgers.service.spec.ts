import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { LedgersService } from './ledgers.service';

/**
 * Focused on member-management invariants (the security-critical logic).
 * Prisma is mocked; $transaction runs its callback with the same mock client.
 */
describe('LedgersService (members)', () => {
  let service: LedgersService;
  let prisma: {
    user: { findUnique: jest.Mock };
    ledgerMember: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const ledgerId = 'ledger-1';

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn() },
      ledgerMember: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    service = new LedgersService(prisma as unknown as PrismaService);
  });

  describe('addMember', () => {
    it('404s when no user has the email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.addMember(ledgerId, 'ghost@x.com', 'EDITOR')).rejects.toMatchObject({
        constructor: AppException,
        errorCode: 'USER_NOT_FOUND',
      });
    });

    it('409s when the user is already a member', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
      prisma.ledgerMember.findUnique.mockResolvedValue({ role: 'VIEWER' });

      await expect(service.addMember(ledgerId, 'bob@x.com', 'EDITOR')).rejects.toMatchObject({
        constructor: AppException,
        errorCode: 'ALREADY_MEMBER',
      });
    });

    it('adds a new member and returns their info', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
      prisma.ledgerMember.findUnique.mockResolvedValue(null);
      prisma.ledgerMember.create.mockResolvedValue({
        userId: 'user-2',
        role: 'EDITOR',
        user: { email: 'bob@x.com', name: 'Bob' },
      });

      await expect(service.addMember(ledgerId, 'bob@x.com', 'EDITOR')).resolves.toEqual({
        userId: 'user-2',
        email: 'bob@x.com',
        name: 'Bob',
        role: 'EDITOR',
      });
    });
  });

  describe('updateMemberRole (last-owner)', () => {
    it('blocks demoting the last owner', async () => {
      prisma.ledgerMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.ledgerMember.count.mockResolvedValue(1);

      await expect(service.updateMemberRole(ledgerId, 'owner-1', 'EDITOR')).rejects.toMatchObject({
        constructor: AppException,
        errorCode: 'LAST_OWNER_CANNOT_LEAVE',
      });
      expect(prisma.ledgerMember.update).not.toHaveBeenCalled();
    });

    it('allows demoting an owner when another owner remains', async () => {
      prisma.ledgerMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.ledgerMember.count.mockResolvedValue(2);
      prisma.ledgerMember.update.mockResolvedValue({
        userId: 'owner-1',
        role: 'EDITOR',
        user: { email: 'o@x.com', name: 'O' },
      });

      await expect(service.updateMemberRole(ledgerId, 'owner-1', 'EDITOR')).resolves.toMatchObject({
        role: 'EDITOR',
      });
    });
  });

  describe('removeMember', () => {
    it('lets a user remove themselves (leave)', async () => {
      prisma.ledgerMember.findUnique.mockResolvedValue({ role: 'EDITOR' });

      await service.removeMember(ledgerId, 'user-2', 'user-2');

      expect(prisma.ledgerMember.delete).toHaveBeenCalled();
    });

    it('forbids a non-owner from removing someone else', async () => {
      prisma.ledgerMember.findUnique
        .mockResolvedValueOnce({ role: 'EDITOR' }) // target
        .mockResolvedValueOnce({ role: 'EDITOR' }); // acting user

      await expect(service.removeMember(ledgerId, 'user-2', 'user-3')).rejects.toMatchObject({
        constructor: AppException,
        errorCode: 'CANNOT_MANAGE_OTHER_MEMBER',
      });
      expect(prisma.ledgerMember.delete).not.toHaveBeenCalled();
    });

    it('blocks removing the last owner (self-leave included)', async () => {
      prisma.ledgerMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.ledgerMember.count.mockResolvedValue(1);

      await expect(service.removeMember(ledgerId, 'owner-1', 'owner-1')).rejects.toMatchObject({
        constructor: AppException,
        errorCode: 'LAST_OWNER_CANNOT_LEAVE',
      });
      expect(prisma.ledgerMember.delete).not.toHaveBeenCalled();
    });

    it('lets an owner remove another member', async () => {
      prisma.ledgerMember.findUnique
        .mockResolvedValueOnce({ role: 'EDITOR' }) // target
        .mockResolvedValueOnce({ role: 'OWNER' }); // acting user

      await service.removeMember(ledgerId, 'user-2', 'owner-1');

      expect(prisma.ledgerMember.delete).toHaveBeenCalled();
    });

    it('404s when the target is not a member', async () => {
      prisma.ledgerMember.findUnique.mockResolvedValue(null);

      await expect(service.removeMember(ledgerId, 'ghost', 'owner-1')).rejects.toMatchObject({
        constructor: AppException,
        errorCode: 'NOT_FOUND',
      });
    });
  });
});
