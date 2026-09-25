import type { FriendRequestStatus } from '@ledger/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { FriendRequestsService } from './friend-requests.service';

/**
 * `FriendRequestsService.list()` 與回應的對方資訊。
 *
 * 兩個重點。第一是**清單查詢**：`direction` 決定拿哪個欄位比對呼叫者（所以查不到別人的
 * 清單）、`status` 是選填的篩選、排序新到舊、分頁預設 1／20 且上限夾在 100。第二是
 * **對方資訊的三條規則**（決策 10、11）——收到的邀請給名字，送出且未接受的只給我輸入的
 * email，送出且已接受的給名字。email 外洩的風險就在這三條規則上。
 *
 * 策略：Prisma 全程 mock，只檢查傳給 Prisma 的查詢條件與轉出來的回應形狀。
 */
describe('FriendRequestsService.list and counterpart mapping', () => {
  const ME = '11111111-1111-4111-8111-111111111111';
  const OTHER = '22222222-2222-4222-8222-222222222222';
  const NOW = new Date('2026-09-23T12:00:00.000Z');
  const CREATED_AT = new Date('2026-09-20T00:00:00.000Z');

  let prisma: {
    friendRequest: { findMany: jest.Mock; count: jest.Mock };
  };
  let service: FriendRequestsService;

  /** 一列邀請。`from` 指定是誰送出的，由此決定它對 ME 而言是收到的還是送出的。 */
  function row(from: 'me' | 'other', status: FriendRequestStatus) {
    const mine = from === 'me';
    return {
      id: `request-${from}-${status}`,
      requesterId: mine ? ME : OTHER,
      recipientId: mine ? OTHER : ME,
      counterpartyId: null,
      status,
      respondedAt: status === 'PENDING' ? null : NOW,
      createdAt: CREATED_AT,
      requester: mine ? { id: ME, name: 'Alice' } : { id: OTHER, name: 'Bob' },
      recipient: mine
        ? { id: OTHER, name: 'Bob', email: 'bob@example.com' }
        : { id: ME, name: 'Alice', email: 'alice@example.com' },
    };
  }

  beforeEach(() => {
    prisma = {
      friendRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    service = new FriendRequestsService(prisma as unknown as PrismaService, () => NOW);
  });

  interface FindManyArgs {
    where: Record<string, unknown>;
    orderBy: unknown;
    skip: number;
    take: number;
  }

  /** 取出這次 `findMany` 收到的參數，用來斷言 where / orderBy / 分頁。 */
  function lastFindManyArgs(): FindManyArgs {
    const calls = prisma.friendRequest.findMany.mock.calls as unknown as Array<[FindManyArgs]>;
    const call = calls[0];
    if (call === undefined) {
      throw new Error('list() never queried findMany');
    }
    return call[0];
  }

  describe('query', () => {
    it('matches incoming requests on recipientId', async () => {
      await service.list(ME, { direction: 'incoming' });
      expect(lastFindManyArgs().where).toEqual({ recipientId: ME });
      expect(prisma.friendRequest.count).toHaveBeenCalledWith({ where: { recipientId: ME } });
    });

    it('matches outgoing requests on requesterId', async () => {
      await service.list(ME, { direction: 'outgoing' });
      expect(lastFindManyArgs().where).toEqual({ requesterId: ME });
    });

    it('adds the optional status filter', async () => {
      await service.list(ME, { direction: 'outgoing', status: 'DECLINED' });
      expect(lastFindManyArgs().where).toEqual({ requesterId: ME, status: 'DECLINED' });
    });

    it('returns the newest request first', async () => {
      await service.list(ME, { direction: 'incoming' });
      expect(lastFindManyArgs().orderBy).toEqual({ createdAt: 'desc' });
    });
  });

  describe('pagination', () => {
    it('defaults to page 1 and 20 per page', async () => {
      const result = await service.list(ME, { direction: 'incoming' });
      expect(lastFindManyArgs()).toMatchObject({ skip: 0, take: 20 });
      expect(result).toMatchObject({ page: 1, limit: 20, total: 0 });
    });

    it('skips the pages before the requested one', async () => {
      await service.list(ME, { direction: 'incoming', page: 3, limit: 5 });
      expect(lastFindManyArgs()).toMatchObject({ skip: 10, take: 5 });
    });

    // 超過上限時夾住，而不是報錯——客戶端要的是資料，不是一個可以避免的 400。
    it('clamps the page size to 100', async () => {
      const result = await service.list(ME, { direction: 'incoming', limit: 500 });
      expect(lastFindManyArgs().take).toBe(100);
      expect(result.limit).toBe(100);
    });

    it('reports the total across all pages', async () => {
      prisma.friendRequest.findMany.mockResolvedValue([row('other', 'PENDING')]);
      prisma.friendRequest.count.mockResolvedValue(42);
      const result = await service.list(ME, { direction: 'incoming' });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(42);
    });
  });

  describe('counterpart (decisions 10 and 11)', () => {
    async function firstItem(from: 'me' | 'other', status: FriendRequestStatus) {
      prisma.friendRequest.findMany.mockResolvedValue([row(from, status)]);
      const result = await service.list(ME, {
        direction: from === 'me' ? 'outgoing' : 'incoming',
      });
      const [item] = result.items;
      if (item === undefined) {
        throw new Error('list() dropped the only row');
      }
      return item;
    }

    it('shows the requester name on an incoming request, never an email', async () => {
      const item = await firstItem('other', 'PENDING');
      expect(item.direction).toBe('incoming');
      expect(item.counterpart).toEqual({ userId: OTHER, name: 'Bob', email: null });
    });

    // 否則「知道一個 email」就能換到「這個人的名字」。
    it('shows only the email I typed on an outgoing request that is not accepted', async () => {
      for (const status of ['PENDING', 'DECLINED', 'CANCELLED'] as const) {
        const item = await firstItem('me', status);
        expect(item.direction).toBe('outgoing');
        expect(item.counterpart).toEqual({
          userId: null,
          name: null,
          email: 'bob@example.com',
        });
      }
    });

    // 已接受＝對方已是好友，這時給名字、把 email 收回。
    it('shows the name and drops the email once an outgoing request is accepted', async () => {
      const item = await firstItem('me', 'ACCEPTED');
      expect(item.counterpart).toEqual({ userId: OTHER, name: 'Bob', email: null });
    });

    it('formats both timestamps as ISO strings', async () => {
      const pending = await firstItem('other', 'PENDING');
      expect(pending.createdAt).toBe(CREATED_AT.toISOString());
      expect(pending.respondedAt).toBeNull();

      const answered = await firstItem('other', 'DECLINED');
      expect(answered.respondedAt).toBe(NOW.toISOString());
    });
  });
});
