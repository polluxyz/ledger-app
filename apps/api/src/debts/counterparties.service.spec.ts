import type { PrismaService } from '../prisma/prisma.service';
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
        updateMany: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { delta: 0 } }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn(),
    };
    const prisma = { ...tx, $transaction: jest.fn((cb: (client: typeof tx) => unknown) => cb(tx)) };
    return { rows, tx, service: new CounterpartiesService(prisma as unknown as PrismaService) };
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
});
