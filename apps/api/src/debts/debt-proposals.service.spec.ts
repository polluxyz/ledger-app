import type { PrismaService } from '../prisma/prisma.service';
import type { TransactionsService } from '../transactions/transactions.service';
import { DebtProposalsService } from './debt-proposals.service';

/**
 * 3j 決策 183：接受修改與撤銷必須檢查接受者那筆交易的帳本，不能因為提議來自對方就繞過唯讀。
 * Prisma mock 驗證拒絕發生在紀錄、交易與還款分支寫入之前；提議狀態的資料庫回滾由 e2e 驗證。
 * 沒有交易的舊紀錄、已不存在的目標與拒絕提議都不動帳本，不要求帳本寫入權。
 */
describe('DebtProposalsService ledger write access', () => {
  const USER = 'recipient';
  const LEDGER = 'target-ledger';
  const DATE = new Date('2026-10-17T12:00:00.000Z');

  function proposal(type: 'AMEND' | 'DELETE') {
    return {
      id: 'proposal',
      fromUserId: 'sender',
      toUserId: USER,
      type,
      status: 'PENDING',
      entryKind: 'COLLECT',
      amount: 150,
      date: DATE,
      title: null,
      settle: false,
      sourceEntryId: 'source',
      targetEntryId: 'target',
      targetEntry: { delta: 120, date: DATE, deletedAt: null },
      fromUser: { id: 'sender', name: '發起者' },
      toUser: { id: USER, name: '接受者' },
      createdAt: DATE,
      respondedAt: null,
    };
  }

  function build(type: 'AMEND' | 'DELETE') {
    const target = {
      id: 'target',
      counterpartyId: 'own-counterparty',
      kind: 'REPAY',
      delta: 120,
      date: DATE,
      transactionId: 'target-transaction',
      transaction: { ledgerId: LEDGER },
    };
    const prisma = {
      debtProposal: {
        findUnique: jest.fn().mockResolvedValue(proposal(type)),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      counterpartyLink: {
        findUnique: jest.fn().mockResolvedValue({
          userLowId: USER,
          userHighId: 'sender',
          counterpartyLowId: 'own-counterparty',
          counterpartyHighId: 'their-counterparty',
        }),
      },
      counterparty: { findUnique: jest.fn().mockResolvedValue({ name: '對方' }) },
      ledgerMember: {
        findUnique: jest.fn().mockResolvedValue({ role: 'EDITOR', ledger: { archivedAt: null } }),
      },
      debtEntry: {
        findFirst: jest.fn().mockResolvedValue(target),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      transaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((callback: (tx: unknown) => unknown): unknown => callback(prisma)),
    };
    const transactions = {
      updateDebtTransaction: jest.fn(),
      softDeleteDebtTransactions: jest.fn(),
    };
    const service = new DebtProposalsService(
      prisma as unknown as PrismaService,
      transactions as unknown as TransactionsService,
    );
    return { target, prisma, transactions, service };
  }

  describe.each(['AMEND', 'DELETE'] as const)('%s', (type) => {
    it.each([
      [null, 404, 'NOT_FOUND'],
      [{ role: 'VIEWER', ledger: { archivedAt: null } }, 403, 'FORBIDDEN'],
      [{ role: 'OWNER', ledger: { archivedAt: DATE } }, 409, 'LEDGER_ARCHIVED'],
    ])(
      'rejects accepting with membership %j before changing target or branches',
      async (membership, status, errorCode) => {
        const { prisma, transactions, service } = build(type);
        prisma.ledgerMember.findUnique.mockResolvedValue(membership);
        await expect(service.accept(USER, 'proposal', undefined)).rejects.toMatchObject({
          status,
          errorCode,
        });
        expect(prisma.ledgerMember.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { ledgerId_userId: { ledgerId: LEDGER, userId: USER } },
          }),
        );
        expect(prisma.debtEntry.update).not.toHaveBeenCalled();
        expect(prisma.debtEntry.updateMany).not.toHaveBeenCalled();
        expect(prisma.transaction.update).not.toHaveBeenCalled();
        expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
        expect(transactions.updateDebtTransaction).not.toHaveBeenCalled();
        expect(transactions.softDeleteDebtTransactions).not.toHaveBeenCalled();
      },
    );

    it('accepts when the target ledger is writable', async () => {
      const { prisma, service } = build(type);
      await expect(service.accept(USER, 'proposal', undefined)).resolves.toMatchObject({
        status: 'ACCEPTED',
      });
      expect(prisma.ledgerMember.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.debtEntry.update).toHaveBeenCalled();
      expect(prisma.ledgerMember.findUnique.mock.invocationCallOrder[0]!).toBeLessThan(
        prisma.debtEntry.update.mock.invocationCallOrder[0]!,
      );
    });

    it('accepts a legacy target without checking a ledger', async () => {
      const { target, prisma, service, transactions } = build(type);
      prisma.debtEntry.findFirst.mockResolvedValue({
        ...target,
        transactionId: null,
        transaction: null,
      });
      prisma.ledgerMember.findUnique.mockResolvedValue(null);
      await expect(service.accept(USER, 'proposal', undefined)).resolves.toMatchObject({
        status: 'ACCEPTED',
      });
      expect(prisma.ledgerMember.findUnique).not.toHaveBeenCalled();
      expect(transactions.updateDebtTransaction).not.toHaveBeenCalled();
      expect(transactions.softDeleteDebtTransactions).not.toHaveBeenCalled();
    });

    it('accepts an already absent target without checking a ledger', async () => {
      const { prisma, service } = build(type);
      prisma.debtEntry.findFirst.mockResolvedValue(null);
      await expect(service.accept(USER, 'proposal', undefined)).resolves.toMatchObject({
        status: 'ACCEPTED',
      });
      expect(prisma.ledgerMember.findUnique).not.toHaveBeenCalled();
      expect(prisma.debtEntry.update).not.toHaveBeenCalled();
    });

    it('declines without loading the target or checking its ledger', async () => {
      const { prisma, service } = build(type);
      prisma.ledgerMember.findUnique.mockResolvedValue(null);
      await expect(service.decline(USER, 'proposal')).resolves.toMatchObject({
        status: 'DECLINED',
      });
      expect(prisma.ledgerMember.findUnique).not.toHaveBeenCalled();
      expect(prisma.debtEntry.findFirst).not.toHaveBeenCalled();
      expect(prisma.debtEntry.update).not.toHaveBeenCalled();
    });
  });
});
