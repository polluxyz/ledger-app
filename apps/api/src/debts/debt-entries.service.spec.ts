import type { PrismaService } from '../prisma/prisma.service';
import type { TransactionsService } from '../transactions/transactions.service';
import { DebtEntriesService } from './debt-entries.service';
import type { LedgerDebtsService } from '../ledger-groups/ledger-debts.service';
import type { CreateDebtEntryDto } from './dto/create-debt-entry.dto';
import type { Prisma } from '../generated/prisma/client';
import { deltaFor } from './debt-entry-rules';
import {
  differenceFor,
  forgivenessTypeFor,
  recalculateSettlement,
  voidRepaymentWithSettlement,
  writeDifference,
} from './debt-recording';

/**
 * `DebtEntriesService`：記一筆、改、刪（spec 3b §3、§5.2）。
 *
 * 這個 suite 驗證四件事：
 * 1. **組合規則**：`counterparty` 二選一、`record` 必填、`PAID_FOR_ME` 的分類與帳戶、`settle`
 *    只給還款——違反一律 400，而且在碰資料庫之前。
 * 2. **交易怎麼產生**：型別由種類決定；`record: null` 在寫入之前被拒絕。
 * 3. **以此結清**：還款清掉全部欠款，實收差額另記分支交易，不新增 `SETTLEMENT`。
 * 4. **調整紀錄不能改**，改一般紀錄時正負號沿用原本那一筆。
 * 5. **帳本唯讀限制**：有交易的修改與撤銷都先驗寫入權，還款分支與提議不能先被寫入。
 *
 * 策略：Prisma 全程 mock，`$transaction` 直接把同一個 mock 當 tx 傳進 callback；
 * `TransactionsService` 也是 mock——它有自己的測試檔。
 */
describe('DebtEntriesService', () => {
  const USER = 'user-1';
  const LEDGER = 'ledger-1';
  const ACCOUNT = 'account-1';
  const DATE = '2026-09-24T00:00:00.000Z';
  const counterpartyRow = {
    id: 'cp-1',
    ownerId: USER,
    name: '小明',
    createdAt: new Date(DATE),
    updatedAt: new Date(DATE),
  };

  function entryRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'entry-1',
      counterpartyId: 'cp-1',
      kind: 'LEND',
      delta: 120,
      date: new Date(DATE),
      note: null,
      transactionId: 'txn-1',
      transaction: { ledgerId: LEDGER, accountId: ACCOUNT, title: null, categoryId: null },
      pairedEntryId: null,
      settlesEntryId: null,
      deletedAt: null,
      createdAt: new Date(DATE),
      updatedAt: new Date(DATE),
      ...overrides,
    };
  }

  function buildPrisma() {
    const mock = {
      counterparty: {
        findFirst: jest.fn().mockResolvedValue(counterpartyRow),
        upsert: jest.fn().mockResolvedValue(counterpartyRow),
      },
      debtEntry: {
        create: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve(entryRow({ ...args.data, id: `entry-${String(args.data.kind)}` })),
        ),
        findFirst: jest.fn(),
        update: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve(entryRow(args.data)),
        ),
        aggregate: jest.fn().mockResolvedValue({ _sum: { delta: 0 } }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      transaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      // 連動（3b-2）：預設沒有連動，所以不送任何提議。送提議的規則在
      // debt-proposal-rules.spec.ts 與 e2e 驗。
      counterpartyLink: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      debtProposal: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
      },
      ledgerMember: {
        findUnique: jest.fn().mockResolvedValue({ role: 'EDITOR', ledger: { archivedAt: null } }),
      },
      // 鎖對象（`SELECT … FOR UPDATE`）。真正的並發行為由 e2e 對 PostgreSQL 驗（SC-L21）。
      $queryRaw: jest.fn().mockResolvedValue([]),
      // 回傳型別要明寫成 unknown，否則 `mock` 引用自己會讓 TypeScript 把整個物件推成 any。
      $transaction: jest.fn((callback: (tx: unknown) => unknown): unknown => callback(mock)),
    };
    return mock;
  }

  function buildTransactions() {
    return {
      createDebtTransaction: jest.fn().mockResolvedValue('txn-new'),
      createDebtDifference: jest.fn().mockResolvedValue('branch-1'),
      createPaidForMeExpense: jest.fn().mockResolvedValue('txn-expense'),
      updateDebtTransaction: jest.fn().mockResolvedValue(undefined),
      softDeleteDebtTransactions: jest.fn().mockResolvedValue(undefined),
    };
  }

  let prisma: ReturnType<typeof buildPrisma>;
  let transactions: ReturnType<typeof buildTransactions>;
  let service: DebtEntriesService;

  beforeEach(() => {
    prisma = buildPrisma();
    transactions = buildTransactions();
    service = new DebtEntriesService(
      prisma as unknown as PrismaService,
      transactions as unknown as TransactionsService,
      {
        partsByCounterparty: jest.fn().mockResolvedValue(new Map()),
      } as unknown as LedgerDebtsService,
    );
  });

  function input(overrides: Partial<CreateDebtEntryDto> = {}): CreateDebtEntryDto {
    return {
      counterparty: { id: 'cp-1' },
      kind: 'LEND',
      amount: 120,
      date: DATE,
      record: { ledgerId: LEDGER, accountId: ACCOUNT },
      ...overrides,
    };
  }

  /** 取出 debtEntry.create 第 n 次呼叫的 data。 */
  function createdData(n = 0): Record<string, unknown> {
    const calls = prisma.debtEntry.create.mock.calls as Array<[{ data: Record<string, unknown> }]>;
    return calls[n]![0].data;
  }

  describe('shape rules (400 before touching the database)', () => {
    it.each([
      ['both id and name', { counterparty: { id: 'cp-1', name: '小明' } }],
      ['neither id nor name', { counterparty: {} }],
      ['record omitted', { record: undefined }],
      ['record null', { record: null }],
      ['PAID_FOR_ME with record null', { kind: 'PAID_FOR_ME', categoryId: 'c', record: null }],
      [
        'PAID_FOR_ME naming an account',
        { kind: 'PAID_FOR_ME', categoryId: 'c', record: { ledgerId: LEDGER, accountId: ACCOUNT } },
      ],
      ['PAID_FOR_ME without a category', { kind: 'PAID_FOR_ME', record: { ledgerId: LEDGER } }],
      ['settle on LEND', { settle: true }],
      ['settle on PAID_FOR_ME', { kind: 'PAID_FOR_ME', categoryId: 'c', settle: true }],
    ])('rejects %s', async (_label, overrides) => {
      await expect(
        service.create(USER, input(overrides as Partial<CreateDebtEntryDto>)),
      ).rejects.toMatchObject({ status: 400, errorCode: 'VALIDATION_FAILED' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('records a LEND as a LEND transaction with a positive delta', async () => {
      prisma.debtEntry.aggregate.mockResolvedValue({ _sum: { delta: 120 } });

      const result = await service.create(USER, input());

      expect(transactions.createDebtTransaction).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          ledgerId: LEDGER,
          type: 'LEND',
          amount: 120,
          accountId: ACCOUNT,
        }),
      );
      expect(createdData()).toMatchObject({ kind: 'LEND', delta: 120, transactionId: 'txn-new' });
      expect(result.counterparty.balance).toBe(120);
      expect(result.entries).toHaveLength(1);
    });

    it('records a BORROW with a negative delta', async () => {
      await service.create(USER, input({ kind: 'BORROW', amount: 111 }));

      expect(createdData()).toMatchObject({ kind: 'BORROW', delta: -111 });
    });

    it('passes title and category to the shared debt transaction writer', async () => {
      await service.create(USER, input({ title: '押金', categoryId: 'cat-1' }));
      expect(transactions.createDebtTransaction).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ title: '押金', categoryId: 'cat-1' }),
      );
    });

    it('finds or creates the counterparty by name', async () => {
      await service.create(USER, input({ counterparty: { name: '小明' } }));

      expect(prisma.counterparty.upsert).toHaveBeenCalledWith({
        where: { ownerId_name: { ownerId: USER, name: '小明' } },
        update: {},
        create: { ownerId: USER, name: '小明' },
      });
    });

    it('writes nothing when the ledger is not writable', async () => {
      prisma.ledgerMember.findUnique.mockResolvedValue({
        role: 'VIEWER',
        ledger: { archivedAt: null },
      });

      await expect(service.create(USER, input())).rejects.toMatchObject({ status: 403 });
      expect(transactions.createDebtTransaction).not.toHaveBeenCalled();
      expect(prisma.debtEntry.create).not.toHaveBeenCalled();
    });
  });

  describe('repayment (decisions 46, 47, 50)', () => {
    it('stores a repayment as COLLECT when the counterparty owes me', async () => {
      prisma.debtEntry.aggregate
        .mockResolvedValueOnce({ _sum: { delta: 100 } })
        .mockResolvedValueOnce({ _sum: { delta: 70 } });

      const result = await service.create(USER, input({ kind: 'REPAYMENT', amount: 30 }));

      expect(transactions.createDebtTransaction).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ type: 'COLLECT', amount: 30 }),
      );
      expect(createdData()).toMatchObject({ kind: 'COLLECT', delta: -30 });
      expect(result.counterparty.balance).toBe(70);
    });

    it('stores a repayment as REPAY when I owe the counterparty', async () => {
      prisma.debtEntry.aggregate
        .mockResolvedValueOnce({ _sum: { delta: -50 } })
        .mockResolvedValueOnce({ _sum: { delta: 0 } });

      await service.create(USER, input({ kind: 'REPAYMENT', amount: 50 }));

      expect(transactions.createDebtTransaction).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ type: 'REPAY', amount: 50 }),
      );
      expect(createdData()).toMatchObject({ kind: 'REPAY', delta: 50 });
    });

    it('locks the counterparty before reading the balance', async () => {
      prisma.debtEntry.aggregate.mockResolvedValue({ _sum: { delta: 100 } });

      await service.create(USER, input({ kind: 'REPAYMENT', amount: 30 }));

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]!).toBeLessThan(
        prisma.debtEntry.aggregate.mock.invocationCallOrder[0]!,
      );
    });

    it.each([
      ['nothing is owed', 0, 30, 'NOTHING_TO_REPAY'],
      ['it exceeds what is owed', 9, 20, 'REPAYMENT_EXCEEDS_BALANCE'],
    ])(
      'rejects with 409 and writes nothing when %s',
      async (_label, balance, amount, errorCode) => {
        prisma.debtEntry.aggregate.mockResolvedValue({ _sum: { delta: balance } });

        await expect(
          service.create(USER, input({ kind: 'REPAYMENT', amount })),
        ).rejects.toMatchObject({ status: 409, errorCode });
        expect(transactions.createDebtTransaction).not.toHaveBeenCalled();
        expect(prisma.debtEntry.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('settle (3h difference branch)', () => {
    it.each([
      ['少收', 9300, 9000, 'COLLECT', 'EXPENSE', 300],
      ['多收', 10000, 10500, 'COLLECT', 'INCOME', 500],
      ['少付', -10000, 9500, 'REPAY', 'INCOME', 500],
      ['多付', -10000, 10500, 'REPAY', 'EXPENSE', 500],
      ['剛好還清', 9300, 9300, 'COLLECT', null, 0],
    ] as const)(
      '%s clears debt and reconciles actual cash',
      async (_label, before, actual, kind, type, differenceAmount) => {
        prisma.debtEntry.aggregate
          .mockResolvedValueOnce({ _sum: { delta: before } })
          .mockResolvedValue({ _sum: { delta: 0 } });
        if (type !== null) {
          prisma.transaction.findFirst.mockResolvedValue({
            id: 'branch-1',
            type,
            amount: differenceAmount,
          });
        }

        const result = await service.create(
          USER,
          input({ kind: 'REPAYMENT', amount: actual, settle: true }),
        );
        const cleared = Math.abs(before);
        expect(createdData()).toMatchObject({ kind, delta: -before, transactionId: 'txn-new' });
        expect(transactions.createDebtTransaction).toHaveBeenCalledWith(
          prisma,
          expect.objectContaining({
            type: kind,
            amount: cleared,
            accountId: ACCOUNT,
          }),
        );
        expect(transactions.createDebtDifference).toHaveBeenCalledTimes(type === null ? 0 : 1);
        if (type !== null) {
          expect(transactions.createDebtDifference).toHaveBeenCalledWith(prisma, 'txn-new', {
            type,
            amount: differenceAmount,
          });
        }
        const cashSign = kind === 'COLLECT' ? 1 : -1;
        const branchSign = type === 'INCOME' ? 1 : -1;
        expect(cashSign * cleared + (type === null ? 0 : branchSign * differenceAmount)).toBe(
          cashSign * actual,
        );
        expect(result.counterparty.balance).toBe(0);
        expect(result.entries).toHaveLength(1);
        expect(prisma.debtEntry.create).toHaveBeenCalledTimes(1);
        expect(createdData().kind).not.toBe('SETTLEMENT');
      },
    );
  });

  describe('update with a difference branch (3h decision 172)', () => {
    /** 欠款 9300 已清，原實收 9000，分支為支出 300。 */
    function boundRepayment() {
      return entryRow({
        id: 'repay-1',
        kind: 'COLLECT',
        delta: -9300,
        transactionId: 'txn-repay',
      });
    }

    function mockBoundPair() {
      prisma.debtEntry.findFirst.mockResolvedValue(boundRepayment());
      prisma.transaction.findFirst.mockResolvedValue({
        id: 'branch-1',
        type: 'EXPENSE',
        amount: 300,
      });
    }

    it('recalculates the branch while keeping repayment delta and transaction amount', async () => {
      mockBoundPair();

      await service.update(USER, 'repay-1', { amount: 9100 });

      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'branch-1' },
        data: { type: 'EXPENSE', amount: 200 },
      });
      expect(prisma.debtEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'repay-1' }, data: {} }),
      );
      expect(transactions.updateDebtTransaction).toHaveBeenCalledWith(
        prisma,
        'txn-repay',
        {},
        USER,
      );
      expect(9300 - 200).toBe(9100);
    });

    it('flips the branch direction when the new actual amount exceeds the debt', async () => {
      mockBoundPair();

      await service.update(USER, 'repay-1', { amount: 9500 });

      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'branch-1' },
        data: { type: 'INCOME', amount: 200 },
      });
      expect(transactions.updateDebtTransaction).toHaveBeenCalledWith(
        prisma,
        'txn-repay',
        {},
        USER,
      );
      expect(9300 + 200).toBe(9500);
    });

    it('soft-deletes the branch when actual amount exactly clears the debt', async () => {
      mockBoundPair();

      await service.update(USER, 'repay-1', { amount: 9300 });

      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'branch-1' },
        data: { deletedAt: expect.any(Date) as Date },
      });
      expect(transactions.updateDebtTransaction).toHaveBeenCalledWith(
        prisma,
        'txn-repay',
        {},
        USER,
      );
    });

    it('updates delta on an ordinary repayment without a branch', async () => {
      prisma.debtEntry.findFirst
        .mockResolvedValueOnce(boundRepayment())
        .mockResolvedValueOnce(null);

      await service.update(USER, 'repay-1', { amount: 9100 });

      expect(prisma.debtEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { delta: -9100 } }),
      );
      expect(transactions.updateDebtTransaction).toHaveBeenCalledWith(
        prisma,
        'txn-repay',
        {
          amount: 9100,
        },
        USER,
      );
    });
  });

  describe('update', () => {
    function linkedEntry() {
      const entry = entryRow({ pairedEntryId: 'their-entry' });
      prisma.debtEntry.findFirst.mockResolvedValue(entry);
      prisma.debtEntry.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...entry, ...data }),
      );
      prisma.counterpartyLink.findFirst.mockResolvedValue({
        userLowId: USER,
        userHighId: 'other',
        counterpartyLowId: 'cp-1',
        counterpartyHighId: 'cp-2',
      });
    }

    it.each([
      { title: '押金' },
      { accountId: 'bank' },
      { categoryId: 'expense' },
      { note: '私人的備註' },
      { title: null, categoryId: null },
    ])('does not propose an amendment for local-only fields %j', async (input) => {
      linkedEntry();
      const result = await service.update(USER, 'entry-1', input);
      expect(result.sync).toBe('SYNCED');
      expect(prisma.debtProposal.updateMany).not.toHaveBeenCalled();
      expect(prisma.debtProposal.create).not.toHaveBeenCalled();
    });

    it.each([{ amount: 150 }, { date: '2026-10-15T00:00:00.000Z' }])(
      'still proposes an amendment for %j',
      async (input) => {
        linkedEntry();
        await service.update(USER, 'entry-1', { title: '押金', ...input });
        expect(prisma.debtProposal.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              type: 'AMEND',
              targetEntryId: 'their-entry',
            }) as unknown,
          }),
        );
      },
    );

    it.each([{ title: null }, { categoryId: null }, { accountId: 'bank' }])(
      'rejects transaction fields on a legacy entry: %j',
      async (input) => {
        prisma.debtEntry.findFirst.mockResolvedValue(
          entryRow({ transactionId: null, transaction: null }),
        );
        await expect(service.update(USER, 'entry-1', input)).rejects.toMatchObject({
          status: 409,
          errorCode: 'DEBT_ENTRY_NOT_EDITABLE',
        });
        expect(prisma.debtEntry.update).not.toHaveBeenCalled();
      },
    );

    it.each([{ title: '押金' }, { categoryId: null }, { accountId: 'bank' }])(
      'rejects transaction fields on a legacy PAID_FOR_ME entry: %j',
      async (input) => {
        prisma.debtEntry.findFirst.mockResolvedValue(entryRow({ kind: 'PAID_FOR_ME' }));
        await expect(service.update(USER, 'entry-1', input)).rejects.toMatchObject({
          status: 409,
          errorCode: 'DEBT_ENTRY_NOT_EDITABLE',
        });
        expect(transactions.updateDebtTransaction).not.toHaveBeenCalled();
        expect(prisma.debtEntry.update).not.toHaveBeenCalled();
      },
    );

    it.each([
      { amount: 150 },
      { date: '2026-10-17T00:00:00.000Z' },
      { note: '備註' },
      { title: '押金' },
      { categoryId: null },
      { accountId: 'bank' },
    ])('checks ledger write access for %j', async (input) => {
      prisma.debtEntry.findFirst.mockResolvedValue(entryRow());
      prisma.ledgerMember.findUnique.mockResolvedValue({
        role: 'VIEWER',
        ledger: { archivedAt: null },
      });
      await expect(service.update(USER, 'entry-1', input)).rejects.toMatchObject({ status: 403 });
      expect(transactions.updateDebtTransaction).not.toHaveBeenCalled();
      expect(prisma.debtEntry.update).not.toHaveBeenCalled();
      expect(prisma.transaction.update).not.toHaveBeenCalled();
      expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
      expect(prisma.debtProposal.create).not.toHaveBeenCalled();
      expect(prisma.ledgerMember.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ledgerId_userId: { ledgerId: LEDGER, userId: USER } } }),
      );
    });

    it.each([{ amount: 150 }, { note: '我的備註' }, { date: DATE }])(
      'does not check a legacy entry without a transaction for %j',
      async (input) => {
        prisma.debtEntry.findFirst.mockResolvedValue(
          entryRow({ transactionId: null, transaction: null }),
        );
        prisma.ledgerMember.findUnique.mockResolvedValue(null);
        await service.update(USER, 'entry-1', input);
        expect(prisma.ledgerMember.findUnique).not.toHaveBeenCalled();
      },
    );

    it.each([
      [null, 404, 'NOT_FOUND'],
      [{ role: 'EDITOR', ledger: { archivedAt: new Date(DATE) } }, 409, 'LEDGER_ARCHIVED'],
    ])('refuses writes when ledger membership is %j', async (membership, status, errorCode) => {
      prisma.debtEntry.findFirst.mockResolvedValue(entryRow());
      prisma.ledgerMember.findUnique.mockResolvedValue(membership);
      await expect(service.update(USER, 'entry-1', { note: '備註' })).rejects.toMatchObject({
        status,
        errorCode,
      });
      expect(transactions.updateDebtTransaction).not.toHaveBeenCalled();
      expect(prisma.debtEntry.update).not.toHaveBeenCalled();
    });

    it('does not propose unchanged ordinary amount and date together with local fields', async () => {
      linkedEntry();
      await service.update(USER, 'entry-1', { amount: 120, date: DATE, title: '押金' });
      expect(prisma.debtProposal.updateMany).not.toHaveBeenCalled();
      expect(prisma.debtProposal.create).not.toHaveBeenCalled();
    });

    it('keeps the sign of the entry and updates its transaction', async () => {
      // loadOwnedEntry 回那筆紀錄；recalculateSettlement 找不到綁定的差額（回 null）。
      prisma.debtEntry.findFirst
        .mockResolvedValueOnce(entryRow({ kind: 'BORROW', delta: -111 }))
        .mockResolvedValueOnce(null);

      await service.update(USER, 'entry-1', { amount: 150 });

      expect(prisma.debtEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ delta: -150 }) as unknown }),
      );
      expect(transactions.updateDebtTransaction).toHaveBeenCalledWith(
        prisma,
        'txn-1',
        {
          amount: 150,
        },
        USER,
      );
    });

    it.each(['SETTLEMENT', 'FORGIVE', 'FORGIVEN'])('refuses to edit a %s entry', async (kind) => {
      prisma.debtEntry.findFirst.mockResolvedValue(
        entryRow({ kind, delta: -3, transactionId: null }),
      );

      await expect(service.update(USER, 'entry-1', { note: 'x' })).rejects.toMatchObject({
        status: 409,
        errorCode: 'DEBT_ENTRY_NOT_EDITABLE',
      });
      expect(prisma.debtEntry.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it.each([
      [null, 404, 'NOT_FOUND'],
      [{ role: 'VIEWER', ledger: { archivedAt: null } }, 403, 'FORBIDDEN'],
      [{ role: 'EDITOR', ledger: { archivedAt: new Date(DATE) } }, 409, 'LEDGER_ARCHIVED'],
    ])(
      'rejects removal before writing when membership is %j',
      async (membership, status, errorCode) => {
        prisma.debtEntry.findFirst.mockResolvedValue(entryRow({ kind: 'COLLECT' }));
        prisma.ledgerMember.findUnique.mockResolvedValue(membership);
        await expect(service.remove(USER, 'entry-1')).rejects.toMatchObject({ status, errorCode });
        expect(prisma.debtEntry.update).not.toHaveBeenCalled();
        expect(prisma.debtEntry.updateMany).not.toHaveBeenCalled();
        expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
        expect(transactions.softDeleteDebtTransactions).not.toHaveBeenCalled();
        expect(prisma.debtProposal.create).not.toHaveBeenCalled();
      },
    );

    it('does not check a legacy entry without a transaction', async () => {
      prisma.debtEntry.findFirst.mockResolvedValue(
        entryRow({ transactionId: null, transaction: null }),
      );
      prisma.ledgerMember.findUnique.mockResolvedValue(null);
      await service.remove(USER, 'entry-1');
      expect(prisma.ledgerMember.findUnique).not.toHaveBeenCalled();
      expect(prisma.debtEntry.update).toHaveBeenCalled();
    });

    it('soft-deletes the entry and its transaction with the same timestamp', async () => {
      prisma.debtEntry.findFirst.mockResolvedValue(entryRow());

      await service.remove(USER, 'entry-1');

      const calls = prisma.debtEntry.update.mock.calls as Array<[{ data: { deletedAt: Date } }]>;
      const deletedAt = calls[0]![0].data.deletedAt;
      expect(transactions.softDeleteDebtTransactions).toHaveBeenCalledWith(
        prisma,
        ['txn-1'],
        deletedAt,
      );
    });

    it('soft-deletes repayment and branch with the same timestamp', async () => {
      prisma.debtEntry.findFirst.mockResolvedValue(
        entryRow({ id: 'repay-1', kind: 'COLLECT', transactionId: 'txn-repay' }),
      );

      await service.remove(USER, 'repay-1');

      const deletedAt = (prisma.debtEntry.update.mock.calls[0]![0] as { data: { deletedAt: Date } })
        .data.deletedAt;
      expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
        where: { differenceOfId: 'txn-repay', deletedAt: null },
        data: { deletedAt },
      });
      expect(transactions.softDeleteDebtTransactions).toHaveBeenCalledWith(
        prisma,
        ['txn-repay'],
        deletedAt,
      );
    });

    it('withdraws a bound settlement together with its repayment (decision 156)', async () => {
      prisma.debtEntry.findFirst.mockResolvedValue(
        entryRow({ id: 'repay-1', kind: 'COLLECT', delta: -9000, transactionId: 'txn-repay' }),
      );

      await service.remove(USER, 'repay-1');

      // 差額用跟還款同一個 deletedAt 撤銷；差額不產生交易，不用處理交易。
      const [settlementCall] = prisma.debtEntry.updateMany.mock.calls as Array<
        [{ where: { settlesEntryId: string; deletedAt: null }; data: { deletedAt: Date } }]
      >;
      expect(settlementCall![0].where).toEqual({ settlesEntryId: 'repay-1', deletedAt: null });
      const entryCall = (
        prisma.debtEntry.update.mock.calls as Array<
          [{ where: { id: string }; data: { deletedAt: Date } }]
        >
      ).find(([{ where }]) => where.id === 'repay-1')!;
      expect(settlementCall![0].data.deletedAt).toBe(entryCall[0].data.deletedAt);
      expect(transactions.softDeleteDebtTransactions).toHaveBeenCalledWith(
        prisma,
        ['txn-repay'],
        entryCall[0].data.deletedAt,
      );
    });

    it('refuses to withdraw a settlement bound to a repayment (decision 157)', async () => {
      prisma.debtEntry.findFirst.mockResolvedValue(
        entryRow({
          id: 'settle-1',
          kind: 'SETTLEMENT',
          delta: -300,
          transactionId: null,
          settlesEntryId: 'repay-1',
        }),
      );

      await expect(service.remove(USER, 'settle-1')).rejects.toMatchObject({
        status: 409,
        errorCode: 'SETTLEMENT_BOUND_TO_REPAYMENT',
      });
      expect(prisma.debtEntry.update).not.toHaveBeenCalled();
      expect(prisma.debtEntry.updateMany).not.toHaveBeenCalled();
    });

    it('still withdraws an unbound (pre-3g) settlement on its own', async () => {
      prisma.debtEntry.findFirst.mockResolvedValue(
        entryRow({
          id: 'settle-old',
          kind: 'SETTLEMENT',
          delta: -300,
          transactionId: null,
          settlesEntryId: null,
        }),
      );

      await service.remove(USER, 'settle-old');

      const calls = prisma.debtEntry.update.mock.calls as unknown as Array<
        [{ where: { id: string } }]
      >;
      expect(calls).toHaveLength(1);
      expect(calls[0]![0].where).toEqual({ id: 'settle-old' });
      // 沒有綁定的還款，也不會誤撤別人的差額：updateMany 只找 settlesEntryId＝自己、且
      // 差額本身不產生交易。
      const [settlementCall] = prisma.debtEntry.updateMany.mock.calls as unknown as Array<
        [{ where: { settlesEntryId: string } }]
      >;
      expect(settlementCall![0].where.settlesEntryId).toBe('settle-old');
      expect(transactions.softDeleteDebtTransactions).not.toHaveBeenCalled();
    });
  });
});

/** 結清的五種整數分情境：往來歸零，交易金流與實收相等。 */
describe('debt settlement differences', () => {
  const date = new Date('2026-10-14T12:00:00.000Z');
  const cases = [
    ['少收', 'COLLECT', 9300, 9000, 'EXPENSE', 300],
    ['多收', 'COLLECT', 10000, 10500, 'INCOME', 500],
    ['少付', 'REPAY', 10000, 9500, 'INCOME', 500],
    ['多付', 'REPAY', 10000, 10500, 'EXPENSE', 500],
    ['剛好還清', 'COLLECT', 9300, 9300, null, 0],
  ] as const;

  it.each(cases)(
    '%s keeps the balance zero and cash movement equal to actual amount',
    async (_label, kind, cleared, actual, type, amount) => {
      const before = kind === 'COLLECT' ? cleared : -cleared;
      const delta = deltaFor(kind, cleared);
      expect(before + delta).toBe(0);
      const difference = differenceFor(kind, cleared, actual);
      expect(difference).toEqual(type === null ? null : { type, amount });
      const cashSign = kind === 'COLLECT' ? 1 : -1;
      const branchSign = difference?.type === 'INCOME' ? 1 : -1;
      expect(cashSign * cleared + (difference?.amount ?? 0) * branchSign).toBe(cashSign * actual);

      const transactions = { createDebtDifference: jest.fn().mockResolvedValue('branch') };
      const entry = { id: 'entry', kind, delta, transactionId: 'repayment', date };
      await writeDifference(
        {} as Prisma.TransactionClient,
        transactions as unknown as TransactionsService,
        entry as Prisma.DebtEntryGetPayload<object>,
        actual,
      );
      expect(transactions.createDebtDifference).toHaveBeenCalledTimes(type === null ? 0 : 1);
    },
  );

  it('recalculates, changes direction, and removes a zero difference without changing the repayment', async () => {
    const branch = { id: 'branch', type: 'EXPENSE', amount: 300, deletedAt: null };
    const transaction = {
      findFirst: jest.fn().mockResolvedValue(branch),
      update: jest.fn().mockResolvedValue(branch),
    };
    const tx = {
      transaction,
      debtEntry: { findFirst: jest.fn() },
    } as unknown as Prisma.TransactionClient;
    const repayment = {
      id: 'entry',
      kind: 'COLLECT' as const,
      delta: -9300,
      transactionId: 'repayment',
    };
    expect(await recalculateSettlement(tx, repayment, 9100)).toBe(true);
    expect(transaction.update).toHaveBeenLastCalledWith({
      where: { id: 'branch' },
      data: { type: 'EXPENSE', amount: 200 },
    });
    expect(await recalculateSettlement(tx, repayment, 9500)).toBe(true);
    expect(transaction.update).toHaveBeenLastCalledWith({
      where: { id: 'branch' },
      data: { type: 'INCOME', amount: 200 },
    });
    expect(await recalculateSettlement(tx, repayment, 9300)).toBe(true);
    expect(transaction.update).toHaveBeenLastCalledWith({
      where: { id: 'branch' },
      data: { deletedAt: expect.any(Date) as Date },
    });
  });

  it('withdraws the repayment, branch, and old settlement with one timestamp', async () => {
    const deletedAt = new Date();
    const debtEntry = { updateMany: jest.fn(), update: jest.fn() };
    const transaction = { updateMany: jest.fn() };
    const transactions = { softDeleteDebtTransactions: jest.fn() };
    const tx = { debtEntry, transaction } as unknown as Prisma.TransactionClient;
    await voidRepaymentWithSettlement(
      tx,
      transactions as unknown as TransactionsService,
      { id: 'entry', transactionId: 'repayment' } as Prisma.DebtEntryGetPayload<object>,
      deletedAt,
    );
    expect(debtEntry.updateMany).toHaveBeenCalledWith({
      where: { settlesEntryId: 'entry', deletedAt: null },
      data: { deletedAt },
    });
    expect(transaction.updateMany).toHaveBeenCalledWith({
      where: { differenceOfId: 'repayment', deletedAt: null },
      data: { deletedAt },
    });
    expect(transactions.softDeleteDebtTransactions).toHaveBeenCalledWith(
      tx,
      ['repayment'],
      deletedAt,
    );
  });
});

/** 免除的損益方向固定，由往來紀錄種類決定。 */
describe('forgiveness transaction directions', () => {
  it('records FORGIVE as expense and FORGIVEN as income', () => {
    expect(forgivenessTypeFor('FORGIVE')).toBe('EXPENSE');
    expect(forgivenessTypeFor('FORGIVEN')).toBe('INCOME');
  });
});
