import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { LedgersService } from './ledgers.service';

/**
 * 聚焦成員管理的不變量（最具安全性關鍵的邏輯）：加入成員的查無／重複、最後一位
 * owner 不可降級或移除、非 owner 不可移除他人、可自行退出。Prisma 全程 mock；
 * $transaction 直接以同一個 mock client 執行其 callback。
 */
describe('LedgersService (members)', () => {
  let service: LedgersService;
  let prisma: {
    user: { findUnique: jest.Mock };
    ledger: { findUnique: jest.Mock; update: jest.Mock; delete: jest.Mock };
    ledgerMember: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    transaction: { count: jest.Mock };
    $transaction: jest.Mock;
  };

  const ledgerId = 'ledger-1';
  const ledgerRow = {
    id: ledgerId,
    name: '家庭帳本',
    currency: 'TWD',
    // 這個測試檔的重心是成員管理，所以預設用共享帳本——私人帳本根本加不了人。
    kind: 'SHARED' as const,
    tracksBalance: true,
    archivedAt: null as Date | null,
    createdAt: new Date('2026-08-13T00:00:00.000Z'),
    members: [],
  };

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn() },
      ledger: {
        findUnique: jest.fn().mockResolvedValue(ledgerRow),
        update: jest.fn().mockResolvedValue(ledgerRow),
        delete: jest.fn(),
      },
      ledgerMember: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      transaction: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    service = new LedgersService(prisma as unknown as PrismaService);
  });

  describe('tracksBalance', () => {
    it('rejects any attempt to change it after creation', async () => {
      // 事後翻轉會讓每位成員的餘額瞬間跳動，畫面上卻沒有任何線索。
      await expect(service.rename(ledgerId, '新名字', false)).rejects.toMatchObject({
        status: 400,
        errorCode: 'TRACKS_BALANCE_IMMUTABLE',
      });
      expect(prisma.ledger.update).not.toHaveBeenCalled();
    });

    it('renames normally when it is not supplied', async () => {
      await service.rename(ledgerId, '新名字');

      expect(prisma.ledger.update).toHaveBeenCalledWith({
        where: { id: ledgerId },
        data: { name: '新名字' },
      });
    });
  });

  describe('archive', () => {
    it('stamps archivedAt', async () => {
      await service.archive(ledgerId);

      expect(prisma.ledger.update).toHaveBeenCalledWith({
        where: { id: ledgerId },
        data: { archivedAt: expect.any(Date) as Date },
      });
    });

    it('does not overwrite an existing archive time', async () => {
      prisma.ledger.findUnique.mockResolvedValue({
        ...ledgerRow,
        archivedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      await service.archive(ledgerId);

      // 封存時間是稽核資訊，第二次呼叫不該把它抹掉。
      expect(prisma.ledger.update).not.toHaveBeenCalled();
    });
  });

  describe('listForUser', () => {
    it('excludes archived ledgers by default', async () => {
      prisma.ledgerMember.findMany.mockResolvedValue([]);

      await service.listForUser('user-1');

      expect(prisma.ledgerMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', ledger: { archivedAt: null } },
        }),
      );
    });

    it('includes them when asked', async () => {
      prisma.ledgerMember.findMany.mockResolvedValue([]);

      await service.listForUser('user-1', true);

      expect(prisma.ledgerMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
    });
  });

  describe('remove', () => {
    it('400s when confirm does not match the ledger name', async () => {
      await expect(service.remove(ledgerId, 'user-1', '打錯的名字')).rejects.toMatchObject({
        status: 400,
        errorCode: 'VALIDATION_FAILED',
      });
      expect(prisma.ledger.delete).not.toHaveBeenCalled();
    });

    it('409s when other members have recorded transactions', async () => {
      // 刪掉會讓別人的交易一起消失，他們的餘額被回溯性改變且無從察覺。
      prisma.transaction.count.mockResolvedValue(3);

      await expect(service.remove(ledgerId, 'user-1', ledgerRow.name)).rejects.toMatchObject({
        status: 409,
        errorCode: 'LEDGER_HAS_OTHERS_TRANSACTIONS',
      });
      expect(prisma.ledger.delete).not.toHaveBeenCalled();
    });

    it('counts soft-deleted transactions as other members’ records too', async () => {
      await service.remove(ledgerId, 'user-1', ledgerRow.name);

      // 不過濾 deletedAt：軟刪除的仍是別人的紀錄，且仍佔著他的帳戶引用。
      expect(prisma.transaction.count).toHaveBeenCalledWith({
        where: { ledgerId, creatorId: { not: 'user-1' } },
      });
    });

    it('deletes a ledger holding only the caller’s own transactions', async () => {
      await service.remove(ledgerId, 'user-1', ledgerRow.name);

      expect(prisma.ledger.delete).toHaveBeenCalledWith({ where: { id: ledgerId } });
    });
  });

  describe('kind', () => {
    it('rejects any attempt to change it after creation', async () => {
      // 事後翻轉等於讓「誰看得到我的帳」在使用者沒有心理準備時改變。
      await expect(service.rename(ledgerId, '新名字', undefined, 'SHARED')).rejects.toMatchObject({
        status: 400,
        errorCode: 'LEDGER_KIND_IMMUTABLE',
      });
      expect(prisma.ledger.update).not.toHaveBeenCalled();
    });

    it('blocks adding members to a personal ledger, even for the owner', async () => {
      prisma.ledger.findUnique.mockResolvedValue({ ...ledgerRow, kind: 'PERSONAL' });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
      prisma.ledgerMember.findUnique.mockResolvedValue(null);

      await expect(service.addMember(ledgerId, 'bob@x.com', 'EDITOR')).rejects.toMatchObject({
        constructor: AppException,
        status: 409,
        errorCode: 'PERSONAL_LEDGER_CANNOT_SHARE',
      });
      expect(prisma.ledgerMember.create).not.toHaveBeenCalled();
    });

    it('checks the ledger kind before looking the user up', async () => {
      // 順序有意義：先查使用者的話，對私人帳本送一個沒註冊的 email 會回
      // USER_NOT_FOUND，等於洩漏了該 email 未註冊——而呼叫者本就無權對這本
      // 帳本做任何成員操作。
      prisma.ledger.findUnique.mockResolvedValue({ ...ledgerRow, kind: 'PERSONAL' });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.addMember(ledgerId, 'ghost@x.com', 'EDITOR')).rejects.toMatchObject({
        errorCode: 'PERSONAL_LEDGER_CANNOT_SHARE',
      });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('keeps a shared ledger shared even when only one member is left', async () => {
      // 共享帳本不會因為其他人退光而變回私人，所以它加得回人。這正是「不能用
      // 成員數推導 kind」的具體證據。
      prisma.ledgerMember.count.mockResolvedValue(1);
      prisma.ledgerMember.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });
      prisma.ledgerMember.create.mockResolvedValue({
        userId: 'user-2',
        role: 'EDITOR',
        user: { email: 'bob@x.com', name: 'Bob' },
      });

      await expect(service.addMember(ledgerId, 'bob@x.com', 'EDITOR')).resolves.toMatchObject({
        userId: 'user-2',
      });
    });
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
        .mockResolvedValueOnce({ role: 'EDITOR' }) // 被移除者（target）
        .mockResolvedValueOnce({ role: 'EDITOR' }); // 操作者（acting user）

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
        .mockResolvedValueOnce({ role: 'EDITOR' }) // 被移除者（target）
        .mockResolvedValueOnce({ role: 'OWNER' }); // 操作者（acting user）

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
