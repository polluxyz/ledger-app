import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { TransactionsService } from '../transactions/transactions.service';
import { DebtPaymentsService } from './debt-payments.service';

/**
 * `DebtPaymentsService` 的三個方法：記還款、刪還款、免除。
 *
 * 這個 suite 驗證四件事：
 * 1. **狀態與金額的閘門**——已結清／已免除不能再還（`DEBT_NOT_OPEN`），超過未清餘額
 *    不能還（`DEBT_OVERPAYMENT`），剛好還完則允許並結清。
 * 2. **交易型別由方向決定**：`LENT` → `COLLECT`，`BORROWED` → `REPAY`，呼叫端指定不了。
 * 3. **記到哪裡**的三種情況：指定 `record`、沿用本金交易、本金沒有交易就不產生交易。
 * 4. **失敗就什麼都不寫**：帳本權限檢查丟例外時，`debtPayment.create` 不可以被呼叫過。
 * 5. **以此結清**（決策 30）：`settles` 跳過超額檢查、`record: null` 明確不產生交易、
 *    並行寫入撞上部分唯一索引時回 `DEBT_NOT_OPEN`。
 *
 * 策略：Prisma 全程 mock（不連資料庫），`$transaction` 直接把同一個 mock 當 tx 傳進
 * callback，`TransactionsService` 也是 mock——那兩個 helper 有自己的測試檔。
 */
describe('DebtPaymentsService', () => {
  const OWNER = 'user-1';
  const DEBT_ID = 'debt-1';
  const LEDGER_ID = 'ledger-1';
  const ACCOUNT_ID = 'account-1';
  const DATE = '2026-09-24T00:00:00.000Z';

  type PaymentRow = {
    id: string;
    amount: number;
    date: Date;
    note: string | null;
    transactionId: string | null;
    settles: boolean;
    deletedAt: Date | null;
    createdAt: Date;
  };

  function payment(overrides: Partial<PaymentRow> = {}): PaymentRow {
    return {
      id: 'payment-1',
      amount: 1000,
      date: new Date(DATE),
      note: null,
      transactionId: 'txn-payment-1',
      settles: false,
      deletedAt: null,
      createdAt: new Date(DATE),
      ...overrides,
    };
  }

  function debtRow(overrides: Record<string, unknown> = {}) {
    return {
      id: DEBT_ID,
      ownerId: OWNER,
      direction: 'LENT',
      counterpartyName: '小明',
      principal: 5000,
      date: new Date(DATE),
      note: null,
      transactionId: 'txn-principal',
      forgivenAt: null as Date | null,
      deletedAt: null as Date | null,
      createdAt: new Date(DATE),
      updatedAt: new Date(DATE),
      payments: [] as PaymentRow[],
      transaction: { ledgerId: LEDGER_ID, accountId: ACCOUNT_ID } as {
        ledgerId: string;
        accountId: string | null;
      } | null,
      ...overrides,
    };
  }

  function buildPrisma() {
    const mock = {
      debt: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      debtPayment: {
        create: jest.fn().mockResolvedValue({ id: 'payment-new' }),
        update: jest.fn().mockResolvedValue({}),
      },
      ledgerMember: { findUnique: jest.fn() },
      // 回傳型別要明寫成 unknown，否則 `mock` 引用自己會讓 TypeScript 把整個物件推成 any。
      $transaction: jest.fn((callback: (tx: unknown) => unknown): unknown => callback(mock)),
    };
    return mock;
  }

  /** 取出某個 mock 第一次被呼叫時的第一個參數。Jest 的 `mock.calls` 是 any，集中在這裡收斂型別。 */
  function firstArgument<T>(mock: jest.Mock): T {
    const calls = mock.mock.calls as unknown[][];
    return calls[0]![0] as T;
  }

  function buildTransactions() {
    return {
      createDebtTransaction: jest.fn().mockResolvedValue('txn-new'),
      updateDebtTransaction: jest.fn(),
      softDeleteDebtTransactions: jest.fn().mockResolvedValue(undefined),
    };
  }

  let prisma: ReturnType<typeof buildPrisma>;
  let transactions: ReturnType<typeof buildTransactions>;
  let service: DebtPaymentsService;

  /** 讓 `loadOwnedDebt` 每次都拿到同一列；create 會讀兩次（前後各一），所以用 mockResolvedValue。 */
  function givenDebt(row: ReturnType<typeof debtRow>) {
    prisma.debt.findFirst.mockResolvedValue(row);
  }

  /** 帳本成員資格：預設是 EDITOR 且未封存，讓 `assertLedgerWritable` 通過。 */
  function givenWritableLedger() {
    prisma.ledgerMember.findUnique.mockResolvedValue({
      role: 'EDITOR',
      ledger: { archivedAt: null },
    });
  }

  beforeEach(() => {
    prisma = buildPrisma();
    transactions = buildTransactions();
    givenWritableLedger();
    service = new DebtPaymentsService(
      prisma as unknown as PrismaService,
      transactions as unknown as TransactionsService,
    );
  });

  describe('create', () => {
    it('records a repayment on money lent as a COLLECT transaction', async () => {
      givenDebt(debtRow());

      const debt = await service.create(OWNER, DEBT_ID, { amount: 2000, date: DATE });

      expect(transactions.createDebtTransaction).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          ledgerId: LEDGER_ID,
          creatorId: OWNER,
          type: 'COLLECT',
          amount: 2000,
          accountId: ACCOUNT_ID,
        }),
      );
      expect(prisma.debtPayment.create).toHaveBeenCalledWith({
        data: {
          debtId: DEBT_ID,
          amount: 2000,
          date: new Date(DATE),
          note: null,
          transactionId: 'txn-new',
          settles: false,
        },
      });
      // 回應由重讀的那一列算出來，此處的 mock 兩次都回同一列，所以未清餘額仍是 5000。
      expect(debt.id).toBe(DEBT_ID);
      expect(debt.status).toBe('OPEN');
    });

    it('records a repayment on money borrowed as a REPAY transaction', async () => {
      givenDebt(debtRow({ direction: 'BORROWED' }));

      await service.create(OWNER, DEBT_ID, { amount: 1000, date: DATE });

      expect(transactions.createDebtTransaction).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ type: 'REPAY' }),
      );
    });

    it('records into the ledger and account given in record', async () => {
      givenDebt(debtRow());

      await service.create(OWNER, DEBT_ID, {
        amount: 500,
        date: DATE,
        note: '第一期',
        record: { ledgerId: 'ledger-2', accountId: 'account-2' },
      });

      expect(prisma.ledgerMember.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ledgerId_userId: { ledgerId: 'ledger-2', userId: OWNER } },
        }),
      );
      expect(transactions.createDebtTransaction).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          ledgerId: 'ledger-2',
          accountId: 'account-2',
        }),
      );
      // 還款的備註屬於債務，不帶進交易：共享帳本的其他成員看得到交易（spec §3.5）。
      const [, recorded] = transactions.createDebtTransaction.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(recorded).not.toHaveProperty('note');
    });

    it('reuses the principal transaction’s ledger and account when record is omitted', async () => {
      givenDebt(debtRow({ transaction: { ledgerId: 'ledger-9', accountId: null } }));

      await service.create(OWNER, DEBT_ID, { amount: 500, date: DATE });

      expect(transactions.createDebtTransaction).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ ledgerId: 'ledger-9', accountId: undefined }),
      );
    });

    it('creates no transaction for an old debt that has none', async () => {
      givenDebt(debtRow({ transactionId: null, transaction: null }));

      await service.create(OWNER, DEBT_ID, { amount: 500, date: DATE });

      expect(transactions.createDebtTransaction).not.toHaveBeenCalled();
      expect(prisma.ledgerMember.findUnique).not.toHaveBeenCalled();
      expect(prisma.debtPayment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ transactionId: null }) as unknown,
        }),
      );
    });

    it('accepts a repayment of exactly the outstanding amount', async () => {
      givenDebt(debtRow({ principal: 1000, payments: [payment({ amount: 400 })] }));

      await service.create(OWNER, DEBT_ID, { amount: 600, date: DATE });

      expect(prisma.debtPayment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: 600 }) as unknown }),
      );
    });

    it('rejects a repayment larger than what is still owed', async () => {
      givenDebt(debtRow({ principal: 1000, payments: [payment({ amount: 400 })] }));

      await expect(
        service.create(OWNER, DEBT_ID, { amount: 601, date: DATE }),
      ).rejects.toMatchObject({ status: 409, errorCode: 'DEBT_OVERPAYMENT' });
      expect(prisma.debtPayment.create).not.toHaveBeenCalled();
      expect(transactions.createDebtTransaction).not.toHaveBeenCalled();
    });

    it('rejects a repayment on a settled debt', async () => {
      givenDebt(debtRow({ principal: 1000, payments: [payment({ amount: 1000 })] }));

      await expect(service.create(OWNER, DEBT_ID, { amount: 1, date: DATE })).rejects.toMatchObject(
        {
          status: 409,
          errorCode: 'DEBT_NOT_OPEN',
        },
      );
      expect(prisma.debtPayment.create).not.toHaveBeenCalled();
    });

    it('rejects a repayment on a forgiven debt', async () => {
      givenDebt(debtRow({ forgivenAt: new Date(DATE) }));

      await expect(service.create(OWNER, DEBT_ID, { amount: 1, date: DATE })).rejects.toMatchObject(
        {
          status: 409,
          errorCode: 'DEBT_NOT_OPEN',
        },
      );
      expect(prisma.debtPayment.create).not.toHaveBeenCalled();
    });

    describe('settling with a difference (decision 30)', () => {
      it('accepts more than what is owed when settles is set', async () => {
        givenDebt(debtRow({ principal: 93 }));

        await service.create(OWNER, DEBT_ID, { amount: 95, date: DATE, settles: true });

        expect(prisma.debtPayment.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ amount: 95, settles: true }) as unknown,
          }),
        );
        // 帳戶照實際收到的金額變動，差額不另外產生交易。
        expect(transactions.createDebtTransaction).toHaveBeenCalledTimes(1);
        expect(transactions.createDebtTransaction).toHaveBeenCalledWith(
          prisma,
          expect.objectContaining({ amount: 95, type: 'COLLECT' }),
        );
      });

      it('accepts less than what is owed and still marks the payment as settling', async () => {
        givenDebt(debtRow({ principal: 93 }));

        await service.create(OWNER, DEBT_ID, { amount: 90, date: DATE, settles: true });

        expect(prisma.debtPayment.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ amount: 90, settles: true }) as unknown,
          }),
        );
      });

      it('rejects any further payment once a settling payment exists', async () => {
        givenDebt(debtRow({ principal: 93, payments: [payment({ amount: 90, settles: true })] }));

        await expect(
          service.create(OWNER, DEBT_ID, { amount: 1, date: DATE, settles: true }),
        ).rejects.toMatchObject({ status: 409, errorCode: 'DEBT_NOT_OPEN' });
        expect(prisma.debtPayment.create).not.toHaveBeenCalled();
      });

      // 兩個請求同時讀到 OPEN、同時寫入時，由資料庫的部分唯一索引擋下第二筆。
      it('turns a unique-index race on the settling payment into DEBT_NOT_OPEN', async () => {
        givenDebt(debtRow({ principal: 93 }));
        prisma.debtPayment.create.mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('unique', {
            code: 'P2002',
            clientVersion: 'test',
          }),
        );

        await expect(
          service.create(OWNER, DEBT_ID, { amount: 90, date: DATE, settles: true }),
        ).rejects.toMatchObject({ status: 409, errorCode: 'DEBT_NOT_OPEN' });
      });
    });

    it('creates no transaction when record is explicitly null, even if the principal has one', async () => {
      givenDebt(debtRow());

      await service.create(OWNER, DEBT_ID, { amount: 500, date: DATE, record: null });

      expect(transactions.createDebtTransaction).not.toHaveBeenCalled();
      expect(prisma.ledgerMember.findUnique).not.toHaveBeenCalled();
      expect(prisma.debtPayment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ transactionId: null }) as unknown,
        }),
      );
    });

    // SC-D10：帳本檢查失敗時，連一列還款都不能留下——e2e 會回頭數資料庫。
    it('writes no payment row when the ledger is not writable', async () => {
      givenDebt(debtRow());
      prisma.ledgerMember.findUnique.mockResolvedValue({
        role: 'VIEWER',
        ledger: { archivedAt: null },
      });

      await expect(
        service.create(OWNER, DEBT_ID, { amount: 500, date: DATE }),
      ).rejects.toMatchObject({ status: 403, errorCode: 'FORBIDDEN' });
      expect(transactions.createDebtTransaction).not.toHaveBeenCalled();
      expect(prisma.debtPayment.create).not.toHaveBeenCalled();
    });

    it('propagates a failure from creating the transaction without writing a payment', async () => {
      givenDebt(debtRow());
      transactions.createDebtTransaction.mockRejectedValue(new Error('account is not yours'));

      await expect(service.create(OWNER, DEBT_ID, { amount: 500, date: DATE })).rejects.toThrow(
        'account is not yours',
      );
      expect(prisma.debtPayment.create).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('soft-deletes the payment and its transaction', async () => {
      givenDebt(debtRow({ payments: [payment({ id: 'p-1', transactionId: 'txn-p1' })] }));

      await service.remove(OWNER, DEBT_ID, 'p-1');

      const updateCall = firstArgument<{ where: { id: string }; data: { deletedAt: Date } }>(
        prisma.debtPayment.update,
      );
      expect(updateCall.where).toEqual({ id: 'p-1' });
      expect(updateCall.data.deletedAt).toBeInstanceOf(Date);
      expect(transactions.softDeleteDebtTransactions).toHaveBeenCalledWith(
        prisma,
        ['txn-p1'],
        updateCall.data.deletedAt,
      );
    });

    it('soft-deletes a payment that never had a transaction', async () => {
      givenDebt(debtRow({ payments: [payment({ id: 'p-1', transactionId: null })] }));

      await service.remove(OWNER, DEBT_ID, 'p-1');

      expect(transactions.softDeleteDebtTransactions).toHaveBeenCalledWith(
        prisma,
        [],
        expect.any(Date),
      );
    });

    it('works on a forgiven debt, since it only corrects history', async () => {
      givenDebt(debtRow({ forgivenAt: new Date(DATE), payments: [payment({ id: 'p-1' })] }));

      await service.remove(OWNER, DEBT_ID, 'p-1');

      expect(prisma.debtPayment.update).toHaveBeenCalled();
    });

    it('gives the same 404 for a payment id that does not exist', async () => {
      givenDebt(debtRow({ payments: [payment({ id: 'p-1' })] }));

      await expect(service.remove(OWNER, DEBT_ID, 'p-other')).rejects.toMatchObject({
        status: 404,
        errorCode: 'NOT_FOUND',
      });
      expect(prisma.debtPayment.update).not.toHaveBeenCalled();
    });

    it('gives the same 404 for a payment that is already deleted', async () => {
      givenDebt(debtRow({ payments: [payment({ id: 'p-1', deletedAt: new Date(DATE) })] }));

      await expect(service.remove(OWNER, DEBT_ID, 'p-1')).rejects.toMatchObject({
        status: 404,
        errorCode: 'NOT_FOUND',
      });
      expect(prisma.debtPayment.update).not.toHaveBeenCalled();
      expect(transactions.softDeleteDebtTransactions).not.toHaveBeenCalled();
    });
  });

  describe('forgive', () => {
    it('marks the debt forgiven without creating any transaction', async () => {
      const row = debtRow({ payments: [payment({ amount: 1000 })] });
      givenDebt(row);
      prisma.debt.update.mockResolvedValue({ ...row, forgivenAt: new Date(DATE) });

      const debt = await service.forgive(OWNER, DEBT_ID);

      const updateCall = firstArgument<{ where: { id: string }; data: { forgivenAt: Date } }>(
        prisma.debt.update,
      );
      expect(updateCall.where).toEqual({ id: DEBT_ID });
      expect(updateCall.data.forgivenAt).toBeInstanceOf(Date);
      expect(transactions.createDebtTransaction).not.toHaveBeenCalled();
      expect(debt.status).toBe('FORGIVEN');
      // 未清餘額照算：被免除的是這 4000。
      expect(debt.outstanding).toBe(4000);
    });

    it('refuses to forgive money you borrowed', async () => {
      givenDebt(debtRow({ direction: 'BORROWED' }));

      await expect(service.forgive(OWNER, DEBT_ID)).rejects.toMatchObject({
        status: 409,
        errorCode: 'DEBT_NOT_FORGIVABLE',
      });
      expect(prisma.debt.update).not.toHaveBeenCalled();
      expect(transactions.createDebtTransaction).not.toHaveBeenCalled();
    });

    it('refuses to forgive a settled debt', async () => {
      givenDebt(debtRow({ principal: 1000, payments: [payment({ amount: 1000 })] }));

      await expect(service.forgive(OWNER, DEBT_ID)).rejects.toMatchObject({
        status: 409,
        errorCode: 'DEBT_NOT_OPEN',
      });
      expect(prisma.debt.update).not.toHaveBeenCalled();
    });

    it('refuses to forgive a debt that is already forgiven', async () => {
      givenDebt(debtRow({ forgivenAt: new Date(DATE) }));

      await expect(service.forgive(OWNER, DEBT_ID)).rejects.toMatchObject({
        status: 409,
        errorCode: 'DEBT_NOT_OPEN',
      });
      expect(prisma.debt.update).not.toHaveBeenCalled();
    });

    // 方向優先於狀態：先回答「這種債務根本不能免除」，再談它開不開著。
    it('reports the direction before the status when both are wrong', async () => {
      givenDebt(
        debtRow({ direction: 'BORROWED', principal: 1000, payments: [payment({ amount: 1000 })] }),
      );

      await expect(service.forgive(OWNER, DEBT_ID)).rejects.toMatchObject({
        errorCode: 'DEBT_NOT_FORGIVABLE',
      });
    });
  });
});
