import type { PrismaService } from '../prisma/prisma.service';
import type { LedgerDebtsService } from '../ledger-groups/ledger-debts.service';
import { CounterpartiesService } from './counterparties.service';

/** 合併先驗兩邊的擁有權，再判斷連動狀態；錯誤不能透露別人的對象。 */
describe('CounterpartiesService.merge', () => {
  const ownerId = 'alice';
  const targetId = 'target';
  const sourceId = 'source';

  function setup() {
    const rows = new Map([
      [targetId, { id: targetId, ownerId, name: null, askMerge: true }],
      [sourceId, { id: sourceId, ownerId, name: '舊人', askMerge: false }],
    ]);
    const tx = {
      counterparty: {
        findFirst: jest.fn(({ where }: { where: { id: string; ownerId: string } }) =>
          Promise.resolve(
            rows.get(where.id)?.ownerId === where.ownerId ? rows.get(where.id) : null,
          ),
        ),
        update: jest.fn().mockResolvedValue({
          id: targetId,
          ownerId,
          name: '舊人',
          askMerge: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        delete: jest.fn(),
      },
      counterpartyLink: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(
          ({
            where,
          }: {
            where: { OR: Array<{ counterpartyLowId?: string; counterpartyHighId?: string }> };
          }) =>
            Promise.resolve(
              where.OR.some(
                (part) =>
                  part.counterpartyLowId === targetId || part.counterpartyHighId === targetId,
              )
                ? { id: 'link' }
                : null,
            ),
        ),
      },
      debtEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { delta: 0 } }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      debtProposal: { updateMany: jest.fn() },
      splitParticipant: { findMany: jest.fn().mockResolvedValue([]) },
      split: { updateMany: jest.fn() },
      ledgerPersonPointer: { updateMany: jest.fn() },
      $queryRaw: jest.fn(),
    };
    const prisma = { ...tx, $transaction: jest.fn((cb: (client: typeof tx) => unknown) => cb(tx)) };
    const ledgerDebts = { partsByCounterparty: jest.fn().mockResolvedValue(new Map()) };
    return {
      rows,
      tx,
      service: new CounterpartiesService(
        prisma as unknown as PrismaService,
        ledgerDebts as unknown as LedgerDebtsService,
      ),
    };
  }

  it('returns 404 for a foreign source before checking merge eligibility', async () => {
    const { rows, tx, service } = setup();
    rows.get(sourceId)!.ownerId = 'other';
    await expect(service.merge(ownerId, targetId, sourceId)).rejects.toMatchObject({ status: 404 });
    expect(tx.debtEntry.updateMany).not.toHaveBeenCalled();
  });

  it('rejects the same object, an unlinked target, or a linked source', async () => {
    const same = setup();
    await expect(same.service.merge(ownerId, targetId, targetId)).rejects.toMatchObject({
      errorCode: 'MERGE_NOT_ALLOWED',
    });
    const unlinked = setup();
    unlinked.tx.counterpartyLink.findFirst.mockResolvedValue(null);
    await expect(unlinked.service.merge(ownerId, targetId, sourceId)).rejects.toMatchObject({
      errorCode: 'MERGE_NOT_ALLOWED',
    });
    const linked = setup();
    linked.tx.counterpartyLink.findFirst.mockResolvedValue({ id: 'link' });
    await expect(linked.service.merge(ownerId, targetId, sourceId)).rejects.toMatchObject({
      errorCode: 'MERGE_NOT_ALLOWED',
    });
    expect(same.tx.debtEntry.updateMany).not.toHaveBeenCalled();
    expect(unlinked.tx.debtEntry.updateMany).not.toHaveBeenCalled();
    expect(linked.tx.debtEntry.updateMany).not.toHaveBeenCalled();
  });

  it('moves source pointers before deleting the source in the same transaction', async () => {
    const { tx, service } = setup();
    await service.merge(ownerId, targetId, sourceId);
    expect(tx.ledgerPersonPointer.updateMany).toHaveBeenCalledWith({
      where: { userId: ownerId, counterpartyId: sourceId },
      data: { counterpartyId: targetId },
    });
    expect(tx.ledgerPersonPointer.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.counterparty.delete.mock.invocationCallOrder[0]!,
    );
  });
});

/** 列表必須先合併共享帳本金額，再決定篩選與排序。 */
describe('CounterpartiesService.list', () => {
  it('filters nonzero totals after merging ledger parts and reports the filtered count', async () => {
    const date = new Date('2026-10-07T00:00:00.000Z');
    const rows = ['zero', 'ledger', 'personal'].map((id) => ({
      id,
      ownerId: 'owner',
      name: id,
      askMerge: false,
      createdAt: date,
      updatedAt: date,
    }));
    const prisma = {
      counterparty: { findMany: jest.fn().mockResolvedValue(rows) },
      counterpartyLink: { findMany: jest.fn().mockResolvedValue([]) },
      debtEntry: {
        groupBy: jest.fn().mockResolvedValue([{ counterpartyId: 'personal', _sum: { delta: 10 } }]),
      },
    };
    const ledgerDebts = {
      partsByCounterparty: jest.fn().mockResolvedValue(
        new Map([
          [
            'ledger',
            [
              {
                ledgerId: 'book',
                ledgerName: '帳本',
                personId: 'person',
                personName: '人',
                amount: -20,
                left: false,
              },
            ],
          ],
        ]),
      ),
    };
    const service = new CounterpartiesService(
      prisma as unknown as PrismaService,
      ledgerDebts as unknown as LedgerDebtsService,
    );
    const result = await service.list('owner', { nonZero: true, page: 1, limit: 10 });
    expect(result.total).toBe(2);
    expect(result.items.map(({ id, totalBalance }) => [id, totalBalance])).toEqual([
      ['ledger', -20],
      ['personal', 10],
    ]);
    expect(ledgerDebts.partsByCounterparty).toHaveBeenCalledTimes(1);
  });
});
