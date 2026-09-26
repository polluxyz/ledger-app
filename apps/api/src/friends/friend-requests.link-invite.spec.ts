import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { FriendRequestsService } from './friend-requests.service';

/** 邀請不再綁對象；檢查順序仍須避免建立無效邀請。 */
describe('FriendRequestsService.create linking invite', () => {
  const ME = 'user-a';
  const OTHER = 'user-b';
  const EMAIL = 'bob@example.com';
  const NOW = new Date('2026-09-25T00:00:00.000Z');

  function buildPrisma() {
    return {
      user: { findUnique: jest.fn().mockResolvedValue({ id: OTHER }) },
      counterpartyLink: { findUnique: jest.fn().mockResolvedValue(null) },
      friendRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'request-1',
          requesterId: ME,
          recipientId: OTHER,
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

  async function expectRejected(status: number, errorCode: string, attemptedWrite = false) {
    const error = await service.create(ME, EMAIL).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).getStatus()).toBe(status);
    expect((error as AppException).errorCode).toBe(errorCode);
    if (!attemptedWrite) expect(prisma.friendRequest.create).not.toHaveBeenCalled();
  }

  it('rejects an unknown email', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expectRejected(404, 'USER_NOT_FOUND');
  });

  it('rejects self-invites', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: ME });
    await expectRejected(400, 'CANNOT_FRIEND_SELF');
  });

  it('rejects an already linked pair', async () => {
    prisma.counterpartyLink.findUnique.mockResolvedValue({ id: 'link-1' });
    await expectRejected(409, 'ALREADY_LINKED');
  });

  it('points to the reverse pending invite', async () => {
    prisma.friendRequest.findFirst.mockResolvedValueOnce({ id: 'their-invite' });
    await expectRejected(409, 'LINK_INVITE_FROM_THEM');
  });

  it('rejects an existing outgoing pending invite', async () => {
    prisma.friendRequest.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'own' });
    await expectRejected(409, 'FRIEND_REQUEST_PENDING');
  });

  it('maps a simultaneous duplicate to FRIEND_REQUEST_PENDING', async () => {
    prisma.friendRequest.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.8.0',
      }),
    );
    await expectRejected(409, 'FRIEND_REQUEST_PENDING', true);
  });

  it('creates a request without choosing a counterparty', async () => {
    const created = await service.create(ME, EMAIL);
    expect(prisma.friendRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { requesterId: ME, recipientId: OTHER },
      }),
    );
    expect(created).toMatchObject({ direction: 'outgoing', counterpart: { email: EMAIL } });
  });
});
