import type { CreateSplitRequest, Split } from '@ledger/shared';
import type { Prisma } from '../generated/prisma/client';
import type { IdempotencyService } from '../idempotency/idempotency.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TransactionsService } from '../transactions/transactions.service';
import { SplitsService } from './splits.service';

// 用合成資料控制請求的交錯順序，並記錄寫入與查詢次數。
describe('SplitsService.create', () => {
  const input: CreateSplitRequest = {
    ledgerId: 'ledger',
    categoryId: 'meals',
    type: 'EXPENSE',
    total: 301,
    date: '2026-11-11T00:00:00.000Z',
    payer: null,
    accountId: 'cash',
    method: 'AMOUNT',
    participants: [
      { counterpartyId: null, amount: 151 },
      { counterpartyId: 'guest', amount: 150 },
    ],
    fromTransactionId: 'original',
  };

  const setup = () => {
    const splitRow = {
      id: 'split',
      ...input,
      date: new Date(input.date),
      createdAt: new Date(input.date),
      updatedAt: new Date(input.date),
      deletedAt: null,
      category: { id: 'meals', name: '餐飲' },
      participants: [],
      entries: [],
    };
    const createDebtTransaction = jest.fn().mockResolvedValue('guest-transaction');
    const createSplitShareTransaction = jest.fn().mockResolvedValue('own-transaction');
    const store = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      ledgerMember: {
        findUnique: jest.fn().mockResolvedValue({ role: 'EDITOR', ledger: { archivedAt: null } }),
      },
      counterparty: { count: jest.fn().mockResolvedValue(1) },
      counterpartyLink: { findFirst: jest.fn().mockResolvedValue(null) },
      category: { findFirst: jest.fn().mockResolvedValue({ type: 'EXPENSE' }) },
      account: { findUnique: jest.fn().mockResolvedValue({ userId: 'owner', isTemporary: false }) },
      transaction: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'original', ledgerId: 'ledger', debtEntry: null }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      split: {
        create: jest.fn().mockResolvedValue({ id: 'split' }),
        findFirst: jest.fn().mockResolvedValue(splitRow),
      },
      splitParticipant: { createMany: jest.fn().mockResolvedValue({}) },
      debtEntry: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'entry', kind: 'PAID_FOR_THEM', counterpartyId: 'guest' }),
      },
    };
    const run = jest.fn<
      Promise<{ created: true; resultId: string } | { created: false; response: Split }>,
      [unknown, (tx: Prisma.TransactionClient) => Promise<string>, (id: string) => Promise<Split>]
    >(async (_claim, write) => ({
      created: true,
      resultId: await write(store as unknown as Prisma.TransactionClient),
    }));
    const service = new SplitsService(
      store as unknown as PrismaService,
      { run } as unknown as IdempotencyService,
      { createDebtTransaction, createSplitShareTransaction } as unknown as TransactionsService,
    );
    return { store, run, service, createDebtTransaction, createSplitShareTransaction };
  };

  it('converts one original only once when requests with distinct keys both see it active', async () => {
    const { store, service, createDebtTransaction, createSplitShareTransaction } = setup();
    store.transaction.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const results = await Promise.allSettled([
      service.create('owner', input, 'key-one'),
      service.create(
        'owner',
        {
          ...input,
          participants: [input.participants[0]!, { counterpartyId: 'other-guest', amount: 150 }],
        },
        'key-two',
      ),
    ]);
    expect(store.transaction.findFirst).toHaveBeenCalledTimes(2);
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: { total: 301 } });
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: { status: 409, errorCode: 'TRANSACTION_NOT_CONVERTIBLE' },
    });
    expect(store.transaction.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'original',
        ledgerId: 'ledger',
        creatorId: 'owner',
        deletedAt: null,
        splitId: null,
        type: 'EXPENSE',
      },
      data: { deletedAt: expect.any(Date) as unknown },
    });
    expect(store.split.create).toHaveBeenCalledTimes(1);
    expect(store.debtEntry.create).toHaveBeenCalledTimes(1);
    expect(createDebtTransaction).toHaveBeenCalledWith(
      store,
      expect.objectContaining({ amount: 150 }),
    );
    expect(createSplitShareTransaction).toHaveBeenCalledWith(
      store,
      expect.objectContaining({ amount: 151 }),
    );
  });

  it('locks each counterparty once before writing the split', async () => {
    const { store, service } = setup();
    await service.create('owner', input, 'key');
    expect(store.$queryRaw).toHaveBeenCalledTimes(1);
    expect(store.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      store.split.create.mock.invocationCallOrder[0]!,
    );
  });

  it('reads the replay view once after checking ownership and current ledger access', async () => {
    const { store, service, run } = setup();
    run.mockImplementation(async (_claim, _write, replay) => ({
      created: false,
      response: await replay('split'),
    }));
    await expect(service.create('owner', input, 'key')).resolves.toMatchObject({
      id: 'split',
      total: 301,
    });
    expect(store.split.findFirst).toHaveBeenCalledTimes(2);
    expect(store.ledgerMember.findUnique).toHaveBeenCalledTimes(1);
    expect(store.split.create).not.toHaveBeenCalled();
  });
});
