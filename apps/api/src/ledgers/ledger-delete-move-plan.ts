import type {
  CategoryIcon,
  LeaveMove,
  LedgerLeaveAccountEffect,
  LedgerLeaveItem,
  LedgerLeaveWithdrawal,
} from '@ledger/shared';
import type { LeaveCategory, LeavePersonalItem, LeaveTransaction } from './ledger-leave-plan';

/** 私人帳本的搬移只改歸屬；同組內部交易保留 id、帳戶與合併來源。 */
export type DeleteMoveTransaction = LeaveTransaction & {
  mergeId: string | null;
  mergedFromId: string | null;
};
export type DeleteMoveItem = Omit<LeavePersonalItem, 'kind'> & {
  kind: LedgerLeaveItem['kind'];
};

/** 合成規則與交易列表的 mergedAdvanceExcluded 相同，以份額列作項目 id。 */
export function groupLedgerDeleteItems(
  ordinary: readonly DeleteMoveTransaction[],
  personal: readonly LeavePersonalItem[],
): DeleteMoveItem[] {
  const advances = new Set<string>();
  const shared: DeleteMoveItem[] = ordinary
    .filter((row) => row.deletedAt === null)
    .map((row, _, active) => {
      const companions =
        row.mergeId && row.mergedFromId && (row.type === 'EXPENSE' || row.type === 'INCOME')
          ? active.filter(
              (other) =>
                other.mergeId === row.mergeId &&
                other.mergedFromId === row.mergedFromId &&
                other.type === (row.type === 'EXPENSE' ? 'LEND' : 'BORROW'),
            )
          : [];
      for (const companion of companions) advances.add(companion.id);
      return {
        id: row.id,
        kind: 'SHARED',
        date: row.date,
        title: row.title,
        category: row.category,
        share: row.type === 'EXPENSE' || row.type === 'INCOME' ? row.amount : null,
        transactions: [row, ...companions],
        entries: [],
      };
    });
  return [...shared.filter((item) => !advances.has(item.id)), ...personal];
}

export interface DeleteMovePlanInput {
  sourceLedgerId: string;
  items: readonly DeleteMoveItem[];
  moves: readonly LeaveMove[];
  targetCategories: ReadonlyMap<string, readonly LeaveCategory[]>;
  effects: ReadonlyMap<string, LedgerLeaveAccountEffect[]>;
  counterparties: readonly {
    id: string;
    displayName: string;
    linked: boolean;
    balance: number;
  }[];
}

/** 純計畫共用於預覽與執行；帳戶效果只接受 AccountsService 已算好的結果。 */
export function planLedgerDeleteMove(input: DeleteMovePlanInput) {
  const errors: string[] = [];
  const targets = new Set<string>();
  const selected = new Set<string>();
  const byId = new Map(input.items.map((item) => [item.id, item]));
  for (const move of input.moves) {
    if (targets.has(move.targetLedgerId)) errors.push('A target ledger appears more than once.');
    targets.add(move.targetLedgerId);
    if (move.targetLedgerId === input.sourceLedgerId)
      errors.push('The target must differ from the source ledger.');
    if (!move.itemIds.length) errors.push('Each move must contain at least one item.');
    for (const id of move.itemIds) {
      if (selected.has(id)) errors.push('An item appears more than once.');
      if (!byId.has(id)) errors.push('moves contains an unknown item.');
      selected.add(id);
    }
  }
  const retainedTransactionIds: string[] = [];
  const groups = input.moves.map((move) => {
    const categories: (LeaveCategory & { ref: string })[] = [];
    const refs = new Map(
      (input.targetCategories.get(move.targetLedgerId) ?? []).map((c) => [
        JSON.stringify([c.type, c.name]),
        c.id,
      ]),
    );
    const categoryRef = (category: LeaveCategory | null) => {
      if (!category) return null;
      const key = JSON.stringify([category.type, category.name]);
      let ref = refs.get(key);
      if (!ref) {
        ref = `new:${category.id}`;
        refs.set(key, ref);
        categories.push({ ...category, ref });
      }
      return ref;
    };
    const transactions: { id: string; categoryRef: string | null }[] = [];
    const splits: { id: string; categoryRef: string | null }[] = [];
    for (const id of move.itemIds) {
      const item = byId.get(id);
      if (!item) continue;
      if (item.kind === 'PERSONAL_SPLIT')
        splits.push({ id, categoryRef: categoryRef(item.category) });
      for (const transaction of item.transactions) {
        transactions.push({ id: transaction.id, categoryRef: categoryRef(transaction.category) });
        retainedTransactionIds.push(transaction.id);
      }
    }
    return { targetLedgerId: move.targetLedgerId, categories, transactions, splits };
  });
  const withdrawalsToApply = input.items.filter(
    (item) => item.kind !== 'SHARED' && !selected.has(item.id),
  );
  const withdrawals: LedgerLeaveWithdrawal[] = input.counterparties
    .map((cp) => ({
      counterpartyId: cp.id,
      displayName: cp.displayName,
      linked: cp.linked,
      balance: cp.balance,
      balanceAfter:
        cp.balance -
        withdrawalsToApply
          .flatMap((item) => item.entries)
          .filter((entry) => entry.counterpartyId === cp.id)
          .reduce((sum, entry) => sum + entry.delta, 0),
    }))
    .filter((cp) => cp.balance !== cp.balanceAfter);
  const items: LedgerLeaveItem[] = input.items
    .map((item) => ({
      id: item.id,
      date: item.date.toISOString(),
      title: item.title,
      categoryIcon: (item.category?.icon as CategoryIcon | null) ?? null,
      share: item.share,
      paidByName: null,
      kind: item.kind,
      accountEffects: input.effects.get(item.id) ?? [],
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { errors, groups, items, withdrawalsToApply, withdrawals, retainedTransactionIds };
}

export type LedgerDeleteMovePlan = ReturnType<typeof planLedgerDeleteMove>;
