import type { PrismaService } from '../prisma/prisma.service';
import type { TransactionsService } from '../transactions/transactions.service';
import { DebtEntriesService } from './debt-entries.service';
import type { CreateDebtEntryDto } from './dto/create-debt-entry.dto';

/**
 * `DebtEntriesService`：記一筆、改、刪（spec 3b §3、§5.2）。
 *
 * 這個 suite 驗證四件事：
 * 1. **組合規則**：`counterparty` 二選一、`record` 必填、`PAID_FOR_ME` 的分類與帳戶、`settle`
 *    只給還款——違反一律 400，而且在碰資料庫之前。
 * 2. **交易怎麼產生**：型別由種類決定；`record: null` 不產生；代付走 `createPaidForMeExpense`。
 * 3. **以此結清**：補一筆 `SETTLEMENT`，`delta` 讓餘額歸零；剛好還清就不補。
 * 4. **調整紀錄不能改**，改一般紀錄時正負號沿用原本那一筆。
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
      },
      ledgerMember: {
        findUnique: jest.fn().mockResolvedValue({ role: 'EDITOR', ledger: { archivedAt: null } }),
      },
      // 回傳型別要明寫成 unknown，否則 `mock` 引用自己會讓 TypeScript 把整個物件推成 any。
      $transaction: jest.fn((callback: (tx: unknown) => unknown): unknown => callback(mock)),
    };
    return mock;
  }

  function buildTransactions() {
    return {
      createDebtTransaction: jest.fn().mockResolvedValue('txn-new'),
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
      ['PAID_FOR_ME with record null', { kind: 'PAID_FOR_ME', categoryId: 'c', record: null }],
      [
        'PAID_FOR_ME naming an account',
        { kind: 'PAID_FOR_ME', categoryId: 'c', record: { ledgerId: LEDGER, accountId: ACCOUNT } },
      ],
      ['PAID_FOR_ME without a category', { kind: 'PAID_FOR_ME', record: { ledgerId: LEDGER } }],
      ['a category on LEND', { categoryId: 'c' }],
      ['settle on LEND', { settle: true }],
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

    it('creates no transaction and skips the ledger check when record is null', async () => {
      await service.create(USER, input({ record: null }));

      expect(transactions.createDebtTransaction).not.toHaveBeenCalled();
      expect(prisma.ledgerMember.findUnique).not.toHaveBeenCalled();
      expect(createdData()).toMatchObject({ transactionId: null });
    });

    it('records PAID_FOR_ME as an expense with the category and no account', async () => {
      await service.create(
        USER,
        input({
          kind: 'PAID_FOR_ME',
          amount: 400,
          categoryId: 'cat-1',
          record: { ledgerId: LEDGER },
        }),
      );

      expect(transactions.createPaidForMeExpense).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ ledgerId: LEDGER, amount: 400, categoryId: 'cat-1' }),
      );
      expect(createdData()).toMatchObject({
        kind: 'PAID_FOR_ME',
        delta: -400,
        transactionId: 'txn-expense',
      });
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

  describe('settle (decision 38)', () => {
    it('adds a SETTLEMENT that brings the balance back to zero', async () => {
      // 寫入還款後的餘額 3（對方還欠 3），結清差額 −3：我少收 3。
      prisma.debtEntry.aggregate
        .mockResolvedValueOnce({ _sum: { delta: 3 } })
        .mockResolvedValueOnce({ _sum: { delta: 0 } });

      const result = await service.create(
        USER,
        input({ kind: 'COLLECT', amount: 90, settle: true }),
      );

      expect(createdData(1)).toMatchObject({ kind: 'SETTLEMENT', delta: -3, transactionId: null });
      expect(result.entries).toHaveLength(2);
      expect(result.counterparty.balance).toBe(0);
      // 只有還款那一筆產生交易，差額不產生。
      expect(transactions.createDebtTransaction).toHaveBeenCalledTimes(1);
    });

    it('adds nothing when the repayment already clears the balance', async () => {
      prisma.debtEntry.aggregate.mockResolvedValue({ _sum: { delta: 0 } });

      const result = await service.create(
        USER,
        input({ kind: 'COLLECT', amount: 93, settle: true }),
      );

      expect(prisma.debtEntry.create).toHaveBeenCalledTimes(1);
      expect(result.entries).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('keeps the sign of the entry and updates its transaction', async () => {
      prisma.debtEntry.findFirst.mockResolvedValue(entryRow({ kind: 'BORROW', delta: -111 }));

      await service.update(USER, 'entry-1', { amount: 150 });

      expect(prisma.debtEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ delta: -150 }) as unknown }),
      );
      expect(transactions.updateDebtTransaction).toHaveBeenCalledWith(prisma, 'txn-1', {
        amount: 150,
      });
    });

    it.each(['SETTLEMENT', 'FORGIVE'])('refuses to edit a %s entry', async (kind) => {
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
  });
});
