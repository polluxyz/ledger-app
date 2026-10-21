import type { LeaveMove } from '@ledger/shared';
import {
  groupLedgerDeleteItems,
  planLedgerDeleteMove,
  type DeleteMoveItem,
  type DeleteMovePlanInput,
  type DeleteMoveTransaction,
} from './ledger-delete-move-plan';
import type { LeavePersonalItem } from './ledger-leave-plan';

const food = { id: 'source-food', name: '餐飲', type: 'EXPENSE' as const, icon: 'utensils' };
function row(id: string, overrides: Partial<DeleteMoveTransaction> = {}): DeleteMoveTransaction {
  return {
    id,
    type: 'EXPENSE',
    amount: 3000,
    date: new Date('2026-10-21'),
    title: '午餐',
    note: null,
    accountId: 'cash',
    toAccountId: null,
    category: food,
    payer: null,
    shares: null,
    settlement: null,
    deletedAt: null,
    mergeId: null,
    mergedFromId: null,
    ...overrides,
  };
}
function input(
  items = groupLedgerDeleteItems([row('expense')], []),
  moves: LeaveMove[] = [],
): DeleteMovePlanInput {
  return {
    sourceLedgerId: 'source',
    items,
    moves,
    targetCategories: new Map(),
    effects: new Map(),
    counterparties: [],
  };
}
function personal(kind: LeavePersonalItem['kind']): LeavePersonalItem {
  return {
    id: kind,
    kind,
    date: new Date('2026-10-21'),
    title: '借還或分帳',
    category: food,
    share: null,
    transactions: [row(`${kind}-main`), row(`${kind}-branch`, { type: 'LEND', category: null })],
    entries: [{ id: `${kind}-entry`, counterpartyId: 'cp', delta: 200 }],
  };
}

/** 純計畫逐組驗證分類、綁定項目與非法選擇；帳戶效果使用呼叫端提供的值。 */
describe('planLedgerDeleteMove', () => {
  it.each(['EXPENSE', 'INCOME'] as const)(
    'SC-N6：合併來的 %s 與代墊依 mergeId、mergedFromId 合成，id 用份額列',
    (type) => {
      const share = row('share', { type, mergeId: 'merge', mergedFromId: 'original' });
      const advance = row('advance', {
        type: type === 'EXPENSE' ? 'LEND' : 'BORROW',
        category: null,
        mergeId: 'merge',
        mergedFromId: 'original',
      });
      const unrelated = row('unrelated', { ...advance, id: 'unrelated', mergeId: 'another' });
      const items = groupLedgerDeleteItems(
        [advance, share, unrelated, row('plain'), row('deleted', { deletedAt: new Date() })],
        [],
      );
      expect(items.map((i) => i.id)).toEqual(['share', 'unrelated', 'plain']);
      expect(items[0]!.transactions.map((t) => t.id)).toEqual(['share', 'advance']);
      for (const selected of [true, false]) {
        const plan = planLedgerDeleteMove(
          input(items, selected ? [{ targetLedgerId: 'target', itemIds: ['share'] }] : []),
        );
        expect(plan.retainedTransactionIds).toEqual(selected ? ['share', 'advance'] : []);
        expect(plan.withdrawalsToApply).toEqual([]);
      }
    },
  );
  it.each(['PERSONAL_DEBT', 'PERSONAL_SPLIT'] as const)(
    'SC-N6：%s 的所有內部交易一起搬或撤銷，withdrawals 按對象彙總',
    (kind) => {
      const item = personal(kind);
      const items = groupLedgerDeleteItems([], [item]);
      for (const selected of [true, false]) {
        const plan = planLedgerDeleteMove({
          ...input(items, selected ? [{ targetLedgerId: 'target', itemIds: [item.id] }] : []),
          counterparties: [{ id: 'cp', displayName: '阿德', linked: true, balance: 500 }],
          effects: new Map([[item.id, [{ accountId: 'cash', name: '現金', delta: -200 }]]]),
        });
        expect(plan.retainedTransactionIds).toEqual(
          selected ? item.transactions.map((t) => t.id) : [],
        );
        expect(plan.withdrawalsToApply).toEqual(selected ? [] : [item]);
        expect(plan.withdrawals).toEqual(
          selected
            ? []
            : [
                {
                  counterpartyId: 'cp',
                  displayName: '阿德',
                  linked: true,
                  balance: 500,
                  balanceAfter: 300,
                },
              ],
        );
        expect(plan.items[0]!.accountEffects).toEqual([
          { accountId: 'cash', name: '現金', delta: -200 },
        ]);
        if (selected)
          expect(plan.groups[0]!.splits).toEqual(
            kind === 'PERSONAL_SPLIT' ? [{ id: item.id, categoryRef: 'new:source-food' }] : [],
          );
      }
    },
  );
  it('SC-N5：每組各自對應分類；同類型同名用既有 id，沒有則同名同圖示只新建一次', () => {
    const items: DeleteMoveItem[] = [
      ...groupLedgerDeleteItems([row('expense')], []),
      personal('PERSONAL_SPLIT'),
    ];
    const plan = planLedgerDeleteMove({
      ...input(items, [
        { targetLedgerId: 'existing', itemIds: ['expense'] },
        { targetLedgerId: 'new', itemIds: ['PERSONAL_SPLIT'] },
      ]),
      targetCategories: new Map([
        ['existing', [{ ...food, id: 'existing-food' }]],
        ['new', [{ ...food, id: 'wrong-type', type: 'INCOME' }]],
      ]),
    });
    expect(plan.groups[0]!.transactions).toEqual([{ id: 'expense', categoryRef: 'existing-food' }]);
    expect(plan.groups[0]!.categories).toEqual([]);
    expect(plan.groups[1]!.categories).toEqual([{ ...food, ref: 'new:source-food' }]);
    expect(plan.groups[1]!.splits[0]!.categoryRef).toBe('new:source-food');
    expect(plan.groups.flatMap((g) => g.transactions).every((t) => t.categoryRef !== food.id)).toBe(
      true,
    );
  });
  it.each([
    [
      [
        { targetLedgerId: 'a', itemIds: ['expense'] },
        { targetLedgerId: 'b', itemIds: ['expense'] },
      ],
      'An item appears more than once.',
    ],
    [
      [
        { targetLedgerId: 'a', itemIds: ['expense'] },
        { targetLedgerId: 'a', itemIds: ['expense'] },
      ],
      'A target ledger appears more than once.',
    ],
    [[{ targetLedgerId: 'a', itemIds: [] }], 'Each move must contain at least one item.'],
    [[{ targetLedgerId: 'a', itemIds: ['unknown'] }], 'moves contains an unknown item.'],
    [
      [{ targetLedgerId: 'source', itemIds: ['expense'] }],
      'The target must differ from the source ledger.',
    ],
  ] satisfies [LeaveMove[], string][])('SC-N14：非法 moves 回傳錯誤：%s', (moves, error) => {
    expect(planLedgerDeleteMove(input(undefined, moves)).errors).toContain(error);
  });
});
