import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { FriendRequestsService } from './friend-requests.service';

/**
 * `FriendRequestsService.create()`：以 email 送出邀請。
 *
 * 這個 suite 驗證兩件事。第一是**六個分支的順序**（spec §5、決策 3、8、9）：使用者不存在 →
 * 邀請自己 → 已是好友 → 對方已反向邀請 → 自己已有待回應的邀請 → 建立新邀請。順序錯了
 * 會洩漏資訊，例如「已是好友」排在「邀請自己」前面，就會對自己回出奇怪的錯誤。第二是
 * **決策 8 的捷徑**：對方已邀請我時直接成為好友，不另建一筆。
 *
 * 策略：Prisma 全程 mock，`$transaction` 直接把同一個 mock 當作 tx 執行 callback。
 */
describe('FriendRequestsService.create', () => {
  const ME = '11111111-1111-4111-8111-111111111111';
  const OTHER = '22222222-2222-4222-8222-222222222222';
  const REQUEST_ID = '44444444-4444-4444-8444-444444444444';
  const NOW = new Date('2026-09-23T12:00:00.000Z');
  const CREATED_AT = new Date('2026-09-20T00:00:00.000Z');
  const EMAIL = 'bob@example.com';

  const otherUser = { id: OTHER, name: 'Bob', email: EMAIL };
  const p2002 = new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
  });

  /** 一筆由 OTHER 送給 ME 的待回應邀請（決策 8 的前提）。 */
  function reverseRow() {
    return {
      id: REQUEST_ID,
      requesterId: OTHER,
      recipientId: ME,
      status: 'PENDING' as const,
      respondedAt: null,
      createdAt: CREATED_AT,
      requester: { id: OTHER, name: 'Bob' },
      recipient: { id: ME, name: 'Alice', email: 'alice@example.com' },
    };
  }

  let prisma: ReturnType<typeof buildPrisma>;
  let service: FriendRequestsService;

  function buildPrisma() {
    const mock = {
      user: { findUnique: jest.fn(() => Promise.resolve(otherUser)) },
      friendRequest: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(),
        updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      },
      friendship: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() =>
          Promise.resolve({ userLowId: ME, userHighId: OTHER, createdAt: NOW }),
        ),
      },
      $transaction: jest.fn((arg: unknown): unknown =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => unknown)(mock)
          : Promise.all(arg as []),
      ),
    };
    return mock;
  }

  beforeEach(() => {
    prisma = buildPrisma();
    service = new FriendRequestsService(prisma as unknown as PrismaService, () => NOW);
  });

  async function expectRejected(promise: Promise<unknown>, status: number, errorCode: string) {
    const error = await promise.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).getStatus()).toBe(status);
    expect((error as AppException).errorCode).toBe(errorCode);
  }

  function expectNoWrites() {
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
    expect(prisma.friendRequest.updateMany).not.toHaveBeenCalled();
    expect(prisma.friendship.create).not.toHaveBeenCalled();
  }

  // 分支 1：決策 3——打錯 email 時要讓使用者知道，所以明確回 404 而不是假裝成功。
  it('rejects an email that no user has (404 USER_NOT_FOUND)', async () => {
    prisma.user.findUnique.mockResolvedValue(null as never);
    await expectRejected(service.create(ME, EMAIL), 404, 'USER_NOT_FOUND');
    expectNoWrites();
  });

  // 分支 2：排在「已是好友」之前，否則邀請自己會拿到莫名其妙的錯誤。
  it('rejects inviting yourself (400 CANNOT_FRIEND_SELF)', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...otherUser, id: ME });
    await expectRejected(service.create(ME, EMAIL), 400, 'CANNOT_FRIEND_SELF');
    expect(prisma.friendship.findUnique).not.toHaveBeenCalled();
    expectNoWrites();
  });

  // 分支 3。
  it('rejects someone who is already a friend (409 ALREADY_FRIENDS)', async () => {
    prisma.friendship.findUnique.mockResolvedValue({ userLowId: ME } as never);
    await expectRejected(service.create(ME, EMAIL), 409, 'ALREADY_FRIENDS');
    expect(prisma.friendRequest.findFirst).not.toHaveBeenCalled();
    expectNoWrites();
  });

  // 分支 4（決策 8）：雙方都表達了意願，直接成立好友關係。
  describe('when the other person already invited me (decision 8)', () => {
    beforeEach(() => {
      prisma.friendRequest.findFirst.mockResolvedValue(reverseRow() as never);
    });

    it('accepts their request instead of creating a new row', async () => {
      const result = await service.create(ME, EMAIL);

      expect(prisma.friendRequest.create).not.toHaveBeenCalled();
      expect(prisma.friendRequest.updateMany).toHaveBeenCalledWith({
        where: { id: REQUEST_ID, status: 'PENDING' },
        data: { status: 'ACCEPTED', respondedAt: NOW },
      });
      expect(result.id).toBe(REQUEST_ID);
      expect(result.status).toBe('ACCEPTED');
      // 我是那筆邀請的收件者，所以從我的角度它是「收到的」。
      expect(result.direction).toBe('incoming');
      expect(result.respondedAt).toBe(NOW.toISOString());
    });

    it('creates the friendship in the same transaction', async () => {
      await service.create(ME, EMAIL);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.friendship.create).toHaveBeenCalledTimes(1);
      expect(prisma.friendship.create).toHaveBeenCalledWith({
        data: { userLowId: ME, userHighId: OTHER },
      });
    });

    // 雙方可能已透過邀請連結成為好友：邀請仍要標記完成，但不能再建一筆關係。
    it('still marks the request accepted when the two are already friends', async () => {
      prisma.friendship.findUnique.mockImplementation(() =>
        Promise.resolve({ userLowId: ME } as never),
      );
      // 第 3 個分支要先放行，否則測不到交易內的這段。
      prisma.friendship.findUnique.mockResolvedValueOnce(null);

      const result = await service.create(ME, EMAIL);

      expect(result.status).toBe('ACCEPTED');
      expect(prisma.friendship.create).not.toHaveBeenCalled();
    });

    // 讀出之後、更新之前對方取消了：條件式更新會是 0 筆，不能假裝成功。
    it('rejects when their request stopped being pending in between', async () => {
      prisma.friendRequest.updateMany.mockResolvedValue({ count: 0 });
      await expectRejected(service.create(ME, EMAIL), 409, 'FRIEND_REQUEST_NOT_PENDING');
      expect(prisma.friendship.create).not.toHaveBeenCalled();
    });
  });

  // 分支 5。
  it('rejects a second request to the same person (409 FRIEND_REQUEST_PENDING)', async () => {
    prisma.friendRequest.findFirst
      .mockResolvedValueOnce(null) // 反向：沒有
      .mockResolvedValueOnce({ id: REQUEST_ID } as never); // 自己送出的：有一筆待回應
    await expectRejected(service.create(ME, EMAIL), 409, 'FRIEND_REQUEST_PENDING');
    expectNoWrites();
  });

  // 分支 6。
  it('creates a pending request and shows only the email I typed', async () => {
    prisma.friendRequest.create.mockResolvedValue({
      id: REQUEST_ID,
      requesterId: ME,
      recipientId: OTHER,
      status: 'PENDING',
      respondedAt: null,
      createdAt: CREATED_AT,
      requester: { id: ME, name: 'Alice' },
      recipient: otherUser,
    });

    const result = await service.create(ME, EMAIL);

    expect(prisma.friendRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { requesterId: ME, recipientId: OTHER } }),
    );
    expect(result.direction).toBe('outgoing');
    expect(result.status).toBe('PENDING');
    // 決策 11：尚未被接受，所以不洩漏對方的名字。
    expect(result.counterpart).toEqual({ userId: null, name: null, email: EMAIL });
    expect(result.respondedAt).toBeNull();
  });

  // 兩個請求同時通過上面的檢查時，由部分唯一索引擋下第二筆。
  it('turns a P2002 from the partial unique index into 409 FRIEND_REQUEST_PENDING', async () => {
    prisma.friendRequest.create.mockRejectedValue(p2002);
    await expectRejected(service.create(ME, EMAIL), 409, 'FRIEND_REQUEST_PENDING');
  });

  it('lets an unrelated Prisma error through unchanged', async () => {
    const boom = new Error('connection lost');
    prisma.friendRequest.create.mockRejectedValue(boom);
    await expect(service.create(ME, EMAIL)).rejects.toBe(boom);
  });

  // 決策 9：被拒絕後沒有冷卻期，舊的 DECLINED 邀請不該擋下新的一筆。
  it('does not let a declined request block a new one', async () => {
    prisma.friendRequest.create.mockResolvedValue({
      id: 'new-request',
      requesterId: ME,
      recipientId: OTHER,
      status: 'PENDING',
      respondedAt: null,
      createdAt: CREATED_AT,
      requester: { id: ME, name: 'Alice' },
      recipient: otherUser,
    });

    const result = await service.create(ME, EMAIL);

    // 兩次查詢都只找 PENDING，所以 DECLINED 的舊邀請根本不在考慮範圍內。
    const findFirstCalls = prisma.friendRequest.findFirst.mock.calls as unknown as Array<
      [{ where: { status: string } }]
    >;
    expect(findFirstCalls).toHaveLength(2);
    for (const [args] of findFirstCalls) {
      expect(args.where.status).toBe('PENDING');
    }
    expect(result.status).toBe('PENDING');
  });
});
