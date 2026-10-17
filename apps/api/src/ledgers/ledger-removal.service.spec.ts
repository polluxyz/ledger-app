import { AccountsService } from '../accounts/accounts.service';
import { DebtEntriesService } from '../debts/debt-entries.service';
import { LedgerPeopleService } from '../ledger-people/ledger-people.service';
import { PrismaService } from '../prisma/prisma.service';
import { SplitsService } from '../splits/splits.service';
import { LedgersService } from './ledgers.service';

/** 3j：共用資格判斷、餘額影響、關聯處理及原子撤銷。 */
describe('Ledger removal', () => {
  const ledger = {
    id: 'ledger',
    name: 'Trip',
    kind: 'PERSONAL',
    archivedAt: null,
    members: [],
    createdAt: new Date(),
    currency: 'TWD',
  };
  const entry = (id: string, delta = 500) => ({
    id,
    delta,
    kind: 'LEND',
    counterpartyId: 'person',
    counterparty: { ownerId: 'me' },
    splitId: null,
    settlesEntryId: null,
    deletedAt: null,
  });
  const setup = () => {
    const tx = {
      ledgerMember: { findUnique: jest.fn().mockResolvedValue({ role: 'OWNER' }) },
      ledger: {
        findUnique: jest.fn().mockResolvedValue(ledger),
        delete: jest.fn(),
        update: jest.fn(),
      },
      transaction: {
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
      debtEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      split: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
      account: { findMany: jest.fn().mockResolvedValue([]) },
      counterparty: { findMany: jest.fn().mockResolvedValue([]) },
      counterpartyLink: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    };
    const debts = { removeInTransaction: jest.fn() };
    const splits = { removeInTransaction: jest.fn() };
    const service = new LedgersService(
      prisma as unknown as PrismaService,
      {} as LedgerPeopleService,
      new AccountsService(prisma as unknown as PrismaService),
      debts as unknown as DebtEntriesService,
      splits as unknown as SplitsService,
    );
    return { tx, prisma, debts, splits, service };
  };

  it('checks confirmation before transactions or debt checks', async () => {
    const { service, tx } = setup();
    tx.transaction.count.mockResolvedValue(1);
    await expect(service.remove('ledger', 'me', 'wrong', true)).rejects.toMatchObject({
      status: 400,
    });
    expect(tx.transaction.count).not.toHaveBeenCalled();
  });

  it('uses the same eligibility function in preview and delete; others precede debts', async () => {
    const { service, tx } = setup();
    tx.transaction.count.mockResolvedValue(1);
    const plan = jest.spyOn(
      service as unknown as { removalPlan: (...args: unknown[]) => Promise<unknown> },
      'removalPlan',
    );
    expect(await service.removalPreview('ledger', 'me')).toEqual({
      accounts: [],
      counterparties: [],
      withdrawsDebts: false,
      delete: { allowed: false, blockedBy: 'HAS_OTHERS_TRANSACTIONS' },
    });
    await expect(service.remove('ledger', 'me', 'Trip', true)).rejects.toMatchObject({
      errorCode: 'LEDGER_HAS_OTHERS_TRANSACTIONS',
    });
    expect(plan).toHaveBeenCalledTimes(2);
    expect(tx.debtEntry.findMany).not.toHaveBeenCalled();
    expect(tx.transaction.count).toHaveBeenCalledWith({
      where: {
        ledgerId: 'ledger',
        OR: [
          { creatorId: { not: 'me' } },
          { account: { userId: { not: 'me' } } },
          { toAccount: { userId: { not: 'me' } } },
        ],
      },
    });
  });

  it('blocks archived preview without reading balances', async () => {
    const { service, tx } = setup();
    tx.ledger.findUnique.mockResolvedValue({ ...ledger, archivedAt: new Date() });
    expect((await service.removalPreview('ledger', 'me')).delete.blockedBy).toBe('LEDGER_ARCHIVED');
    expect(tx.account.findMany).not.toHaveBeenCalled();
  });

  it.each(['debt', 'split'])('blocks a shared ledger with a historical %s', async (kind) => {
    const { service, tx } = setup();
    tx.ledger.findUnique.mockResolvedValue({ ...ledger, kind: 'SHARED' });
    if (kind === 'debt')
      tx.debtEntry.findMany.mockResolvedValue([{ ...entry('old'), deletedAt: new Date() }]);
    else tx.split.findMany.mockResolvedValue([{ id: 'old', deletedAt: new Date(), ownerId: 'me' }]);
    expect((await service.removalPreview('ledger', 'me')).delete.blockedBy).toBe(
      'SHARED_HAS_DEBTS',
    );
    await expect(service.remove('ledger', 'me', 'Trip', true)).rejects.toMatchObject({
      errorCode: 'LEDGER_HAS_DEBT_TRANSACTIONS',
    });
  });

  it('protects another owner’s active debt before requiring consent', async () => {
    const { service, tx, debts } = setup();
    tx.debtEntry.findMany.mockResolvedValue([
      { ...entry('other'), counterparty: { ownerId: 'other' } },
    ]);
    await expect(service.remove('ledger', 'me', 'Trip')).rejects.toMatchObject({
      errorCode: 'LEDGER_HAS_DEBT_TRANSACTIONS',
    });
    expect((await service.removalPreview('ledger', 'me')).delete.blockedBy).toBe(
      'SHARED_HAS_DEBTS',
    );
    expect(debts.removeInTransaction).not.toHaveBeenCalled();
  });

  it.each(['debt', 'split'])(
    'requires consent for my active %s and makes no changes',
    async (kind) => {
      const { service, tx, debts, splits } = setup();
      if (kind === 'debt') tx.debtEntry.findMany.mockResolvedValue([entry('active')]);
      else tx.split.findMany.mockResolvedValue([{ id: 'active', deletedAt: null, ownerId: 'me' }]);
      await expect(service.remove('ledger', 'me', 'Trip')).rejects.toMatchObject({
        errorCode: 'DEBT_WITHDRAWAL_REQUIRED',
      });
      expect(tx.ledger.delete).not.toHaveBeenCalled();
      expect(debts.removeInTransaction).not.toHaveBeenCalled();
      expect(splits.removeInTransaction).not.toHaveBeenCalled();
    },
  );

  it('detaches historical entries before deleting splits and the ledger without withdrawing them again', async () => {
    const { service, tx, debts } = setup();
    tx.debtEntry.findMany.mockResolvedValue([{ ...entry('old'), deletedAt: new Date() }]);
    await service.remove('ledger', 'me', 'Trip');
    expect(debts.removeInTransaction).not.toHaveBeenCalled();
    expect(tx.debtEntry.updateMany).toHaveBeenCalledWith({
      where: { OR: [{ transaction: { ledgerId: 'ledger' } }, { split: { ledgerId: 'ledger' } }] },
      data: { transactionId: null, splitId: null },
    });
    expect(tx.debtEntry.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.split.deleteMany.mock.invocationCallOrder[0]!,
    );
    expect(tx.transaction.updateMany).toHaveBeenCalledWith({
      where: { ledgerId: 'ledger', splitId: { not: null } },
      data: { splitId: null },
    });
    expect(tx.transaction.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.split.deleteMany.mock.invocationCallOrder[0]!,
    );
    expect(tx.split.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.ledger.delete.mock.invocationCallOrder[0]!,
    );
  });

  it('passes the same transaction to each withdrawal and stops before detaching if the second fails', async () => {
    const { service, tx, debts } = setup();
    tx.debtEntry.findMany.mockResolvedValue([entry('first'), entry('second')]);
    debts.removeInTransaction
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('second failed'));
    await expect(service.remove('ledger', 'me', 'Trip', true)).rejects.toThrow('second failed');
    expect(debts.removeInTransaction.mock.calls).toEqual([
      [tx, 'me', 'first'],
      [tx, 'me', 'second'],
    ]);
    expect(tx.debtEntry.updateMany).not.toHaveBeenCalled();
    expect(tx.ledger.delete).not.toHaveBeenCalled();
  });

  it('withdraws split entries through the split and bound settlements through the repayment', async () => {
    const { service, tx, debts, splits } = setup();
    tx.debtEntry.findMany.mockResolvedValue([
      entry('repayment'),
      { ...entry('settlement'), settlesEntryId: 'repayment' },
      { ...entry('split-entry'), splitId: 'split' },
    ]);
    tx.split.findMany.mockResolvedValue([{ id: 'split', deletedAt: null, ownerId: 'me' }]);
    await service.remove('ledger', 'me', 'Trip', true);
    expect(splits.removeInTransaction).toHaveBeenCalledWith(tx, 'me', 'split');
    expect(debts.removeInTransaction.mock.calls).toEqual([[tx, 'me', 'repayment']]);
  });

  it('reuses account balance directions for transfers, loan movements and effective transactions', async () => {
    const { service, tx } = setup();
    const account = (id: string) => ({
      id,
      userId: 'me',
      name: id,
      initialBalance: 1000,
      isTemporary: false,
      createdAt: new Date(),
    });
    tx.account.findMany.mockResolvedValue([account('cash'), account('bank'), account('unchanged')]);
    tx.transaction.groupBy
      .mockResolvedValueOnce([
        { accountId: 'cash', type: 'LEND', _sum: { amount: 500 } },
        { accountId: 'cash', type: 'TRANSFER', _sum: { amount: 200 } },
        { accountId: 'bank', type: 'BORROW', _sum: { amount: 100 } },
      ])
      .mockResolvedValueOnce([{ toAccountId: 'bank', _sum: { amount: 200 } }])
      .mockResolvedValueOnce([
        { accountId: 'cash', type: 'LEND', _sum: { amount: 500 } },
        { accountId: 'cash', type: 'TRANSFER', _sum: { amount: 200 } },
      ])
      .mockResolvedValueOnce([{ toAccountId: 'bank', _sum: { amount: 200 } }]);
    tx.debtEntry.findMany.mockResolvedValue([
      entry('lend'),
      { ...entry('settlement', -100), settlesEntryId: 'repayment' },
      { ...entry('split', 50), splitId: 'split' },
    ]);
    tx.counterparty.findMany.mockResolvedValue([{ id: 'person', name: 'Bob' }]);
    tx.debtEntry.groupBy.mockResolvedValue([{ counterpartyId: 'person', _sum: { delta: 600 } }]);
    const preview = await service.removalPreview('ledger', 'me');
    expect(preview.accounts).toEqual([
      { accountId: 'cash', name: 'cash', balance: 300, balanceAfter: 1000 },
      { accountId: 'bank', name: 'bank', balance: 1300, balanceAfter: 1100 },
    ]);
    expect(preview.counterparties).toEqual([
      {
        counterpartyId: 'person',
        displayName: 'Bob',
        linked: false,
        balance: 600,
        balanceAfter: 150,
      },
    ]);
    expect(preview.withdrawsDebts).toBe(true);
    const [scopedQuery] = tx.transaction.groupBy.mock.calls[2] as [{ where: unknown }];
    expect(scopedQuery.where).toMatchObject({ ledgerId: 'ledger', deletedAt: null });
    expect(tx.counterparty.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: 'me', id: { in: ['person'] } } }),
    );
  });

  it.each(['preview', 'unarchive'])(
    'denies nonmember %s at the service boundary',
    async (action) => {
      const { service, tx } = setup();
      tx.ledgerMember.findUnique.mockResolvedValue(null);
      await expect(
        action === 'preview'
          ? service.removalPreview('ledger', 'other')
          : service.unarchive('ledger', 'other'),
      ).rejects.toMatchObject({ status: 404 });
      expect(tx.ledger.findUnique).not.toHaveBeenCalled();
    },
  );

  it('unarchives only an archived ledger and preserves its detail shape', async () => {
    const { service, tx } = setup();
    await expect(service.unarchive('ledger', 'me')).rejects.toMatchObject({
      errorCode: 'LEDGER_NOT_ARCHIVED',
    });
    tx.ledger.findUnique.mockResolvedValueOnce({ ...ledger, archivedAt: new Date() });
    expect(await service.unarchive('ledger', 'me')).toMatchObject({
      id: 'ledger',
      archivedAt: null,
      members: [],
    });
    expect(tx.ledger.update).toHaveBeenCalledWith({
      where: { id: 'ledger' },
      data: { archivedAt: null },
    });
  });
});
