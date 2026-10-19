import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from './transactions.service';
import { LedgerPeopleService } from '../ledger-people/ledger-people.service';

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
    account: { findUnique: jest.Mock; findFirst: jest.Mock };
    debtEntry: { findUnique: jest.Mock };
    ledgerSettlement: { findUnique: jest.Mock };
    ledgerPerson: { findUnique: jest.Mock };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
    transaction: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
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
    title: null,
    splitId: null,
    createdAt: new Date('2026-08-08T12:00:00.000Z'),
    category: { id: 'cat-1', name: '餐飲', icon: null },
    account: { id: accountId, name: '現金', userId: creatorId },
    toAccount: null,
    creator: { id: creatorId, name: 'Alice' },
  };

  /** 預設：分類與帳戶都合法且屬於 creatorId。 */
  function allowEverything(): void {
    prisma.ledger.findUnique.mockResolvedValue({ kind: 'PERSONAL' });
    prisma.category.findUnique.mockResolvedValue({ id: 'cat-1', ledgerId, type: 'EXPENSE' });
    prisma.account.findUnique.mockResolvedValue({ userId: creatorId, isTemporary: false });
    prisma.transaction.create.mockResolvedValue(joined);
  }

  beforeEach(() => {
    prisma = {
      ledger: {
        findUnique: jest.fn().mockResolvedValue({ kind: 'PERSONAL' }),
      },
      category: { findUnique: jest.fn() },
      account: { findUnique: jest.fn(), findFirst: jest.fn() },
      debtEntry: { findUnique: jest.fn().mockResolvedValue(null) },
      ledgerSettlement: { findUnique: jest.fn().mockResolvedValue(null) },
      ledgerPerson: { findUnique: jest.fn().mockResolvedValue({ id: 'person-1' }) },
      $transaction: jest.fn((callback: (client: unknown) => unknown) => callback(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([]),
      transaction: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue(joined),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    prisma.$queryRaw.mockImplementation(async () => {
      const row = (await prisma.transaction.findFirst()) as { id: string } | null;
      return row ? [{ id: row.id }] : [];
    });
    prisma.transaction.findUnique.mockImplementation(
      () => prisma.transaction.findFirst() as Promise<unknown>,
    );
    service = new TransactionsService(
      prisma as unknown as PrismaService,
      {} as LedgerPeopleService,
    );
  });

  it('creates a transaction with its category, account and creator', async () => {
    allowEverything();

    await expect(service.create(ledgerId, creatorId, input)).resolves.toEqual({
      id: 'txn-1',
      type: 'EXPENSE',
      amount: 120,
      date: joined.date.toISOString(),
      note: 'Lunch',
      title: null,
      category: { id: 'cat-1', name: '餐飲', icon: null },
      account: { id: accountId, name: '現金' },
      toAccount: null,
      creator: { id: creatorId, name: 'Alice' },
      debt: null,
      split: null,
      payer: null,
      ledgerSplit: null,
      settlement: null,
      accountPending: false,
      differenceOfId: null,
      difference: null,
      merge: null,
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
    it('400s ACCOUNT_REQUIRED when a transaction has no account', async () => {
      allowEverything();

      await expect(
        service.create(ledgerId, creatorId, { ...input, accountId: undefined }),
      ).rejects.toMatchObject({ status: 400, errorCode: 'ACCOUNT_REQUIRED' });
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('rejects a manually selected temporary account', async () => {
      allowEverything();
      prisma.account.findUnique.mockResolvedValue({ userId: creatorId, isTemporary: true });
      await expect(service.create(ledgerId, creatorId, input)).rejects.toMatchObject({
        status: 400,
        errorCode: 'TEMPORARY_ACCOUNT_NOT_SELECTABLE',
      });
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
      expect(result.category).toEqual({ id: 'cat-1', name: '餐飲', icon: null });
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
    it('runs grouping and pagination in SQL', async () => {
      const result = await service.list(ledgerId, creatorId, { page: 3, limit: 500 });
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(result).toMatchObject({ page: 3, limit: 100, total: 0 });
    });

    it('passes filters into the SQL query before pagination', async () => {
      await service.list(ledgerId, creatorId, {
        type: 'EXPENSE',
        categoryId: 'cat-1',
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-31T23:59:59.999Z',
      });
      const calls = prisma.$queryRaw.mock.calls as Array<[{ values: unknown[] }]>;
      const sql = calls[0]![0];
      expect(sql.values).toEqual(
        expect.arrayContaining([
          'EXPENSE',
          'cat-1',
          new Date('2026-08-01T00:00:00.000Z'),
          new Date('2026-08-31T23:59:59.999Z'),
        ]),
      );
    });

    it('returns items with the pagination envelope', async () => {
      prisma.transaction.findMany.mockResolvedValue([joined]);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'txn-1', total: 1n }]);

      const result = await service.list(ledgerId, creatorId, { page: 1, limit: 20 });

      expect(result).toEqual({
        items: [expect.objectContaining({ id: 'txn-1' })],
        page: 1,
        limit: 20,
        total: 1,
      });
    });

    describe('settlementsOnly (internal option for the settlements list)', () => {
      /** 取第 n 次交給 $queryRaw 的 SQL 物件（Prisma.Sql，`.sql` 是含 ? 占位的字串）。 */
      function rawSql(call = 0): string {
        const calls = prisma.$queryRaw.mock.calls as Array<[{ sql: string }]>;
        return calls[call]![0].sql;
      }

      it('restricts the query to transactions with a LedgerSettlement row', async () => {
        await service.list(
          ledgerId,
          creatorId,
          { page: 1 },
          {
            settlementsOnly: true,
          },
        );

        expect(rawSql()).toContain('FROM "LedgerSettlement" st');
        // 沒帶內部選項時，同一條 SQL 不應出現結清過濾——證明它是內部選項而非預設行為。
        prisma.$queryRaw.mockClear();
        await service.list(ledgerId, creatorId, { page: 1 });
        expect(rawSql()).not.toContain('FROM "LedgerSettlement" st');
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
      prisma.$queryRaw.mockResolvedValue([{ id: 'txn-1' }]);
      prisma.transaction.findUnique = jest
        .fn()
        .mockResolvedValue({ id: 'txn-1', ledgerId, type: 'EXPENSE', splitId: null });

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

  // ── 借還帳（3b） ──────────────────────────────────────────────────────────

  // SC-D8：借還交易在一般交易端點唯讀。4 種型別 × 修改與刪除，一律 409 且不寫入。
  describe('debt transactions are read-only here (SC-D8)', () => {
    const debtTypes = ['LEND', 'BORROW', 'COLLECT', 'REPAY'] as const;

    it.each(debtTypes)('refuses to update a %s transaction', async (type) => {
      prisma.transaction.findFirst.mockResolvedValue({ id: 'txn-1', ledgerId, type });

      await expect(
        service.update(ledgerId, 'txn-1', creatorId, { amount: 1 }),
      ).rejects.toMatchObject({ errorCode: 'DEBT_TRANSACTION_READ_ONLY' });
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });

    it.each(debtTypes)('refuses to delete a %s transaction', async (type) => {
      prisma.$queryRaw.mockResolvedValue([{ id: 'txn-1' }]);
      prisma.transaction.findUnique = jest
        .fn()
        .mockResolvedValue({ id: 'txn-1', ledgerId, type, splitId: null });

      await expect(service.remove(ledgerId, 'txn-1')).rejects.toMatchObject({
        errorCode: 'DEBT_TRANSACTION_READ_ONLY',
      });
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });

    // 往來帳版 SC-L9：「對方幫我付」產生的是一般 EXPENSE，只看型別擋不到，要看有沒有往來紀錄指向它。
    it('refuses to touch an EXPENSE that a debt entry points at (paid for me)', async () => {
      prisma.transaction.findFirst.mockResolvedValue({ id: 'txn-1', ledgerId, type: 'EXPENSE' });
      prisma.debtEntry.findUnique.mockResolvedValue({ id: 'entry-1' });
      prisma.$queryRaw.mockResolvedValue([{ id: 'txn-1' }]);
      prisma.transaction.findUnique = jest
        .fn()
        .mockResolvedValue({ id: 'txn-1', ledgerId, type: 'EXPENSE', splitId: null });

      await expect(
        service.update(ledgerId, 'txn-1', creatorId, { amount: 1 }),
      ).rejects.toMatchObject({ errorCode: 'DEBT_TRANSACTION_READ_ONLY' });
      await expect(service.remove(ledgerId, 'txn-1')).rejects.toMatchObject({
        errorCode: 'DEBT_TRANSACTION_READ_ONLY',
      });
      expect(prisma.debtEntry.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { transactionId: 'txn-1' } }),
      );
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });
  });

  // SC-L12、SC-L15 的單元層：debt 只給往來紀錄的擁有者；帳本其他成員看到的是 null。
  describe('debt visibility', () => {
    const lendRow = {
      ...joined,
      type: 'LEND' as const,
      category: null,
      debtEntry: {
        id: 'entry-1',
        pairedEntryId: null,
        note: '晚餐',
        counterparty: { id: 'cp-1', name: '小明', ownerId: creatorId },
      },
    };
    const paidForMeRow = {
      ...joined,
      account: null,
      debtEntry: {
        id: 'entry-2',
        pairedEntryId: null,
        note: '晚餐',
        counterparty: { id: 'cp-1', name: '小明', ownerId: creatorId },
      },
    };

    it.each([
      ['LEND', lendRow, 'entry-1'],
      ['paid-for-me expense', paidForMeRow, 'entry-2'],
    ])('shows the counterparty of a %s transaction to its owner', async (_label, row, entryId) => {
      prisma.transaction.findFirst.mockResolvedValue(row);
      const result = await service.getById(ledgerId, 'txn-1', creatorId);
      expect(result.debt).toEqual({
        entryId,
        counterpartyId: 'cp-1',
        counterpartyName: '小明',
        paired: false,
        note: '晚餐',
      });
    });

    it('marks the debt as paired when the entry is synced with the other side', async () => {
      prisma.transaction.findFirst.mockResolvedValue({
        ...lendRow,
        debtEntry: { ...lendRow.debtEntry, pairedEntryId: 'their-entry' },
      });
      const result = await service.getById(ledgerId, 'txn-1', creatorId);
      expect(result.debt?.paired).toBe(true);
    });

    it.each([
      ['LEND', lendRow],
      ['paid-for-me expense', paidForMeRow],
    ])('hides the counterparty of a %s transaction from other members', async (_label, row) => {
      prisma.transaction.findFirst.mockResolvedValue(row);
      const result = await service.getById(ledgerId, 'txn-1', otherUserId);
      expect(result.debt).toBeNull();
    });
  });

  // 往來帳版決策 36：唯一允許連動帳本的支出不填帳戶的入口；分類照一般規則檢查。
  describe('createPaidForMeExpense', () => {
    it('writes an EXPENSE with the category and no account', async () => {
      prisma.category.findUnique.mockResolvedValue({ id: 'cat-1', ledgerId, type: 'EXPENSE' });
      const client = { transaction: { create: jest.fn().mockResolvedValue({ id: 'txn-7' }) } };

      const id = await service.createPaidForMeExpense(client as never, {
        ledgerId,
        creatorId,
        amount: 400,
        date: new Date('2026-09-24T00:00:00.000Z'),
        categoryId: 'cat-1',
      });

      expect(id).toBe('txn-7');
      expect(client.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'EXPENSE',
            amount: 400,
            accountId: null,
            categoryId: 'cat-1',
            note: null,
          }) as unknown,
        }),
      );
    });

    it('rejects an income category', async () => {
      prisma.category.findUnique.mockResolvedValue({ id: 'cat-2', ledgerId, type: 'INCOME' });
      const client = { transaction: { create: jest.fn() } };

      await expect(
        service.createPaidForMeExpense(client as never, {
          ledgerId,
          creatorId,
          amount: 400,
          date: new Date(),
          categoryId: 'cat-2',
        }),
      ).rejects.toMatchObject({ errorCode: 'CATEGORY_TYPE_MISMATCH' });
      expect(client.transaction.create).not.toHaveBeenCalled();
    });
  });

  describe('createDebtTransaction', () => {
    it.each([
      ['LEND', 'EXPENSE'],
      ['REPAY', 'EXPENSE'],
      ['BORROW', 'INCOME'],
      ['COLLECT', 'INCOME'],
    ] as const)('accepts %s with a %s category and keeps its type', async (type, categoryType) => {
      allowEverything();
      const client = {
        account: prisma.account,
        category: { findFirst: jest.fn().mockResolvedValue({ type: categoryType }) },
        transaction: { create: jest.fn().mockResolvedValue({ id: 'debt' }) },
      };
      await service.createDebtTransaction(client as never, {
        ledgerId,
        creatorId,
        type,
        amount: 500,
        date: new Date(),
        accountId,
        categoryId: 'category',
        title: '押金',
      });
      expect(client.category.findFirst).toHaveBeenCalledWith({
        where: { id: 'category', ledgerId },
      });
      expect(client.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type,
            categoryId: 'category',
            title: '押金',
            amount: 500,
          }) as unknown,
        }),
      );
      client.category.findFirst.mockResolvedValue({
        type: categoryType === 'EXPENSE' ? 'INCOME' : 'EXPENSE',
      });
      await expect(
        service.assertDebtCategory(client as never, ledgerId, type, 'category'),
      ).rejects.toMatchObject({ status: 400, errorCode: 'CATEGORY_TYPE_MISMATCH' });
    });

    it('returns 404 for inaccessible or deleted categories before checking kind', async () => {
      const client = { category: { findFirst: jest.fn().mockResolvedValue(null) } };
      await expect(
        service.assertDebtCategory(client as never, ledgerId, 'LEND', 'missing'),
      ).rejects.toMatchObject({ status: 404, errorCode: 'NOT_FOUND' });
      await expect(
        service.assertDebtCategory(client as never, ledgerId, 'EXPENSE', 'missing'),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('returns 400 for a kind that cannot select a debt category', async () => {
      const client = { category: { findFirst: jest.fn().mockResolvedValue({ type: 'EXPENSE' }) } };
      await expect(
        service.assertDebtCategory(client as never, ledgerId, 'EXPENSE', 'category'),
      ).rejects.toMatchObject({ status: 400, errorCode: 'VALIDATION_FAILED' });
    });

    it('writes a debt transaction with no category, using the account rules', async () => {
      prisma.ledger.findUnique.mockResolvedValue({ kind: 'PERSONAL' });
      prisma.account.findUnique.mockResolvedValue({ userId: creatorId, isTemporary: false });
      const client = {
        account: prisma.account,
        transaction: { create: jest.fn().mockResolvedValue({ id: 'txn-9' }) },
      };

      const id = await service.createDebtTransaction(client as never, {
        ledgerId,
        creatorId,
        type: 'LEND',
        amount: 500,
        date: new Date('2026-09-24T00:00:00.000Z'),
        accountId,
      });

      expect(id).toBe('txn-9');
      expect(client.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'LEND',
            amount: 500,
            accountId,
            categoryId: null,
            toAccountId: null,
          }) as unknown,
        }),
      );
    });

    it('requires an account for a debt transaction', async () => {
      prisma.ledger.findUnique.mockResolvedValue({ kind: 'PERSONAL' });
      const client = { transaction: { create: jest.fn() } };

      await expect(
        service.createDebtTransaction(client as never, {
          ledgerId,
          creatorId,
          type: 'BORROW',
          amount: 500,
          date: new Date(),
        }),
      ).rejects.toMatchObject({ errorCode: 'ACCOUNT_REQUIRED' });
      expect(client.transaction.create).not.toHaveBeenCalled();
    });

    it("refuses someone else's account with 404", async () => {
      prisma.ledger.findUnique.mockResolvedValue({ kind: 'PERSONAL' });
      prisma.account.findUnique.mockResolvedValue({ userId: otherUserId });
      const client = { account: prisma.account, transaction: { create: jest.fn() } };

      await expect(
        service.createDebtTransaction(client as never, {
          ledgerId,
          creatorId,
          type: 'LEND',
          amount: 500,
          date: new Date(),
          accountId,
        }),
      ).rejects.toMatchObject({ errorCode: 'NOT_FOUND' });
      expect(client.transaction.create).not.toHaveBeenCalled();
    });
  });

  /** 以 Prisma 替身驗證 3k 合併交易的顯示、有限編輯與來源防重複補帳戶。 */
  describe('merged transactions (decisions 199 and 202)', () => {
    const share = {
      ...joined,
      ledgerId,
      mergeId: 'merge-1',
      mergedFromId: 'original',
      merge: { userId: creatorId, sourceLedgerName: '花蓮三日' },
      categoryId: 'cat-1',
      accountId,
      toAccountId: null,
      payerPersonId: null,
      deletedAt: null,
    };
    const advance = {
      ...share,
      id: 'advance',
      type: 'LEND' as const,
      amount: 880,
      categoryId: null,
      category: null,
    };

    beforeEach(() => {
      allowEverything();
      prisma.$queryRaw.mockResolvedValue([{ id: share.id }]);
      prisma.transaction.findUnique.mockResolvedValue(share);
      prisma.transaction.findFirst.mockResolvedValue(share);
      prisma.transaction.findMany.mockResolvedValue([share, advance]);
      prisma.transaction.update.mockResolvedValue(share);
    });

    it.each([creatorId, otherUserId])(
      'combines the list for %s and only exposes own merge',
      async (viewer) => {
        prisma.$queryRaw.mockResolvedValue([{ id: share.id, total: 1n }]);
        prisma.transaction.findMany.mockResolvedValueOnce([share]);
        const result = await service.list(ledgerId, viewer, {});
        expect(result.total).toBe(1);
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({
          id: share.id,
          amount: 1000,
          accountPending: false,
          merge: viewer === creatorId ? { sourceLedgerName: '花蓮三日', share: 120 } : null,
        });
        const calls = prisma.$queryRaw.mock.calls as Array<[{ sql: string }]>;
        expect(calls[0]![0].sql).toContain('share."mergeId" = t."mergeId"');
        expect(calls[0]![0].sql).toContain('share."ledgerId" = t."ledgerId"');
      },
    );

    it('resolves an advance id to the share representative', async () => {
      prisma.transaction.findFirst.mockResolvedValue(advance);
      expect(await service.getById(ledgerId, advance.id, creatorId)).toMatchObject({
        id: share.id,
        amount: 1000,
        merge: { share: 120 },
      });
    });

    it.each([{ title: '住宿' }, { categoryId: 'cat-1' }, { accountId: 'bank' }])(
      'allows %j and synchronizes title/accounts without categorizing the advance',
      async (input) => {
        await service.update(ledgerId, share.id, creatorId, input);
        expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
          where: { ledgerId, id: { in: [share.id, advance.id] }, deletedAt: null },
          data: 'categoryId' in input ? {} : input,
        });
        expect(prisma.transaction.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { ledgerId, id: share.id },
            data: 'categoryId' in input ? input : {},
          }),
        );
      },
    );

    it.each([
      { amount: 2000 },
      { date: '2026-10-01T00:00:00Z' },
      { type: 'INCOME' as const },
      { note: '不能改' },
      { payerPersonId: 'other' },
      { ledgerSplit: { method: 'EQUAL' as const, shares: [{ personId: 'other' }] } },
    ])('rejects changes to immutable fields: %j', async (input) => {
      await expect(service.update(ledgerId, share.id, creatorId, input)).rejects.toMatchObject({
        status: 400,
        errorCode: 'VALIDATION_FAILED',
      });
      expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    });

    it('allows unchanged immutable values using the displayed total', async () => {
      await service.update(ledgerId, share.id, creatorId, {
        amount: 1000,
        date: input.date,
        type: 'EXPENSE',
        note: 'Lunch',
        ledgerSplit: null,
      });
      expect(prisma.transaction.updateMany).toHaveBeenCalled();
    });

    it('deletes both rows even when called with the advance id', async () => {
      prisma.transaction.findUnique.mockResolvedValue(advance);
      await service.remove(ledgerId, advance.id);
      expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
        where: { ledgerId, mergeId: 'merge-1', mergedFromId: 'original', deletedAt: null },
        data: { deletedAt: expect.any(Date) as unknown },
      });
      expect(prisma.debtEntry.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an account not owned by the editor', async () => {
      await expect(
        service.update(ledgerId, share.id, otherUserId, { accountId }),
      ).rejects.toMatchObject({ status: 404, errorCode: 'NOT_FOUND' });
      expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
    });

    it('returns 409 before setting an original transaction already merged by the caller', async () => {
      await expect(
        service.setAccount(ledgerId, 'original', creatorId, accountId),
      ).rejects.toMatchObject({
        status: 409,
        errorCode: 'TRANSACTION_ALREADY_MERGED',
      });
      expect(prisma.transaction.findFirst).toHaveBeenCalledWith({
        where: { mergedFromId: 'original', merge: { sourceLedgerId: ledgerId, userId: creatorId } },
        select: { id: true },
      });
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });

    it.each([null, 'temporary'])(
      'sets an unmerged original account from %s',
      async (oldAccount) => {
        prisma.ledger.findUnique.mockResolvedValue({ kind: 'SHARED' });
        prisma.transaction.findUnique.mockResolvedValue({
          ...share,
          mergeId: null,
          accountId: oldAccount,
          creatorId,
        });
        prisma.transaction.findFirst.mockResolvedValue(null);
        prisma.account.findFirst.mockResolvedValue({ id: 'temporary' });
        service = new TransactionsService(
          prisma as unknown as PrismaService,
          {
            findCallerPerson: jest.fn().mockResolvedValue({ id: 'payer', userId: creatorId }),
            lockPeople: jest.fn().mockResolvedValue(new Map([['payer', { userId: creatorId }]])),
          } as unknown as LedgerPeopleService,
        );
        jest.spyOn(service, 'getById').mockResolvedValue({ id: 'original' } as never);
        await service.setAccount(ledgerId, 'original', creatorId, accountId);
        expect(prisma.transaction.update).toHaveBeenCalledWith({
          where: { id: 'original' },
          data: { accountId },
        });
      },
    );
  });

  /** 以共享帳本資料替身檢查原交易的待補提示只受本人的合併影響。 */
  describe('merged original accountPending', () => {
    it.each([true, false])(
      'suppresses pending only when merged by this viewer (%s)',
      async (merged) => {
        const payer = { id: 'payer', userId: creatorId };
        prisma.ledger.findUnique.mockResolvedValue({ kind: 'SHARED' });
        prisma.account.findFirst.mockResolvedValue({ id: 'temporary' });
        prisma.transaction.findFirst.mockResolvedValue({
          ...joined,
          payerPersonId: payer.id,
          account: null,
        });
        prisma.transaction.findMany.mockResolvedValue(merged ? [{ mergedFromId: joined.id }] : []);
        service = new TransactionsService(
          prisma as unknown as PrismaService,
          {
            listPeople: jest.fn().mockResolvedValue([payer]),
            toView: jest.fn().mockReturnValue(payer),
          } as unknown as LedgerPeopleService,
        );
        expect(await service.getById(ledgerId, joined.id, creatorId)).toMatchObject({
          accountPending: !merged,
          merge: null,
        });
      },
    );
  });

  describe('updateDebtTransaction', () => {
    function client() {
      return {
        account: {
          findUnique: jest.fn().mockResolvedValue({ userId: creatorId, isTemporary: false }),
        },
        category: { findFirst: jest.fn().mockResolvedValue({ type: 'INCOME' }) },
        transaction: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ ledgerId, creatorId, type: 'COLLECT' }),
          update: jest.fn(),
          updateMany: jest.fn(),
        },
      };
    }

    it('updates the repayment and all active difference branches on the same client', async () => {
      const tx = client();
      await service.updateDebtTransaction(
        tx as never,
        'repayment',
        { accountId: 'bank', categoryId: 'income', title: '房租' },
        creatorId,
      );
      expect(tx.transaction.update).toHaveBeenCalledWith({
        where: { id: 'repayment' },
        data: { accountId: 'bank', categoryId: 'income', title: '房租' },
      });
      expect(tx.transaction.updateMany).toHaveBeenCalledWith({
        where: { differenceOfId: 'repayment', deletedAt: null },
        data: { accountId: 'bank' },
      });
    });

    it.each([
      [{ userId: otherUserId, isTemporary: false }, 404, 'NOT_FOUND'],
      [{ userId: creatorId, isTemporary: true }, 400, 'TEMPORARY_ACCOUNT_NOT_SELECTABLE'],
    ] as const)(
      'does not update repayment or branch for an invalid account %j',
      async (account, status, errorCode) => {
        const tx = client();
        tx.account.findUnique.mockResolvedValue(account);
        await expect(
          service.updateDebtTransaction(tx as never, 'repayment', { accountId: 'bad' }, creatorId),
        ).rejects.toMatchObject({ status, errorCode });
        expect(tx.transaction.update).not.toHaveBeenCalled();
        expect(tx.transaction.updateMany).not.toHaveBeenCalled();
      },
    );

    it('clears title and category without assigning a type or changing branches', async () => {
      const tx = client();
      await service.updateDebtTransaction(tx as never, 'repayment', {
        title: null,
        categoryId: null,
      });
      expect(tx.transaction.update).toHaveBeenCalledWith({
        where: { id: 'repayment' },
        data: { title: null, categoryId: null },
      });
      expect(tx.category.findFirst).not.toHaveBeenCalled();
      expect(tx.transaction.updateMany).not.toHaveBeenCalled();
    });
  });
});
