import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from './transactions.service';

describe('TransactionsService', () => {
  let service: TransactionsService;
  let prisma: {
    category: { findUnique: jest.Mock };
    transaction: { create: jest.Mock; findFirst: jest.Mock };
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
      transaction: { create: jest.fn(), findFirst: jest.fn() },
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
