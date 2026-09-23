import { AppException } from '../common/exceptions/app.exception';
import type { PrismaService } from '../prisma/prisma.service';
import type { TransactionsService } from '../transactions/transactions.service';
import { DebtPaymentsService } from './debt-payments.service';
import { DebtsService } from './debts.service';

/**
 * 債務的資料隔離（spec §3.5）：債務只屬於擁有者。別人的、已刪除的、不存在的債務，對每一個
 * 會讀寫單筆債務的方法都是同一個 404，而且**什麼都沒寫**。清單與淨額只查得到自己的。
 *
 * ⚠️ 這個檔案由協調者先寫（SEC-10：授權測試先於實作），是 W1、W2 的驗收門檻。
 * **worker 不准修改這個檔案**；覺得它錯了就回報。自己的其他單元測試請另開檔案。
 *
 * 策略：Prisma 全程 mock。約定只有兩件事——
 * 1. 讀單筆債務一律經過 `debt-state.ts` 的 `loadOwnedDebt`（它用 `prisma.debt.findFirst`
 *    或 tx 的 `debt.findFirst` 查，條件含 `ownerId` 與 `deletedAt: null`）。這裡讓 findFirst
 *    回 null，模擬「不是我的」。
 * 2. 清單與淨額查詢的 `where` 必須含 `ownerId: <呼叫者>` 與 `deletedAt: null`。
 */
describe('Debt ownership (spec §3.5)', () => {
  const OWNER = '11111111-1111-4111-8111-111111111111';
  const DEBT_ID = '44444444-4444-4444-8444-444444444444';
  const PAYMENT_ID = '55555555-5555-4555-8555-555555555555';

  function buildPrisma() {
    const mock = {
      debt: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      debtPayment: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      transaction: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      ledgerMember: { findUnique: jest.fn() },
      $transaction: jest.fn((arg: unknown): unknown =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => unknown)(mock)
          : Promise.all(arg as []),
      ),
    };
    return mock;
  }

  function buildTransactions() {
    return {
      createDebtTransaction: jest.fn(),
      updateDebtTransaction: jest.fn(),
      softDeleteDebtTransactions: jest.fn(),
    };
  }

  let prisma: ReturnType<typeof buildPrisma>;
  let transactions: ReturnType<typeof buildTransactions>;
  let debts: DebtsService;
  let payments: DebtPaymentsService;

  beforeEach(() => {
    prisma = buildPrisma();
    transactions = buildTransactions();
    debts = new DebtsService(
      prisma as unknown as PrismaService,
      transactions as unknown as TransactionsService,
    );
    payments = new DebtPaymentsService(
      prisma as unknown as PrismaService,
      transactions as unknown as TransactionsService,
    );
  });

  function expectNoWrites() {
    for (const method of [prisma.debt.create, prisma.debt.update, prisma.debt.updateMany]) {
      expect(method).not.toHaveBeenCalled();
    }
    for (const method of [
      prisma.debtPayment.create,
      prisma.debtPayment.update,
      prisma.debtPayment.updateMany,
    ]) {
      expect(method).not.toHaveBeenCalled();
    }
    for (const method of [
      prisma.transaction.create,
      prisma.transaction.update,
      prisma.transaction.updateMany,
    ]) {
      expect(method).not.toHaveBeenCalled();
    }
    for (const method of Object.values(transactions)) {
      expect(method).not.toHaveBeenCalled();
    }
  }

  async function expectNotFound(promise: Promise<unknown>) {
    const error = await promise.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).getStatus()).toBe(404);
    expect((error as AppException).errorCode).toBe('NOT_FOUND');
  }

  const singleDebtCalls: Array<[string, () => Promise<unknown>]> = [
    ['DebtsService.get', () => debts.get(OWNER, DEBT_ID)],
    ['DebtsService.update', () => debts.update(OWNER, DEBT_ID, { principal: 100 })],
    ['DebtsService.remove', () => debts.remove(OWNER, DEBT_ID)],
    [
      'DebtPaymentsService.create',
      () => payments.create(OWNER, DEBT_ID, { amount: 100, date: '2026-09-24T00:00:00.000Z' }),
    ],
    ['DebtPaymentsService.remove', () => payments.remove(OWNER, DEBT_ID, PAYMENT_ID)],
    ['DebtPaymentsService.forgive', () => payments.forgive(OWNER, DEBT_ID)],
  ];

  it.each(singleDebtCalls)(
    '%s on a debt that is not mine → 404, nothing written',
    async (_label, call) => {
      await expectNotFound(call());
      expectNoWrites();
    },
  );

  it.each(singleDebtCalls)(
    '%s looks the debt up by owner and excludes deleted debts',
    async (_label, call) => {
      await call().catch(() => undefined);
      expect(prisma.debt.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: DEBT_ID,
            ownerId: OWNER,
            deletedAt: null,
          }) as unknown,
        }),
      );
    },
  );

  it('list only queries my own, undeleted debts', async () => {
    await debts.list(OWNER, {});
    expect(prisma.debt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: OWNER, deletedAt: null }) as unknown,
      }),
    );
  });

  it('summary only queries my own, undeleted debts', async () => {
    await debts.summary(OWNER);
    expect(prisma.debt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: OWNER, deletedAt: null }) as unknown,
      }),
    );
  });
});
