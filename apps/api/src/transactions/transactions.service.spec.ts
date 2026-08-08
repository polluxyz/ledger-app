import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from './transactions.service';

describe('TransactionsService', () => {
  let service: TransactionsService;
  let prisma: {
    category: { findUnique: jest.Mock };
    transaction: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
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
    creator: { id: 'user-1', name: 'Alice' },
  };

  beforeEach(() => {
    prisma = {
      category: { findUnique: jest.fn() },
      transaction: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
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

  it('404s for a missing or soft-deleted transaction on detail', async () => {
    prisma.transaction.findFirst.mockResolvedValue(null);

    await expect(service.getById(ledgerId, 'txn-x')).rejects.toMatchObject({
      constructor: AppException,
      errorCode: 'NOT_FOUND',
    });
    // The query filters deletedAt: null, so soft-deleted rows are invisible.
    expect(prisma.transaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'txn-x', ledgerId, deletedAt: null },
      }),
    );
  });
});
