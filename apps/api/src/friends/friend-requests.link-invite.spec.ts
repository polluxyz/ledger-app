import { AppException } from '../common/exceptions/app.exception';
import type { PrismaService } from '../prisma/prisma.service';
import { FriendRequestsService } from './friend-requests.service';

/**
 * 從對象送出連動邀請（spec 3b-2 決策 56、57、61；plan §3.2）的檢查順序。
 *
 * 順序就是錯誤的優先順序：對象是自己的 → 對方存在 → 不是自己 → 沒有連動 → 對方沒有先邀請我。
 * 每個分支都斷言「沒有寫入」，因為被擋下的請求不該留下任何邀請。
 * 策略：Prisma 全程 mock；真正的建立、接受與競態由 e2e 驗。
 */
describe('FriendRequestsService.createLinkInvite', () => {
  const ME = 'user-a';
  const OTHER = 'user-b';
  const COUNTERPARTY = 'cp-1';
  const EMAIL = 'bob@example.com';
  const NOW = new Date('2026-09-25T00:00:00.000Z');

  function buildPrisma() {
    return {
      counterparty: {
        findFirst: jest.fn().mockResolvedValue({ id: COUNTERPARTY, ownerId: ME, name: '小明' }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: OTHER }) },
      counterpartyLink: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      friendRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'request-1',
          requesterId: ME,
          recipientId: OTHER,
          counterpartyId: COUNTERPARTY,
          status: 'PENDING',
          respondedAt: null,
          createdAt: NOW,
          requester: { id: ME, name: 'Alice' },
          recipient: { id: OTHER, name: 'Bob', email: EMAIL },
        }),
      },
    };
  }

  let prisma: ReturnType<typeof buildPrisma>;
  let service: FriendRequestsService;

  beforeEach(() => {
    prisma = buildPrisma();
    service = new FriendRequestsService(prisma as unknown as PrismaService, () => NOW);
  });

  async function expectRejected(status: number, errorCode: string) {
    const error = await service.createLinkInvite(ME, COUNTERPARTY, EMAIL).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).getStatus()).toBe(status);
    expect((error as AppException).errorCode).toBe(errorCode);
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
  }

  it('rejects someone else’s counterparty before looking up the email (404)', async () => {
    prisma.counterparty.findFirst.mockResolvedValue(null);
    await expectRejected(404, 'NOT_FOUND');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an unknown email (404 USER_NOT_FOUND)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expectRejected(404, 'USER_NOT_FOUND');
  });

  it('rejects inviting yourself (400 CANNOT_FRIEND_SELF)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: ME });
    await expectRejected(400, 'CANNOT_FRIEND_SELF');
  });

  it('rejects when the two are already linked (409 ALREADY_LINKED)', async () => {
    prisma.counterpartyLink.findUnique.mockResolvedValue({ id: 'link-1' });
    await expectRejected(409, 'ALREADY_LINKED');
  });

  it('rejects when this counterparty is linked to someone else (409 ALREADY_LINKED)', async () => {
    prisma.counterpartyLink.findFirst.mockResolvedValue({ id: 'link-2' });
    await expectRejected(409, 'ALREADY_LINKED');
  });

  it('points to their pending link invite instead of auto-accepting it (409)', async () => {
    prisma.friendRequest.findFirst.mockResolvedValue({ id: 'their-invite' });
    await expectRejected(409, 'LINK_INVITE_FROM_THEM');
  });

  it('creates a link invite even when they are already friends', async () => {
    const created = await service.createLinkInvite(ME, COUNTERPARTY, EMAIL);
    expect(prisma.friendRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { requesterId: ME, recipientId: OTHER, counterpartyId: COUNTERPARTY },
      }),
    );
    // 送出、尚未被接受：只回我自己輸入的 email（3a 決策 11）。
    expect(created).toMatchObject({
      forLink: true,
      direction: 'outgoing',
      counterpart: { userId: null, name: null, email: EMAIL },
    });
  });
});
