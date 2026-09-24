import { AppException } from '../common/exceptions/app.exception';
import type { PrismaService } from '../prisma/prisma.service';
import type { TransactionsService } from '../transactions/transactions.service';
import { DebtsService } from './debts.service';

/**
 * `DebtsService` 的行為（授權與資料隔離另由 `debts.authz.spec.ts` 把關，這裡不重複）。
 *
 * 驗證六件事：建立時「帶不帶 `record`」決定有沒有本金交易、且帳本檢查失敗時整筆不寫；
 * 列表的狀態篩選與分頁夾住；修改的超額本金擋下、且本金交易跟著改；刪除把債務、還款與
 * 交易一起軟刪；每人淨額的分組與正負號。
 *
 * 策略：Prisma 全程 mock，`$transaction` 直接把同一個 mock 當成 tx 執行 callback——真正的
 * 回滾行為靠 e2e 驗，這裡驗的是「失敗時根本沒呼叫到寫入」。`TransactionsService` 也 mock，
 * 只確認被呼叫時帶了正確的參數。
 */
describe('DebtsService', () => {
  const OWNER = 'user-1';
  const DEBT_ID = 'debt-1';
  const LEDGER_ID = 'ledger-1';

  /** 一列還款的最小形狀。 */
  function paymentRow(over: Record<string, unknown> = {}) {
    return {
      id: 'payment-1',
      amount: 2000,
      date: new Date('2026-09-10T00:00:00.000Z'),
      note: null as string | null,
      transactionId: null as string | null,
      settles: false,
      deletedAt: null as Date | null,
      createdAt: new Date('2026-09-10T00:00:00.000Z'),
      ...over,
    };
  }

  /** 一列債務的最小形狀，測試再各自覆寫需要的欄位。 */
  function debtRow(over: Record<string, unknown> = {}) {
    return {
      id: DEBT_ID,
      direction: 'LENT' as const,
      counterpartyName: '小明',
      principal: 5000,
      date: new Date('2026-09-01T00:00:00.000Z'),
      note: null as string | null,
      transactionId: null as string | null,
      forgivenAt: null as Date | null,
      deletedAt: null as Date | null,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      payments: [] as ReturnType<typeof paymentRow>[],
      transaction: null,
      ...over,
    };
  }

  function buildPrisma() {
    const mock = {
      debt: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
      },
      debtPayment: { updateMany: jest.fn() },
      ledgerMember: { findUnique: jest.fn() },
      // 回傳型別要明寫：callback 裡又用到 `mock` 自己，不標註的話 TypeScript 推不出來，
      // 整個 mock 會退化成 any，測試就失去型別保護。
      $transaction: jest.fn((cb: (tx: unknown) => unknown): unknown => cb(mock)),
    };
    return mock;
  }

  function buildTransactions() {
    return {
      createDebtTransaction: jest.fn().mockResolvedValue('tx-1'),
      updateDebtTransaction: jest.fn(),
      softDeleteDebtTransactions: jest.fn(),
    };
  }

  let prisma: ReturnType<typeof buildPrisma>;
  let transactions: ReturnType<typeof buildTransactions>;
  let service: DebtsService;

  beforeEach(() => {
    prisma = buildPrisma();
    transactions = buildTransactions();
    service = new DebtsService(
      prisma as unknown as PrismaService,
      transactions as unknown as TransactionsService,
    );
  });

  /** 讓 `assertLedgerWritable` 通過：呼叫者是 EDITOR，帳本未封存。 */
  function allowLedger() {
    prisma.ledgerMember.findUnique.mockResolvedValue({
      role: 'EDITOR',
      ledger: { archivedAt: null },
    });
  }

  describe('create', () => {
    it('records a principal transaction when `record` is given', async () => {
      allowLedger();
      prisma.debt.create.mockResolvedValue(debtRow({ transactionId: 'tx-1' }));

      const debt = await service.create(OWNER, {
        direction: 'LENT',
        counterpartyName: '小明',
        principal: 5000,
        date: '2026-09-01T00:00:00.000Z',
        record: { ledgerId: LEDGER_ID, accountId: 'account-1' },
      });

      // 借出 → LEND（錢從帳戶出去）。型別由方向決定，呼叫者不能指定。
      expect(transactions.createDebtTransaction).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          ledgerId: LEDGER_ID,
          creatorId: OWNER,
          type: 'LEND',
          amount: 5000,
          accountId: 'account-1',
        }),
      );
      expect(prisma.debt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ownerId: OWNER, transactionId: 'tx-1' }) as unknown,
        }),
      );
      expect(debt.transactionId).toBe('tx-1');
      expect(debt.outstanding).toBe(5000);
      expect(debt.status).toBe('OPEN');
    });

    it('creates an old debt with no transaction when `record` is omitted', async () => {
      prisma.debt.create.mockResolvedValue(debtRow());

      const debt = await service.create(OWNER, {
        direction: 'BORROWED',
        counterpartyName: '小華',
        principal: 300,
        date: '2026-09-01T00:00:00.000Z',
      });

      expect(transactions.createDebtTransaction).not.toHaveBeenCalled();
      expect(prisma.ledgerMember.findUnique).not.toHaveBeenCalled();
      expect(prisma.debt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ transactionId: null }) as unknown,
        }),
      );
      expect(debt.transactionId).toBeNull();
    });

    it('writes nothing when the ledger check fails', async () => {
      // 只有 VIEWER：`assertLedgerWritable` 回 403，交易與債務都不該被建立。
      prisma.ledgerMember.findUnique.mockResolvedValue({
        role: 'VIEWER',
        ledger: { archivedAt: null },
      });

      await expect(
        service.create(OWNER, {
          direction: 'LENT',
          counterpartyName: '小明',
          principal: 5000,
          date: '2026-09-01T00:00:00.000Z',
          record: { ledgerId: LEDGER_ID },
        }),
      ).rejects.toMatchObject({ status: 403, errorCode: 'FORBIDDEN' });

      expect(transactions.createDebtTransaction).not.toHaveBeenCalled();
      expect(prisma.debt.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    const open = debtRow({ id: 'open-1' });
    const settled = debtRow({ id: 'settled-1', payments: [paymentRow({ amount: 5000 })] });
    const forgiven = debtRow({
      id: 'forgiven-1',
      forgivenAt: new Date('2026-09-15T00:00:00.000Z'),
    });

    it('filters by the computed status', async () => {
      prisma.debt.findMany.mockResolvedValue([open, settled, forgiven]);

      const result = await service.list(OWNER, { status: 'SETTLED' });

      expect(result.items.map((debt) => debt.id)).toEqual(['settled-1']);
      expect(result.total).toBe(1);
    });

    it('orders by date then createdAt, newest first', async () => {
      await service.list(OWNER, {});
      expect(prisma.debt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        }),
      );
    });

    it('clamps the page size to 100 and defaults to 20', async () => {
      expect((await service.list(OWNER, { limit: 500 })).limit).toBe(100);
      expect((await service.list(OWNER, {})).limit).toBe(20);
      expect((await service.list(OWNER, {})).page).toBe(1);
    });

    it('paginates the filtered rows and reports the filtered total', async () => {
      prisma.debt.findMany.mockResolvedValue([open, settled, forgiven]);

      const result = await service.list(OWNER, { page: 2, limit: 2 });

      expect(result.items.map((debt) => debt.id)).toEqual(['forgiven-1']);
      expect(result.total).toBe(3);
      expect(result.page).toBe(2);
    });
  });

  describe('update', () => {
    it('refuses a principal below the total repaid and writes nothing', async () => {
      prisma.debt.findFirst.mockResolvedValue(
        debtRow({ transactionId: 'tx-1', payments: [paymentRow({ amount: 3000 })] }),
      );

      const error = await service.update(OWNER, DEBT_ID, { principal: 2999 }).then(
        () => undefined,
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).getStatus()).toBe(409);
      expect((error as AppException).errorCode).toBe('DEBT_OVERPAYMENT');
      expect(prisma.debt.update).not.toHaveBeenCalled();
      expect(transactions.updateDebtTransaction).not.toHaveBeenCalled();
    });

    // 決策 30：結清之後差額由本金算出，本金一改差額就默默跟著變，所以擋下。
    it('refuses to change the principal once a settling payment exists', async () => {
      prisma.debt.findFirst.mockResolvedValue(
        debtRow({
          transactionId: 'tx-1',
          principal: 93,
          payments: [paymentRow({ amount: 95, settles: true })],
        }),
      );

      await expect(service.update(OWNER, DEBT_ID, { principal: 100 })).rejects.toMatchObject({
        status: 409,
        errorCode: 'DEBT_NOT_OPEN',
      });
      expect(prisma.debt.update).not.toHaveBeenCalled();
      expect(transactions.updateDebtTransaction).not.toHaveBeenCalled();
    });

    it('still lets a settled-with-difference debt change its note', async () => {
      const row = debtRow({ principal: 93, payments: [paymentRow({ amount: 95, settles: true })] });
      prisma.debt.findFirst.mockResolvedValue(row);
      prisma.debt.update.mockResolvedValue(row);

      // 送出與原本相同的本金也不算「改本金」：Web 的編輯視窗會把整張表單送回來。
      await service.update(OWNER, DEBT_ID, { note: '算了', principal: 93 });

      expect(prisma.debt.update).toHaveBeenCalled();
    });

    it('moves the principal transaction when the principal or the date changes', async () => {
      prisma.debt.findFirst.mockResolvedValue(debtRow({ transactionId: 'tx-1' }));
      prisma.debt.update.mockResolvedValue(debtRow({ transactionId: 'tx-1', principal: 4000 }));

      const debt = await service.update(OWNER, DEBT_ID, {
        principal: 4000,
        date: '2026-09-05T00:00:00.000Z',
      });

      expect(transactions.updateDebtTransaction).toHaveBeenCalledWith(prisma, 'tx-1', {
        amount: 4000,
        date: new Date('2026-09-05T00:00:00.000Z'),
      });
      expect(debt.principal).toBe(4000);
      expect(debt.outstanding).toBe(4000);
    });

    it('leaves the transaction alone when only the note changes, and null clears it', async () => {
      prisma.debt.findFirst.mockResolvedValue(debtRow({ transactionId: 'tx-1', note: '舊備註' }));
      prisma.debt.update.mockResolvedValue(debtRow({ transactionId: 'tx-1' }));

      const debt = await service.update(OWNER, DEBT_ID, { note: null });

      expect(prisma.debt.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { note: null } }),
      );
      expect(transactions.updateDebtTransaction).not.toHaveBeenCalled();
      expect(debt.note).toBeNull();
    });

    it('skips the transaction sync on an old debt that has none', async () => {
      prisma.debt.findFirst.mockResolvedValue(debtRow({ transactionId: null }));
      prisma.debt.update.mockResolvedValue(debtRow({ principal: 4000 }));

      await service.update(OWNER, DEBT_ID, { principal: 4000 });

      expect(transactions.updateDebtTransaction).not.toHaveBeenCalled();
    });

    it('can edit a forgiven debt (the per-status table is about repayments)', async () => {
      prisma.debt.findFirst.mockResolvedValue(
        debtRow({ forgivenAt: new Date('2026-09-15T00:00:00.000Z') }),
      );
      prisma.debt.update.mockResolvedValue(
        debtRow({ forgivenAt: new Date('2026-09-15T00:00:00.000Z'), counterpartyName: '小華' }),
      );

      const debt = await service.update(OWNER, DEBT_ID, { counterpartyName: '小華' });

      expect(debt.counterpartyName).toBe('小華');
      expect(debt.status).toBe('FORGIVEN');
    });
  });

  describe('remove', () => {
    it('soft-deletes the debt, its payments and every related transaction', async () => {
      prisma.debt.findFirst.mockResolvedValue(
        debtRow({
          transactionId: 'tx-principal',
          payments: [
            paymentRow({ id: 'payment-1', transactionId: 'tx-payment-1' }),
            // 沒有交易的還款：不能讓 null 混進交易 id 清單。
            paymentRow({ id: 'payment-2', transactionId: null }),
            // 早就刪掉的還款：它的交易也早就刪了，不重設 deletedAt。
            paymentRow({
              id: 'payment-3',
              transactionId: 'tx-payment-3',
              deletedAt: new Date('2026-09-11T00:00:00.000Z'),
            }),
          ],
        }),
      );

      await service.remove(OWNER, DEBT_ID);

      expect(prisma.debt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: DEBT_ID },
          data: { deletedAt: expect.any(Date) as unknown },
        }),
      );
      expect(prisma.debtPayment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { debtId: DEBT_ID, deletedAt: null } }),
      );
      expect(transactions.softDeleteDebtTransactions).toHaveBeenCalledWith(
        prisma,
        ['tx-principal', 'tx-payment-1'],
        expect.any(Date),
      );
    });

    it('passes no transaction ids for an old debt without any', async () => {
      prisma.debt.findFirst.mockResolvedValue(debtRow({ transactionId: null }));

      await service.remove(OWNER, DEBT_ID);

      expect(transactions.softDeleteDebtTransactions).toHaveBeenCalledWith(
        prisma,
        [],
        expect.any(Date),
      );
    });
  });

  describe('summary', () => {
    it('merges the same name, subtracts what I borrowed and skips non-OPEN debts', async () => {
      prisma.debt.findMany.mockResolvedValue([
        debtRow({ id: 'd1', direction: 'LENT', counterpartyName: '小明', principal: 1000 }),
        debtRow({ id: 'd2', direction: 'BORROWED', counterpartyName: '小明', principal: 300 }),
        debtRow({ id: 'd3', direction: 'LENT', counterpartyName: '小華', principal: 500 }),
        // 已結清（還款等於本金）與已免除的都不計入。
        debtRow({
          id: 'd4',
          counterpartyName: '阿強',
          principal: 100,
          payments: [paymentRow({ amount: 100 })],
        }),
        debtRow({
          id: 'd5',
          counterpartyName: '阿美',
          principal: 100,
          forgivenAt: new Date('2026-09-15T00:00:00.000Z'),
        }),
      ]);

      const result = await service.summary(OWNER);

      expect(result.items).toEqual([
        { counterpartyName: '小明', counterpartyUserId: null, net: 700 },
        { counterpartyName: '小華', counterpartyUserId: null, net: 500 },
      ]);
    });

    it('omits a person whose lent and borrowed amounts cancel out', async () => {
      prisma.debt.findMany.mockResolvedValue([
        debtRow({ id: 'd1', direction: 'LENT', counterpartyName: '小明', principal: 400 }),
        debtRow({ id: 'd2', direction: 'BORROWED', counterpartyName: '小明', principal: 400 }),
      ]);

      expect((await service.summary(OWNER)).items).toEqual([]);
    });

    it('counts only the outstanding part of a partly repaid debt', async () => {
      prisma.debt.findMany.mockResolvedValue([
        debtRow({
          id: 'd1',
          counterpartyName: '小明',
          principal: 1000,
          payments: [paymentRow({ amount: 400 })],
        }),
      ]);

      expect((await service.summary(OWNER)).items).toEqual([
        { counterpartyName: '小明', counterpartyUserId: null, net: 600 },
      ]);
    });

    it('sorts the items by name ascending', async () => {
      prisma.debt.findMany.mockResolvedValue([
        debtRow({ id: 'd1', counterpartyName: 'Zoe', principal: 100 }),
        debtRow({ id: 'd2', counterpartyName: 'Amy', principal: 100 }),
      ]);

      expect((await service.summary(OWNER)).items.map((item) => item.counterpartyName)).toEqual([
        'Amy',
        'Zoe',
      ]);
    });
  });
});
