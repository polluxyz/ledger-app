import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from './transactions.service';

/**
 * TransactionsService 的單元測試（Prisma 全程 mock）：建立時的分類一致性
 * （跨帳本 404、型別不符 400）、列表的預設值／上限／篩選／分頁信封、更新時
 * 依最終型別重驗一致性、軟刪除設 deletedAt 且查詢一律過濾。
 */
describe('TransactionsService', () => {
  let service: TransactionsService;
  let prisma: {
    category: { findUnique: jest.Mock };
    paymentMethod: { findUnique: jest.Mock };
    transaction: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
  };

  const ledgerId = 'ledger-1';
  const creatorId = 'user-1';
  const input = {
    type: 'EXPENSE' as const,
    amount: 120,
    date: '2026-08-08T12:00:00.000Z',
    categoryId: 'cat-1',
    note: 'Lunch',
  };
  const joined = {
    id: 'txn-1',
    type: 'EXPENSE' as const,
    amount: 120,
    date: new Date(input.date),
    note: 'Lunch',
    createdAt: new Date('2026-08-08T12:00:00.000Z'),
    category: { id: 'cat-1', name: '餐飲' },
    // 未指定付款方式的交易：join 結果為 null，對外也回傳 null。
    paymentMethod: null,
    creator: { id: 'user-1', name: 'Alice' },
  };

  beforeEach(() => {
    prisma = {
      category: { findUnique: jest.fn() },
      paymentMethod: { findUnique: jest.fn() },
      transaction: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue(joined),
      },
    };
    service = new TransactionsService(prisma as unknown as PrismaService);
  });

  it('creates a transaction with nested category and creator', async () => {
    prisma.category.findUnique.mockResolvedValue({
      id: 'cat-1',
      ledgerId,
      type: 'EXPENSE',
    });
    prisma.transaction.create.mockResolvedValue(joined);

    await expect(service.create(ledgerId, creatorId, input)).resolves.toEqual({
      id: 'txn-1',
      type: 'EXPENSE',
      amount: 120,
      date: joined.date.toISOString(),
      note: 'Lunch',
      category: { id: 'cat-1', name: '餐飲' },
      paymentMethod: null,
      creator: { id: 'user-1', name: 'Alice' },
      createdAt: joined.createdAt.toISOString(),
    });
  });

  it('404s when the category belongs to another ledger', async () => {
    prisma.category.findUnique.mockResolvedValue({
      id: 'cat-1',
      ledgerId: 'other-ledger',
      type: 'EXPENSE',
    });

    await expect(service.create(ledgerId, creatorId, input)).rejects.toMatchObject({
      constructor: AppException,
      errorCode: 'NOT_FOUND',
    });
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it('400s when the category type does not match', async () => {
    prisma.category.findUnique.mockResolvedValue({
      id: 'cat-1',
      ledgerId,
      type: 'INCOME',
    });

    await expect(service.create(ledgerId, creatorId, input)).rejects.toMatchObject({
      constructor: AppException,
      errorCode: 'CATEGORY_TYPE_MISMATCH',
    });
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  describe('list', () => {
    it('applies defaults (page 1, limit 20), filters soft-deleted, sorts newest first', async () => {
      await service.list(ledgerId, {});

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ledgerId, deletedAt: null },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          skip: 0,
          take: 20,
        }),
      );
    });

    it('caps limit at 100 and paginates with skip', async () => {
      await service.list(ledgerId, { page: 3, limit: 500 });

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 200, take: 100 }),
      );
    });

    it('builds a where clause from type, category and date range', async () => {
      await service.list(ledgerId, {
        type: 'EXPENSE',
        categoryId: 'cat-1',
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-31T23:59:59.999Z',
      });

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            ledgerId,
            deletedAt: null,
            type: 'EXPENSE',
            categoryId: 'cat-1',
            date: {
              gte: new Date('2026-08-01T00:00:00.000Z'),
              lte: new Date('2026-08-31T23:59:59.999Z'),
            },
          },
        }),
      );
    });

    it('returns items with the pagination envelope', async () => {
      prisma.transaction.findMany.mockResolvedValue([joined]);
      prisma.transaction.count.mockResolvedValue(1);

      const result = await service.list(ledgerId, { page: 1, limit: 20 });

      expect(result).toEqual({
        items: [expect.objectContaining({ id: 'txn-1' })],
        page: 1,
        limit: 20,
        total: 1,
      });
    });
  });

  describe('update', () => {
    const existing = {
      id: 'txn-1',
      ledgerId,
      type: 'EXPENSE' as const,
      categoryId: 'cat-1',
    };

    it('404s when the transaction is missing or soft-deleted', async () => {
      prisma.transaction.findFirst.mockResolvedValue(null);

      await expect(service.update(ledgerId, 'txn-1', { amount: 999 })).rejects.toMatchObject({
        constructor: AppException,
        errorCode: 'NOT_FOUND',
      });
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });

    it('re-validates consistency against the final type when only type changes', async () => {
      prisma.transaction.findFirst.mockResolvedValue(existing);
      // 既有分類 cat-1 是 EXPENSE；把型別改成 INCOME 就會衝突。
      prisma.category.findUnique.mockResolvedValue({
        id: 'cat-1',
        ledgerId,
        type: 'EXPENSE',
      });

      await expect(service.update(ledgerId, 'txn-1', { type: 'INCOME' })).rejects.toMatchObject({
        constructor: AppException,
        errorCode: 'CATEGORY_TYPE_MISMATCH',
      });
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });

    it('skips the consistency check when neither type nor category changes', async () => {
      prisma.transaction.findFirst.mockResolvedValue(existing);

      await service.update(ledgerId, 'txn-1', { amount: 500, note: 'x' });

      expect(prisma.category.findUnique).not.toHaveBeenCalled();
      expect(prisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'txn-1' },
          data: { amount: 500, note: 'x' },
        }),
      );
    });
  });

  describe('remove (soft delete)', () => {
    it('sets deletedAt for an active transaction', async () => {
      prisma.transaction.findFirst.mockResolvedValue({ id: 'txn-1', ledgerId });

      await service.remove(ledgerId, 'txn-1');

      expect(prisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'txn-1' },
          data: { deletedAt: expect.any(Date) as Date },
        }),
      );
    });

    it('404s when the transaction is already deleted/missing', async () => {
      prisma.transaction.findFirst.mockResolvedValue(null);

      await expect(service.remove(ledgerId, 'txn-1')).rejects.toMatchObject({
        constructor: AppException,
        errorCode: 'NOT_FOUND',
      });
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });
  });

  it('404s for a missing or soft-deleted transaction on detail', async () => {
    prisma.transaction.findFirst.mockResolvedValue(null);

    await expect(service.getById(ledgerId, 'txn-x')).rejects.toMatchObject({
      constructor: AppException,
      errorCode: 'NOT_FOUND',
    });
    // 查詢以 deletedAt: null 過濾，因此軟刪除的資料列不可見。
    expect(prisma.transaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'txn-x', ledgerId, deletedAt: null },
      }),
    );
  });
});
