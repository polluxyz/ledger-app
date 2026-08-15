import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from './transactions.service';

/**
 * TransactionsService 的單元測試（Prisma 全程 mock）：分類一致性、列表的預設值／
 * 上限／篩選／分頁信封、更新時重驗、軟刪除，以及 2c 新增的兩大塊——
 * **帳戶的條件必填規則**與**帳戶的隱私遮蔽**。
 */
describe('TransactionsService', () => {
  let service: TransactionsService;
  let prisma: {
    ledger: { findUnique: jest.Mock };
    category: { findUnique: jest.Mock };
    account: { findUnique: jest.Mock };
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
  const otherUserId = 'user-2';
  const accountId = 'acc-1';
  const toAccountId = 'acc-2';

  const input = {
    type: 'EXPENSE' as const,
    amount: 120,
    date: '2026-08-08T12:00:00.000Z',
    categoryId: 'cat-1',
    accountId,
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
    account: { id: accountId, name: '現金', userId: creatorId },
    toAccount: null,
    creator: { id: creatorId, name: 'Alice' },
  };

  /** 預設：連動帳本、分類與帳戶都合法且屬於 creatorId。 */
  function allowEverything(): void {
    prisma.ledger.findUnique.mockResolvedValue({ tracksBalance: true });
    prisma.category.findUnique.mockResolvedValue({ id: 'cat-1', ledgerId, type: 'EXPENSE' });
    prisma.account.findUnique.mockResolvedValue({ userId: creatorId });
    prisma.transaction.create.mockResolvedValue(joined);
  }

  beforeEach(() => {
    prisma = {
      ledger: { findUnique: jest.fn() },
      category: { findUnique: jest.fn() },
      account: { findUnique: jest.fn() },
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

  it('creates a transaction with its category, account and creator', async () => {
    allowEverything();

    await expect(service.create(ledgerId, creatorId, input)).resolves.toEqual({
      id: 'txn-1',
      type: 'EXPENSE',
      amount: 120,
      date: joined.date.toISOString(),
      note: 'Lunch',
      category: { id: 'cat-1', name: '餐飲' },
      account: { id: accountId, name: '現金' },
      toAccount: null,
      creator: { id: creatorId, name: 'Alice' },
      createdAt: joined.createdAt.toISOString(),
    });
  });

  it('404s when the category belongs to another ledger', async () => {
    allowEverything();
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
    allowEverything();
    prisma.category.findUnique.mockResolvedValue({ id: 'cat-1', ledgerId, type: 'INCOME' });

    await expect(service.create(ledgerId, creatorId, input)).rejects.toMatchObject({
      errorCode: 'CATEGORY_TYPE_MISMATCH',
    });
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  // ── 帳戶的條件必填規則 ───────────────────────────────────────────────────

  describe('account rules', () => {
    it('400s ACCOUNT_REQUIRED when a tracking ledger gets no account', async () => {
      allowEverything();

      await expect(
        service.create(ledgerId, creatorId, { ...input, accountId: undefined }),
      ).rejects.toMatchObject({ status: 400, errorCode: 'ACCOUNT_REQUIRED' });
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('400s ACCOUNT_NOT_ALLOWED when a non-tracking ledger is given an account', async () => {
      allowEverything();
      prisma.ledger.findUnique.mockResolvedValue({ tracksBalance: false });

      await expect(service.create(ledgerId, creatorId, input)).rejects.toMatchObject({
        status: 400,
        errorCode: 'ACCOUNT_NOT_ALLOWED',
      });
    });

    it('accepts a transaction with no account in a non-tracking ledger', async () => {
      allowEverything();
      prisma.ledger.findUnique.mockResolvedValue({ tracksBalance: false });
      prisma.transaction.create.mockResolvedValue({ ...joined, account: null });

      const result = await service.create(ledgerId, creatorId, {
        ...input,
        accountId: undefined,
      });

      expect(result.account).toBeNull();
      // 非連動帳本毋須查帳戶，也就不會有跨使用者的疑慮。
      expect(prisma.account.findUnique).not.toHaveBeenCalled();
    });

    it("404s for someone else's account rather than 403", async () => {
      allowEverything();
      prisma.account.findUnique.mockResolvedValue({ userId: otherUserId });

      await expect(service.create(ledgerId, creatorId, input)).rejects.toMatchObject({
        status: 404,
        errorCode: 'NOT_FOUND',
      });
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('400s TRANSFER_SAME_ACCOUNT when both sides are the same account', async () => {
      allowEverything();

      await expect(
        service.create(ledgerId, creatorId, {
          ...input,
          type: 'TRANSFER',
          categoryId: undefined,
          toAccountId: accountId,
        }),
      ).rejects.toMatchObject({ status: 400, errorCode: 'TRANSFER_SAME_ACCOUNT' });
    });

    it('400s when a transfer has no toAccountId', async () => {
      allowEverything();

      await expect(
        service.create(ledgerId, creatorId, { ...input, type: 'TRANSFER', categoryId: undefined }),
      ).rejects.toMatchObject({ status: 400, errorCode: 'ACCOUNT_REQUIRED' });
    });

    it('400s when a transfer carries a category', async () => {
      allowEverything();

      await expect(
        service.create(ledgerId, creatorId, { ...input, type: 'TRANSFER', toAccountId }),
      ).rejects.toMatchObject({ status: 400, errorCode: 'VALIDATION_FAILED' });
    });

    it('400s when an expense has no category', async () => {
      allowEverything();

      await expect(
        service.create(ledgerId, creatorId, { ...input, categoryId: undefined }),
      ).rejects.toMatchObject({ status: 400, errorCode: 'VALIDATION_FAILED' });
    });

    it('400s when a non-transfer carries a toAccountId', async () => {
      allowEverything();

      await expect(
        service.create(ledgerId, creatorId, { ...input, toAccountId }),
      ).rejects.toMatchObject({ status: 400, errorCode: 'VALIDATION_FAILED' });
    });

    it('creates a transfer between two of the caller’s own accounts', async () => {
      allowEverything();
      prisma.transaction.create.mockResolvedValue({
        ...joined,
        type: 'TRANSFER',
        category: null,
        toAccount: { id: toAccountId, name: '國泰世華', userId: creatorId },
      });

      const result = await service.create(ledgerId, creatorId, {
        ...input,
        type: 'TRANSFER',
        categoryId: undefined,
        toAccountId,
      });

      expect(result.category).toBeNull();
      expect(result.toAccount).toEqual({ id: toAccountId, name: '國泰世華' });
    });
  });

  // ── 帳戶的隱私遮蔽 ───────────────────────────────────────────────────────

  describe('account privacy', () => {
    it("hides another member's account but keeps amount, category and creator", async () => {
      prisma.transaction.findFirst.mockResolvedValue({
        ...joined,
        account: { id: 'acc-9', name: '祕密帳戶', userId: otherUserId },
        creator: { id: otherUserId, name: 'Bob' },
      });

      const result = await service.getById(ledgerId, 'txn-1', creatorId);

      expect(result.account).toBeNull();
      expect(result.amount).toBe(120);
      expect(result.category).toEqual({ id: 'cat-1', name: '餐飲' });
      expect(result.creator).toEqual({ id: otherUserId, name: 'Bob' });
    });

    it('hides the incoming side of a transfer that is not the viewer’s', async () => {
      prisma.transaction.findFirst.mockResolvedValue({
        ...joined,
        toAccount: { id: 'acc-9', name: '祕密帳戶', userId: otherUserId },
      });

      const result = await service.getById(ledgerId, 'txn-1', creatorId);

      expect(result.toAccount).toBeNull();
      expect(result.account).toEqual({ id: accountId, name: '現金' });
    });
  });

  describe('list', () => {
    it('applies defaults (page 1, limit 20), filters soft-deleted, sorts newest first', async () => {
      await service.list(ledgerId, creatorId, {});

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
      await service.list(ledgerId, creatorId, { page: 3, limit: 500 });

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 200, take: 100 }),
      );
    });

    it('builds a where clause from type, category and date range', async () => {
      await service.list(ledgerId, creatorId, {
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

      const result = await service.list(ledgerId, creatorId, { page: 1, limit: 20 });

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
      accountId,
      toAccountId: null,
    };

    it('404s when the transaction is missing or soft-deleted', async () => {
      prisma.transaction.findFirst.mockResolvedValue(null);

      await expect(
        service.update(ledgerId, 'txn-1', creatorId, { amount: 999 }),
      ).rejects.toMatchObject({ constructor: AppException, errorCode: 'NOT_FOUND' });
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });

    it('re-validates consistency against the final type when only type changes', async () => {
      allowEverything();
      prisma.transaction.findFirst.mockResolvedValue(existing);

      await expect(
        service.update(ledgerId, 'txn-1', creatorId, { type: 'INCOME' }),
      ).rejects.toMatchObject({ errorCode: 'CATEGORY_TYPE_MISMATCH' });
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });

    it('clears the category automatically when the type becomes TRANSFER', async () => {
      allowEverything();
      prisma.transaction.findFirst.mockResolvedValue(existing);

      // PATCH 表達不出「清空」，所以改成轉帳時由 service 自行把分類設為 null；
      // 否則這筆轉帳會殘留分類，落入我們明文禁止的狀態。
      await service.update(ledgerId, 'txn-1', creatorId, { type: 'TRANSFER', toAccountId });

      expect(prisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ categoryId: null, toAccountId }) as unknown,
        }),
      );
    });

    it("lets an editor change someone else's transaction without owning its account", async () => {
      // 共享帳本中任何 editor 都能編輯任何一筆（決策 8）。沿用不動的既有帳戶
      // 屬於原記帳者，若對它也要求所有權，就沒有人能改別人記的帳了。
      allowEverything();
      prisma.transaction.findFirst.mockResolvedValue(existing);

      await service.update(ledgerId, 'txn-1', otherUserId, { amount: 500 });

      expect(prisma.account.findUnique).not.toHaveBeenCalled();
      expect(prisma.transaction.update).toHaveBeenCalled();
    });

    it('validates ownership of an account the request actually assigns', async () => {
      allowEverything();
      prisma.transaction.findFirst.mockResolvedValue(existing);
      prisma.account.findUnique.mockResolvedValue({ userId: creatorId });

      await expect(
        service.update(ledgerId, 'txn-1', otherUserId, { accountId: 'acc-3' }),
      ).rejects.toMatchObject({ status: 404, errorCode: 'NOT_FOUND' });
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
        errorCode: 'NOT_FOUND',
      });
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });
  });

  it('404s for a missing or soft-deleted transaction on detail', async () => {
    prisma.transaction.findFirst.mockResolvedValue(null);

    await expect(service.getById(ledgerId, 'txn-x', creatorId)).rejects.toMatchObject({
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
