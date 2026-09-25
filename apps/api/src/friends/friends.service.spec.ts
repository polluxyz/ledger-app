import { PrismaService } from '../prisma/prisma.service';
import { FriendsService } from './friends.service';

/**
 * 驗證好友清單與解除好友的三件事：
 *   1. 一對好友只存一筆，呼叫者可能在 `userLowId` 或 `userHighId` 任一側，兩種情況
 *      都要映射成「另一位」。
 *   2. 回應只有 `userId`、`name`、`since` 三個欄位——不得混入 email（決策 10）。
 *   3. 解除好友以排序後的 pair 刪除，刪不到就 404；解除自己在碰到 Prisma 之前就擋下。
 *
 * Prisma 全程 mock，不連資料庫；斷言看的是傳給 Prisma 的參數與回傳的形狀。
 */
/** 傳給 `friendship.findMany` 的參數，只列出測試會斷言的欄位。 */
interface FindManyArgs {
  where: unknown;
  orderBy: unknown[];
  skip: number;
  take: number;
}

/** mock 的 `calls` 是 `any`，統一在這裡收斂成上面的型別，測試本體才不必碰 `any`。 */
function firstFindManyArgs(mock: jest.Mock): FindManyArgs {
  const calls = mock.mock.calls as unknown[][];
  const [first] = calls;
  if (first === undefined) {
    throw new Error('firstFindManyArgs: findMany was never called');
  }
  return first[0] as FindManyArgs;
}

describe('FriendsService', () => {
  let service: FriendsService;
  let prisma: {
    friendship: { findMany: jest.Mock; count: jest.Mock; deleteMany: jest.Mock };
    counterpartyLink: { findUnique: jest.Mock; delete: jest.Mock };
    debtEntry: { updateMany: jest.Mock };
    debtProposal: { updateMany: jest.Mock };
    friendRequest: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  };

  // 排序用的固定 id：'user-a' < 'user-b' < 'user-c'（UTF-16 順序）。
  const me = 'user-b';
  const alice = { id: 'user-a', name: 'Alice' };
  const carol = { id: 'user-c', name: 'Carol' };

  beforeEach(() => {
    prisma = {
      friendship: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // 解除好友連帶解除連動（3b-2 決策 70）。這裡預設沒有連動；連動的解除由 e2e 驗（SC-K12）。
      counterpartyLink: {
        findUnique: jest.fn().mockResolvedValue(null),
        delete: jest.fn(),
      },
      debtEntry: { updateMany: jest.fn() },
      debtProposal: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      friendRequest: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown): unknown => callback(prisma)),
    };
    service = new FriendsService(prisma as unknown as PrismaService);
  });

  describe('list', () => {
    it('maps to the other user whichever side the caller is on', async () => {
      // 對 Alice 來說我是 high 的一側；對 Carol 來說我是 low 的一側。
      prisma.friendship.findMany.mockResolvedValue([
        {
          userLowId: alice.id,
          userHighId: me,
          createdAt: new Date('2026-09-02T00:00:00.000Z'),
          userLow: alice,
          userHigh: { id: me, name: 'Me' },
        },
        {
          userLowId: me,
          userHighId: carol.id,
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          userLow: { id: me, name: 'Me' },
          userHigh: carol,
        },
      ]);
      prisma.friendship.count.mockResolvedValue(2);

      const result = await service.list(me, {});

      expect(result.items).toEqual([
        { userId: alice.id, name: 'Alice', since: '2026-09-02T00:00:00.000Z' },
        { userId: carol.id, name: 'Carol', since: '2026-09-01T00:00:00.000Z' },
      ]);
      expect(result.total).toBe(2);
    });

    it('returns exactly userId, name and since — never an email', async () => {
      prisma.friendship.findMany.mockResolvedValue([
        {
          userLowId: alice.id,
          userHighId: me,
          createdAt: new Date('2026-09-02T00:00:00.000Z'),
          // 就算 join 多帶了 email 回來，也不能流進回應。
          userLow: { ...alice, email: 'alice@example.com' },
          userHigh: { id: me, name: 'Me' },
        },
      ]);
      prisma.friendship.count.mockResolvedValue(1);

      const result = await service.list(me, {});

      expect(result.items).toHaveLength(1);
      expect(Object.keys(result.items[0] ?? {}).sort()).toEqual(['name', 'since', 'userId']);
    });

    it('matches both sides of the pair and sorts newest first', async () => {
      await service.list(me, {});

      const args = firstFindManyArgs(prisma.friendship.findMany);
      expect(args.where).toEqual({ OR: [{ userLowId: me }, { userHighId: me }] });
      expect(args.orderBy[0]).toEqual({ createdAt: 'desc' });
      // total 只算呼叫者自己的關係，用的是同一組條件。
      expect(prisma.friendship.count).toHaveBeenCalledWith({ where: args.where });
    });

    it('defaults to page 1 with 20 per page', async () => {
      const result = await service.list(me, {});

      expect(firstFindManyArgs(prisma.friendship.findMany)).toMatchObject({ skip: 0, take: 20 });
      expect(result).toMatchObject({ page: 1, limit: 20 });
    });

    it('clamps an oversized limit to 100', async () => {
      const result = await service.list(me, { page: 3, limit: 500 });

      expect(firstFindManyArgs(prisma.friendship.findMany)).toMatchObject({
        skip: 200,
        take: 100,
      });
      expect(result).toMatchObject({ page: 3, limit: 100 });
    });
  });

  describe('remove', () => {
    it('deletes with the ordered pair whichever way round the arguments are', async () => {
      const orderedPair = { userLowId: alice.id, userHighId: me };

      await service.remove(me, alice.id);
      expect(prisma.friendship.deleteMany).toHaveBeenCalledWith({ where: orderedPair });

      prisma.friendship.deleteMany.mockClear();

      await service.remove(alice.id, me);
      expect(prisma.friendship.deleteMany).toHaveBeenCalledWith({ where: orderedPair });
    });

    it('gives 404 when the two are not friends', async () => {
      prisma.friendship.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.remove(me, carol.id)).rejects.toMatchObject({
        status: 404,
        errorCode: 'NOT_FOUND',
        message: 'Friend not found.',
      });
    });

    it('gives 404 for unfriending yourself, without touching Prisma', async () => {
      // `orderPair` 對兩個相同的 id 會丟出 Error，所以這個檢查必須排在它前面。
      await expect(service.remove(me, me)).rejects.toMatchObject({
        status: 404,
        errorCode: 'NOT_FOUND',
      });
      expect(prisma.friendship.deleteMany).not.toHaveBeenCalled();
    });
  });
});
