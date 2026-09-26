import { createHash } from 'node:crypto';
import type { Clock } from '../common/clock';
import type { PrismaService } from '../prisma/prisma.service';
import { FriendInviteLinksService } from './friend-invite-links.service';

/**
 * 驗證邀請連結的三條規則：token 的形狀與落地形式（只存 SHA-256）、「有效」的定義
 * （未使用、未撤銷、未過期），以及接受時的檢查順序與競態處理。
 *
 * 策略：Prisma 全程 mock，`$transaction` 直接用同一個 mock client 執行 callback。
 * 時鐘用固定值注入，因此 10 分鐘過期與「剛好到期的那一瞬間」都能精確驗證。
 * 每個被拒絕的案例都額外驗證「沒有寫入發生」——錯誤訊息對了但連結被消耗掉，
 * 一樣是 bug。
 */
describe('FriendInviteLinksService', () => {
  const INVITER = '11111111-1111-4111-8111-111111111111';
  const ACCEPTER = '22222222-2222-4222-8222-222222222222';
  const LINK_ID = '33333333-3333-4333-8333-333333333333';
  const NOW = new Date('2026-09-23T12:00:00.000Z');
  const TEN_MINUTES_LATER = new Date('2026-09-23T12:10:00.000Z');
  const SINCE = new Date('2026-09-23T12:00:01.000Z');

  const inviter = { id: INVITER, name: 'Alice' };

  type LinkRow = {
    id: string;
    inviterId: string;
    tokenHash: string;
    expiresAt: Date;
    usedAt: Date | null;
    revokedAt: Date | null;
    usedById: string | null;
    inviter: { id: string; name: string };
  };

  /** 預設是一條有效連結；每個案例只覆寫自己關心的欄位。 */
  function linkRow(overrides: Partial<LinkRow> = {}): LinkRow {
    return {
      id: LINK_ID,
      inviterId: INVITER,
      tokenHash: 'hash',
      expiresAt: TEN_MINUTES_LATER,
      usedAt: null,
      revokedAt: null,
      usedById: null,
      inviter,
      ...overrides,
    };
  }

  let prisma: {
    friendInviteLink: {
      findUnique: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
    };
    friendship: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
    counterparty: { count: jest.Mock; create: jest.Mock };
    counterpartyLink: { findUnique: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: FriendInviteLinksService;
  let now: Date;

  beforeEach(() => {
    now = NOW;
    prisma = {
      friendInviteLink: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn((args: { data: unknown }) => Promise.resolve(args.data)),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      friendship: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() => Promise.resolve({ createdAt: SINCE })),
      },
      counterparty: {
        count: jest.fn(() => Promise.resolve(0)),
        create: jest.fn(({ data }: { data: { ownerId: string; askMerge: boolean } }) =>
          Promise.resolve({ id: `cp-${data.ownerId}`, askMerge: data.askMerge }),
        ),
      },
      counterpartyLink: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() => Promise.resolve({ id: 'link-1' })),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    const clock: Clock = () => now;
    service = new FriendInviteLinksService(prisma as unknown as PrismaService, clock);
  });

  function sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /** 讀出某次 mock 呼叫的第一個參數。jest 的 `calls` 型別是 `any`，在這裡一次收斂掉。 */
  function firstArg<T>(mock: jest.Mock, callIndex = 0): T {
    const args = (mock.mock.calls as unknown[][])[callIndex] ?? [];
    return args[0] as T;
  }

  describe('create', () => {
    it('returns a 43-character base64url token that differs on every call', async () => {
      const first = await service.create(INVITER);
      const second = await service.create(INVITER);

      expect(first.token).toHaveLength(43);
      expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(second.token).not.toBe(first.token);
    });

    it('stores only the hex SHA-256 of the token, never the token itself', async () => {
      const { token } = await service.create(INVITER);

      const stored = firstArg<{ data: { tokenHash: string } }>(prisma.friendInviteLink.create).data;
      expect(stored.tokenHash).toBe(sha256Hex(token));
      expect(JSON.stringify(stored)).not.toContain(token);
    });

    it('revokes the caller’s still-valid links before creating the new one', async () => {
      // 決策 7：每人同時只有一條有效連結，等於內建撤銷。
      await service.create(INVITER);

      expect(prisma.friendInviteLink.updateMany).toHaveBeenCalledWith({
        where: { inviterId: INVITER, usedAt: null, revokedAt: null, expiresAt: { gt: NOW } },
        data: { revokedAt: NOW },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('expires the new link exactly ten minutes after the injected clock', async () => {
      const created = await service.create(INVITER);

      expect(created.expiresAt).toBe(TEN_MINUTES_LATER.toISOString());
      expect(
        firstArg<{ data: { expiresAt: Date } }>(prisma.friendInviteLink.create).data.expiresAt,
      ).toEqual(TEN_MINUTES_LATER);
    });
  });

  describe('preview', () => {
    it('returns the inviter name and expiry without consuming the link', async () => {
      prisma.friendInviteLink.findUnique.mockResolvedValue(linkRow());

      await expect(service.preview('token')).resolves.toEqual({
        inviterName: 'Alice',
        expiresAt: TEN_MINUTES_LATER.toISOString(),
      });
      expect(prisma.friendInviteLink.updateMany).not.toHaveBeenCalled();
    });

    it('looks the link up by the hash, never by the token itself', async () => {
      prisma.friendInviteLink.findUnique.mockResolvedValue(linkRow());

      await service.preview('token');

      expect(firstArg<{ where: unknown }>(prisma.friendInviteLink.findUnique).where).toEqual({
        tokenHash: sha256Hex('token'),
      });
    });

    // 四種失效原因對外沒有差別（spec §3.2）：補救方法都是「請對方重新產生」。
    it.each([
      ['unknown', null],
      ['used', linkRow({ usedAt: NOW, usedById: ACCEPTER })],
      ['revoked', linkRow({ revokedAt: NOW })],
      ['expired', linkRow({ expiresAt: new Date('2026-09-23T11:59:59.000Z') })],
      ['expiring at this exact instant', linkRow({ expiresAt: NOW })],
    ])('rejects a %s link with 404 INVITE_LINK_INVALID', async (_label, row) => {
      prisma.friendInviteLink.findUnique.mockResolvedValue(row);

      await expect(service.preview('token')).rejects.toMatchObject({
        status: 404,
        errorCode: 'INVITE_LINK_INVALID',
        message: 'This invite link is no longer valid. Ask for a new one.',
      });
    });

    it('never puts the token into the error message', async () => {
      const error = await service.preview('secret-token').catch((caught: Error) => caught);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('secret-token');
    });
  });

  describe('accept', () => {
    it('consumes the link and returns the new linked counterparty', async () => {
      prisma.friendInviteLink.findUnique.mockResolvedValue(linkRow());

      const friend = await service.accept(ACCEPTER, 'token');

      expect(friend).toEqual({
        counterpartyId: `cp-${ACCEPTER}`,
        askMerge: false,
        otherUser: inviter,
      });
      expect(prisma.friendInviteLink.updateMany).toHaveBeenCalledWith({
        where: { id: LINK_ID, usedAt: null, revokedAt: null, expiresAt: { gt: NOW } },
        data: { usedAt: NOW, usedById: ACCEPTER },
      });
      expect(prisma.friendship.create).toHaveBeenCalledTimes(1);
    });

    it('orders the friendship pair by id, the way friendship.ts requires', async () => {
      prisma.friendInviteLink.findUnique.mockResolvedValue(linkRow());

      await service.accept(ACCEPTER, 'token');

      expect(prisma.friendship.create).toHaveBeenCalledWith({
        data: { userLowId: INVITER, userHighId: ACCEPTER },
      });
    });

    it.each([
      ['unknown', null],
      ['used', linkRow({ usedAt: NOW, usedById: ACCEPTER })],
      ['revoked', linkRow({ revokedAt: NOW })],
      ['expired', linkRow({ expiresAt: new Date('2026-09-23T11:59:59.000Z') })],
      ['expiring at this exact instant', linkRow({ expiresAt: NOW })],
    ])('rejects a %s link with 404 and writes nothing', async (_label, row) => {
      prisma.friendInviteLink.findUnique.mockResolvedValue(row);

      await expect(service.accept(ACCEPTER, 'token')).rejects.toMatchObject({
        status: 404,
        errorCode: 'INVITE_LINK_INVALID',
      });
      expect(prisma.friendInviteLink.updateMany).not.toHaveBeenCalled();
      expect(prisma.friendship.create).not.toHaveBeenCalled();
    });

    it('rejects accepting your own link with 400 CANNOT_FRIEND_SELF', async () => {
      prisma.friendInviteLink.findUnique.mockResolvedValue(linkRow());

      await expect(service.accept(INVITER, 'token')).rejects.toMatchObject({
        status: 400,
        errorCode: 'CANNOT_FRIEND_SELF',
      });
      expect(prisma.friendInviteLink.updateMany).not.toHaveBeenCalled();
      expect(prisma.friendship.create).not.toHaveBeenCalled();
    });

    it('links existing friends', async () => {
      prisma.friendInviteLink.findUnique.mockResolvedValue(linkRow());
      prisma.friendship.findUnique.mockResolvedValue({ userLowId: INVITER });

      await expect(service.accept(ACCEPTER, 'token')).resolves.toMatchObject({
        counterpartyId: `cp-${ACCEPTER}`,
      });
      expect(prisma.friendInviteLink.updateMany).toHaveBeenCalled();
      expect(prisma.friendship.create).not.toHaveBeenCalled();
    });

    it('rejects with 404 when someone else won the race for the same link', async () => {
      // 條件式更新沒改到任何一列，代表另一個請求先消耗掉了這條連結。
      prisma.friendInviteLink.findUnique.mockResolvedValue(linkRow());
      prisma.friendInviteLink.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.accept(ACCEPTER, 'token')).rejects.toMatchObject({
        status: 404,
        errorCode: 'INVITE_LINK_INVALID',
      });
      expect(prisma.friendship.create).not.toHaveBeenCalled();
    });

    it('runs the whole acceptance inside one transaction', async () => {
      prisma.friendInviteLink.findUnique.mockResolvedValue(linkRow());

      await service.accept(ACCEPTER, 'token');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
