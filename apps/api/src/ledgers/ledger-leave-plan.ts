import type {
  CategoryIcon,
  LedgerLeaveAccountEffect,
  LedgerLeaveCarryOver,
  LedgerLeaveItem,
  LedgerLeaveWithdrawal,
  TransactionType,
} from '@ledger/shared';

/**
 * 退出的唯一計畫入口。資料庫、授權與餘額正負號由呼叫端處理；本函式只做 §2.3 的
 * 轉換與選擇。effects 由 AccountsService.calculateBalances 取得，不能另寫餘額公式。
 */
export interface LeaveCategory {
  id: string;
  name: string;
  type: TransactionType;
  icon: string | null;
}

export interface LeaveTransaction {
  id: string;
  type: TransactionType;
  amount: number;
  date: Date;
  title: string | null;
  note: string | null;
  accountId: string | null;
  toAccountId: string | null;
  category: LeaveCategory | null;
  payer: { userId: string | null; name: string } | null;
  shares: { userId: string | null; share: number }[] | null;
  settlement: {
    from: { userId: string | null; name: string };
    to: { userId: string | null; name: string };
  } | null;
  deletedAt: Date | null;
}

export interface LeavePersonalItem {
  id: string;
  kind: 'PERSONAL_DEBT' | 'PERSONAL_SPLIT';
  date: Date;
  title: string | null;
  category: LeaveCategory | null;
  share: number | null;
  transactions: LeaveTransaction[];
  entries: { id: string; counterpartyId: string; delta: number }[];
}

/** 分組只依關聯判斷；3k 與 3l 共用，避免還款分支或個人分帳只帶走一半。 */
export function groupPersonalLeaveItems<
  T extends {
    id: string;
    date: Date;
    title: string | null;
    category: LeaveCategory | null;
    splitId: string | null;
    differenceOfId: string | null;
    debtEntry:
      | ({
          deletedAt: Date | null;
          splitId: string | null;
          settlesEntryId: string | null;
          counterparty: { ownerId: string };
          settledBy: {
            id: string;
            counterpartyId: string;
            delta: number;
            deletedAt: Date | null;
          } | null;
        } & { id: string; counterpartyId: string; delta: number })
      | null;
  },
>(
  rows: readonly T[],
  splits: readonly {
    id: string;
    date: Date;
    title: string | null;
    category: LeaveCategory;
    participants: { counterpartyId: string | null; share: number }[];
    entries: { id: string; counterpartyId: string; delta: number }[];
  }[],
  userId: string,
  normalize: (row: T) => LeaveTransaction,
): LeavePersonalItem[] {
  const items: LeavePersonalItem[] = rows
    .filter(
      (t) =>
        t.debtEntry?.counterparty.ownerId === userId &&
        t.debtEntry.deletedAt === null &&
        !t.debtEntry.splitId &&
        !t.debtEntry.settlesEntryId,
    )
    .map((t) => ({
      id: t.id,
      kind: 'PERSONAL_DEBT',
      date: t.date,
      title: t.title,
      category: t.category,
      share: null,
      transactions: [t, ...rows.filter((branch) => branch.differenceOfId === t.id)].map(normalize),
      entries: [
        t.debtEntry!,
        ...(t.debtEntry!.settledBy?.deletedAt === null ? [t.debtEntry!.settledBy] : []),
      ],
    }));
  for (const split of splits)
    items.push({
      id: split.id,
      kind: 'PERSONAL_SPLIT',
      date: split.date,
      title: split.title,
      category: split.category,
      share: split.participants.find((p) => p.counterpartyId === null)?.share ?? 0,
      transactions: rows.filter((t) => t.splitId === split.id).map(normalize),
      entries: split.entries,
    });
  return items;
}

export interface LeavePlanInput {
  userId: string;
  sourceLedgerName: string;
  transactions: LeaveTransaction[];
  personalItems: LeavePersonalItem[];
  ownAccountIds: readonly string[];
  effects: ReadonlyMap<string, LedgerLeaveAccountEffect[]>;
  excludedItemIds: readonly string[];
  targetCategories: LeaveCategory[];
  ledgerAmounts: {
    ledgerPersonId: string;
    displayName: string;
    amount: number;
    counterpartyId: string | null;
  }[];
  counterparties: {
    id: string;
    name: string | null;
    displayName: string;
    linked: boolean;
    balance: number;
  }[];
}

export interface LeavePlannedTransaction {
  type: TransactionType;
  amount: number;
  date: Date;
  title: string | null;
  note: string | null;
  accountId: string | null;
  toAccountId: string | null;
  categoryRef: string | null;
  mergedFromId: string;
}

export function planLedgerLeave(input: LeavePlanInput) {
  const own = new Set(input.ownAccountIds);
  const excluded = new Set(input.excludedItemIds);
  const categories: (LeaveCategory & { ref: string })[] = [];
  const categoryRefs = new Map<string, string>();
  const targetByName = new Map(
    input.targetCategories.map((c) => [JSON.stringify([c.type, c.name]), c.id]),
  );
  const categoryRef = (category: LeaveCategory | null): string | null => {
    if (!category) return null;
    const key = JSON.stringify([category.type, category.name]);
    let ref = targetByName.get(key);
    if (!ref) {
      ref = `new:${category.id}`;
      targetByName.set(key, ref);
      categories.push({ ...category, ref });
    }
    categoryRefs.set(category.id, ref);
    return ref;
  };
  const items: LedgerLeaveItem[] = [];
  const transactions: LeavePlannedTransaction[] = [];
  const retainedTransactionIds: string[] = [];
  const moves: {
    item: LeavePersonalItem;
    categoryRef: string | null;
    transactions: { id: string; categoryRef: string | null }[];
  }[] = [];
  const withdrawalsToApply: LeavePersonalItem[] = [];
  const addItem = (item: Omit<LedgerLeaveItem, 'accountEffects'>) => {
    items.push({
      ...item,
      accountEffects: (input.effects.get(item.id) ?? []).filter((e) => own.has(e.accountId)),
    });
  };
  for (const row of input.transactions) {
    if (row.deletedAt) continue;
    const payerIsMe =
      !row.settlement && row.type !== 'TRANSFER' && row.payer?.userId === input.userId;
    const myShare =
      row.shares?.filter((s) => s.userId === input.userId).reduce((sum, s) => sum + s.share, 0) ??
      null;
    const inShares = row.shares?.some((s) => s.userId === input.userId) ?? false;
    const settlementFrom = row.settlement?.from.userId === input.userId;
    const settlementTo = row.settlement?.to.userId === input.userId;
    if (
      !payerIsMe &&
      !inShares &&
      !settlementFrom &&
      !settlementTo &&
      !own.has(row.accountId ?? '') &&
      !own.has(row.toAccountId ?? '')
    )
      continue;
    addItem({
      id: row.id,
      date: row.date.toISOString(),
      title: row.title,
      categoryIcon: (row.category?.icon as CategoryIcon | null) ?? null,
      share:
        row.settlement || row.type === 'TRANSFER'
          ? null
          : payerIsMe
            ? (myShare ?? row.amount)
            : myShare,
      paidByName:
        !payerIsMe && !row.settlement && row.type !== 'TRANSFER' ? (row.payer?.name ?? null) : null,
      kind: 'SHARED',
    });
    if (excluded.has(row.id)) continue;
    retainedTransactionIds.push(row.id);
    const add = (
      type: TransactionType,
      amount: number,
      accountId: string | null,
      category: LeaveCategory | null = null,
      title = row.title,
      toAccountId: string | null = null,
    ) => {
      if (amount === 0) return;
      transactions.push({
        type,
        amount,
        date: row.date,
        title,
        note: row.note,
        accountId: own.has(accountId ?? '') ? accountId : null,
        toAccountId: own.has(toAccountId ?? '') ? toAccountId : null,
        categoryRef: categoryRef(category),
        mergedFromId: row.id,
      });
    };
    if (row.settlement) {
      if (settlementFrom)
        add('LEND', row.amount, row.accountId, null, `結清 · ${row.settlement.to.name}`);
      if (settlementTo)
        add('COLLECT', row.amount, row.toAccountId, null, `結清 · ${row.settlement.from.name}`);
    } else if (row.type === 'TRANSFER') {
      add('TRANSFER', row.amount, row.accountId, null, row.title, row.toAccountId);
    } else if (payerIsMe || own.has(row.accountId ?? '')) {
      if (row.shares && (row.type === 'EXPENSE' || row.type === 'INCOME')) {
        const share = myShare ?? 0;
        add(row.type, share, row.accountId, row.category);
        add(row.type === 'EXPENSE' ? 'LEND' : 'BORROW', row.amount - share, row.accountId);
      } else add(row.type, row.amount, row.accountId, row.category);
    } else if (inShares) add(row.type, myShare ?? 0, null, row.category);
  }
  for (const item of input.personalItems) {
    addItem({
      id: item.id,
      date: item.date.toISOString(),
      title: item.title,
      categoryIcon: (item.category?.icon as CategoryIcon | null) ?? null,
      share: item.share,
      paidByName: null,
      kind: item.kind,
    });
    if (excluded.has(item.id)) withdrawalsToApply.push(item);
    else {
      moves.push({
        item,
        categoryRef: categoryRef(item.category),
        transactions: item.transactions.map((t) => ({
          id: t.id,
          categoryRef: categoryRef(t.category),
        })),
      });
      retainedTransactionIds.push(...item.transactions.map((t) => t.id));
    }
  }
  const usedNames = new Set(input.counterparties.map((c) => c.displayName));
  const carryOvers: (LedgerLeaveCarryOver & { newCounterpartyName: string | null })[] =
    input.ledgerAmounts
      .filter((p) => p.amount !== 0)
      .map((person) => {
        // 指向不屬於我的對象時拒絕沿用；service 的查詢也以 ownerId 限定。
        const counterpartyId = input.counterparties.some((c) => c.id === person.counterpartyId)
          ? person.counterpartyId
          : null;
        let name: string | null = null;
        if (!counterpartyId) {
          name = person.displayName;
          if (usedNames.has(name)) {
            const suffix = `（${input.sourceLedgerName}）`;
            name = `${Array.from(name)
              .slice(0, Math.max(0, 100 - Array.from(suffix).length))
              .join('')}${suffix}`;
          }
          name = Array.from(name).slice(0, 100).join('');
          const base = name;
          let suffix = 2;
          while (usedNames.has(name)) {
            const tail = ` ${suffix++}`;
            name = `${Array.from(base)
              .slice(0, 100 - tail.length)
              .join('')}${tail}`;
          }
          usedNames.add(name);
        }
        return { ...person, counterpartyId, newCounterpartyName: name };
      });
  const withdrawals: LedgerLeaveWithdrawal[] = input.counterparties
    .map((c) => {
      const impact = withdrawalsToApply
        .flatMap((i) => i.entries)
        .filter((e) => e.counterpartyId === c.id)
        .reduce((sum, e) => sum + e.delta, 0);
      return {
        counterpartyId: c.id,
        displayName: c.displayName,
        linked: c.linked,
        balance: c.balance,
        balanceAfter: c.balance - impact,
      };
    })
    .filter((c) => c.balance !== c.balanceAfter);
  const accountDeltas = new Map<string, number>();
  for (const item of items.filter((i) => excluded.has(i.id)))
    for (const effect of item.accountEffects)
      accountDeltas.set(
        effect.accountId,
        (accountDeltas.get(effect.accountId) ?? 0) - effect.delta,
      );
  items.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return {
    items,
    transactions,
    categories,
    categoryRefs,
    moves,
    withdrawalsToApply,
    retainedTransactionIds,
    carryOvers,
    withdrawals,
    accountDeltas,
    unknownExcludedItemIds: [...excluded].filter((id) => !items.some((i) => i.id === id)),
    hasSelectedItems: items.some((i) => !excluded.has(i.id)),
  };
}

export type LedgerLeavePlan = ReturnType<typeof planLedgerLeave>;
