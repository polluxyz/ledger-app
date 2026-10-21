import { AccountsService } from '../accounts/accounts.service';
import type { Prisma } from '../generated/prisma/client';
import {
  groupPersonalLeaveItems,
  planLedgerLeave,
  type LeavePlanInput,
  type LeaveTransaction,
} from './ledger-leave-plan';

const category = { id: 'source-food', name: '餐飲', type: 'EXPENSE' as const, icon: 'utensils' };
const accountRows = ['cash', 'card', 'temporary'].map((id) => ({
  id,
  userId: 'me',
  name: id,
  initialBalance: 0,
  isTemporary: id === 'temporary',
  createdAt: new Date(),
}));
function row(overrides: Partial<LeaveTransaction> = {}): LeaveTransaction {
  return {
    id: 'original',
    type: 'EXPENSE',
    amount: 300000,
    date: new Date('2026-10-18'),
    title: '住宿',
    note: null,
    accountId: 'card',
    toAccountId: null,
    category,
    payer: { userId: 'me', name: '我' },
    shares: null,
    settlement: null,
    deletedAt: null,
    ...overrides,
  };
}
function input(overrides: Partial<LeavePlanInput> = {}): LeavePlanInput {
  return {
    userId: 'me',
    sourceLedgerName: '花蓮三日',
    transactions: [],
    personalItems: [],
    ownAccountIds: accountRows.map((a) => a.id),
    effects: new Map(),
    excludedItemIds: [],
    targetCategories: [],
    ledgerAmounts: [],
    counterparties: [],
    ...overrides,
  };
}

/** 共用分組保留 3k 的本人隔離、結清分支與分帳項目 id，3l 直接沿用。 */
describe('groupPersonalLeaveItems', () => {
  it('還款連同 differenceOf 與有效 settledBy；分帳連同所有交易，其他人的借還不列入', () => {
    const entry = {
      id: 'entry',
      counterpartyId: 'cp',
      delta: -480,
      deletedAt: null,
      splitId: null,
      settlesEntryId: null,
      counterparty: { ownerId: 'me' },
      settledBy: {
        id: 'settlement',
        counterpartyId: 'cp',
        delta: -20,
        deletedAt: null as Date | null,
      },
    };
    const rows = [
      { ...row({ id: 'repayment' }), splitId: null, differenceOfId: null, debtEntry: entry },
      { ...row({ id: 'branch' }), splitId: null, differenceOfId: 'repayment', debtEntry: null },
      { ...row({ id: 'split-share' }), splitId: 'split', differenceOfId: null, debtEntry: null },
      {
        ...row({ id: 'split-advance', type: 'LEND' }),
        splitId: 'split',
        differenceOfId: null,
        debtEntry: null,
      },
      {
        ...row({ id: 'other' }),
        splitId: null,
        differenceOfId: null,
        debtEntry: { ...entry, counterparty: { ownerId: 'other' } },
      },
      {
        ...row({ id: 'settlement-row' }),
        splitId: null,
        differenceOfId: null,
        debtEntry: { ...entry, settlesEntryId: 'entry' },
      },
    ];
    const splits = [
      {
        id: 'split',
        date: new Date(),
        title: null,
        category,
        participants: [{ counterpartyId: null, share: 100 }],
        entries: [{ id: 'split-entry', counterpartyId: 'cp', delta: 200 }],
      },
    ];
    const items = groupPersonalLeaveItems(rows, splits, 'me', (t) => t);
    expect(items.map((i) => [i.id, i.transactions.map((t) => t.id)])).toEqual([
      ['repayment', ['repayment', 'branch']],
      ['split', ['split-share', 'split-advance']],
    ]);
    expect(items[0]!.entries.map((e) => e.id)).toEqual(['entry', 'settlement']);
    expect(items[1]!.share).toBe(100);
    entry.settledBy.deletedAt = new Date();
    expect(
      groupPersonalLeaveItems(rows, splits, 'me', (t) => t)[0]!.entries.map((e) => e.id),
    ).toEqual(['entry']);
  });
});

/** 用正式 AccountsService 的公式比較原交易與計畫，mock 只負責 SQL groupBy 的分組加總。 */
async function balances(
  rows: Pick<LeaveTransaction, 'accountId' | 'toAccountId' | 'type' | 'amount'>[],
) {
  const client = {
    transaction: {
      groupBy: jest.fn(({ by }: { by: string[] }) => {
        const groups = new Map<
          string,
          {
            accountId: string | null;
            toAccountId: string | null;
            type: LeaveTransaction['type'];
            _sum: { amount: number };
          }
        >();
        for (const t of rows) {
          if (by[0] === 'toAccountId' && t.type !== 'TRANSFER') continue;
          const id = by[0] === 'toAccountId' ? t.toAccountId : t.accountId;
          if (!accountRows.some((a) => a.id === id)) continue;
          const key = JSON.stringify(by.map((field) => t[field as 'type' | 'accountId']));
          const group = groups.get(key) ?? { ...t, _sum: { amount: 0 } };
          group._sum.amount += t.amount;
          groups.set(key, group);
        }
        return Promise.resolve([...groups.values()]);
      }),
    },
  };
  return (
    await new AccountsService({} as never).calculateBalances(
      accountRows,
      client as unknown as Prisma.TransactionClient,
    )
  ).balances;
}

/** 逐列驗證 §2.3，並讓正式餘額計算器檢查每個本人帳戶在轉換前後完全相等。 */
describe('planLedgerLeave', () => {
  const cases: {
    name: string;
    source: LeaveTransaction;
    expected: [string, number, string | null][];
  }[] = [
    { name: '無分帳支出', source: row(), expected: [['EXPENSE', 300000, 'card']] },
    {
      name: '無分帳收入',
      source: row({ type: 'INCOME', category: { ...category, type: 'INCOME' } }),
      expected: [['INCOME', 300000, 'card']],
    },
    {
      name: '我付分帳支出',
      source: row({
        shares: [
          { userId: 'me', share: 100000 },
          { userId: 'ming', share: 200000 },
        ],
      }),
      expected: [
        ['EXPENSE', 100000, 'card'],
        ['LEND', 200000, 'card'],
      ],
    },
    {
      name: '我收分帳收入',
      source: row({
        type: 'INCOME',
        category: { ...category, type: 'INCOME' },
        shares: [
          { userId: 'me', share: 100000 },
          { userId: 'ming', share: 200000 },
        ],
      }),
      expected: [
        ['INCOME', 100000, 'card'],
        ['BORROW', 200000, 'card'],
      ],
    },
    {
      name: '別人付支出只搬我的份額',
      source: row({
        accountId: 'others',
        payer: { userId: 'ming', name: '小明' },
        shares: [{ userId: 'me', share: 100000 }],
      }),
      expected: [['EXPENSE', 100000, null]],
    },
    {
      name: '別人收收入只搬我的份額',
      source: row({
        type: 'INCOME',
        category: { ...category, type: 'INCOME' },
        accountId: 'others',
        payer: { userId: 'ming', name: '小明' },
        shares: [{ userId: 'me', share: 100000 }],
      }),
      expected: [['INCOME', 100000, null]],
    },
    {
      name: '結清我付',
      source: row({
        type: 'TRANSFER',
        category: null,
        toAccountId: 'others',
        settlement: { from: { userId: 'me', name: '我' }, to: { userId: 'ming', name: '小明' } },
      }),
      expected: [['LEND', 300000, 'card']],
    },
    {
      name: '結清我收',
      source: row({
        type: 'TRANSFER',
        category: null,
        accountId: 'others',
        toAccountId: 'cash',
        settlement: { from: { userId: 'ming', name: '小明' }, to: { userId: 'me', name: '我' } },
      }),
      expected: [['COLLECT', 300000, 'cash']],
    },
    {
      name: '自己的帳戶互轉',
      source: row({ type: 'TRANSFER', category: null, toAccountId: 'cash' }),
      expected: [['TRANSFER', 300000, 'card']],
    },
    {
      name: '別人替我記到臨時帳戶',
      source: row({ accountId: 'temporary', shares: [{ userId: 'me', share: 100000 }] }),
      expected: [
        ['EXPENSE', 100000, 'temporary'],
        ['LEND', 200000, 'temporary'],
      ],
    },
    {
      name: '我付份額零',
      source: row({ shares: [{ userId: 'ming', share: 300000 }] }),
      expected: [['LEND', 300000, 'card']],
    },
    {
      name: '我付明確份額零',
      source: row({
        shares: [
          { userId: 'me', share: 0 },
          { userId: 'ming', share: 300000 },
        ],
      }),
      expected: [['LEND', 300000, 'card']],
    },
    {
      name: '記到我的帳戶但付款人缺漏',
      source: row({ payer: null }),
      expected: [['EXPENSE', 300000, 'card']],
    },
  ];
  it.each(cases)('$name：每個帳戶的淨效果保持相等', async ({ source, expected }) => {
    const plan = planLedgerLeave(input({ transactions: [source] }));
    expect(plan.transactions.map((t) => [t.type, t.amount, t.accountId])).toEqual(expected);
    expect(await balances(plan.transactions)).toEqual(await balances([source]));
    expect(plan.transactions.every((t) => t.mergedFromId === source.id)).toBe(true);
    for (const t of plan.transactions.filter((t) =>
      ['LEND', 'BORROW', 'COLLECT', 'TRANSFER'].includes(t.type),
    ))
      expect(t.categoryRef).toBeNull();
    if (source.settlement) expect(plan.transactions[0]!.title).toBe('結清 · 小明');
    if (!source.settlement && source.type === 'TRANSFER')
      expect(plan.transactions[0]!.toAccountId).toBe('cash');
  });

  it('沿用目標的同型別同名分類，不沿用來源 id；型別不同則新建', () => {
    const plan = planLedgerLeave(
      input({ transactions: [row()], targetCategories: [{ ...category, id: 'target-food' }] }),
    );
    expect(plan.transactions[0]!.categoryRef).toBe('target-food');
    expect(plan.categories).toEqual([]);
    const different = planLedgerLeave(
      input({
        transactions: [row()],
        targetCategories: [{ ...category, id: 'target-income', type: 'INCOME' }],
      }),
    );
    expect(different.categories).toEqual([{ ...category, ref: `new:${category.id}` }]);
  });
  it('同一來源分類只建一次，圖示照搬，份額零不建立無用分類', () => {
    const plan = planLedgerLeave(input({ transactions: [row(), row({ id: 'second' })] }));
    expect(plan.categories).toHaveLength(1);
    expect(plan.categories[0]!.icon).toBe(category.icon);
    expect(plan.transactions[0]!.categoryRef).toBe(plan.transactions[1]!.categoryRef);
    expect(
      planLedgerLeave(input({ transactions: [row({ shares: [{ userId: 'me', share: 0 }] })] }))
        .categories,
    ).toEqual([]);
  });
  it('依有效指向選對象；沒有指向就新增，重名加帳本名，不併入既有同名者', () => {
    const plan = planLedgerLeave(
      input({
        ledgerAmounts: [
          { ledgerPersonId: 'ming', displayName: '小明', amount: 500, counterpartyId: 'cp' },
          { ledgerPersonId: 'hua', displayName: '小華', amount: -1000, counterpartyId: null },
          { ledgerPersonId: 'new', displayName: '新朋友', amount: 20, counterpartyId: null },
          { ledgerPersonId: 'zero', displayName: '兩清', amount: 0, counterpartyId: null },
        ],
        counterparties: [
          { id: 'cp', name: '小明', displayName: '小明', linked: true, balance: 0 },
          { id: 'hua-old', name: '小華', displayName: '小華', linked: false, balance: 0 },
        ],
      }),
    );
    expect(plan.carryOvers.map((c) => [c.counterpartyId, c.newCounterpartyName, c.amount])).toEqual(
      [
        ['cp', null, 500],
        [null, '小華（花蓮三日）', -1000],
        [null, '新朋友', 20],
      ],
    );
  });
  it('排除後帳戶淨變動消失，帳本轉入仍照轉；忽略軟刪除與無關交易', () => {
    const plan = planLedgerLeave(
      input({
        transactions: [
          row(),
          row({ id: 'deleted', deletedAt: new Date() }),
          row({ id: 'unrelated', payer: { userId: 'other', name: '別人' }, accountId: 'others' }),
        ],
        effects: new Map([['original', [{ accountId: 'card', name: '卡', delta: -300000 }]]]),
        excludedItemIds: ['original'],
        ledgerAmounts: [
          { ledgerPersonId: 'hua', displayName: '小華', amount: 50000, counterpartyId: null },
        ],
      }),
    );
    expect(plan.items.map((i) => i.id)).toEqual(['original']);
    expect(plan.transactions).toEqual([]);
    expect(plan.accountDeltas.get('card')).toBe(300000);
    expect(plan.carryOvers[0]!.amount).toBe(50000);
    expect(plan.hasSelectedItems).toBe(false);
  });
  it('個人借還與分帳勾選時搬家、不複製，未勾時按對象彙總撤銷前後餘額', () => {
    const personalItems: LeavePlanInput['personalItems'] = [
      {
        id: 'debt-tx',
        kind: 'PERSONAL_DEBT',
        date: new Date(),
        title: '借出',
        category: null,
        share: null,
        transactions: [row({ id: 'debt-tx', type: 'LEND', category: null })],
        entries: [{ id: 'entry', counterpartyId: 'cp', delta: 50000 }],
      },
      {
        id: 'split',
        kind: 'PERSONAL_SPLIT',
        date: new Date(),
        title: '晚餐',
        category,
        share: 100,
        transactions: [row({ id: 'split-tx' })],
        entries: [{ id: 'split-entry', counterpartyId: 'cp', delta: 1000 }],
      },
    ];
    const selected = planLedgerLeave(input({ personalItems }));
    expect(selected.moves).toHaveLength(2);
    expect(selected.transactions).toEqual([]);
    expect(selected.retainedTransactionIds).toEqual(['debt-tx', 'split-tx']);
    expect(selected.moves[1]!.transactions[0]!.categoryRef).toBe(`new:${category.id}`);
    const omitted = planLedgerLeave(
      input({
        personalItems,
        excludedItemIds: ['debt-tx', 'split'],
        counterparties: [
          { id: 'cp', name: '明哥', displayName: '明哥', linked: true, balance: 80000 },
        ],
      }),
    );
    expect(omitted.withdrawals).toEqual([
      {
        counterpartyId: 'cp',
        displayName: '明哥',
        linked: true,
        balance: 80000,
        balanceAfter: 29000,
      },
    ]);
    expect(omitted.withdrawalsToApply).toEqual(personalItems);
    expect(omitted.moves).toEqual([]);
  });
  it('未知 id 回傳給 service 最後驗證，預覽不洩漏其他人的帳戶與對象 id', () => {
    const plan = planLedgerLeave(
      input({
        transactions: [row()],
        excludedItemIds: ['unknown'],
        effects: new Map([['original', [{ accountId: 'others', name: '秘密', delta: 1 }]]]),
        ledgerAmounts: [
          { ledgerPersonId: 'hua', displayName: '小華', amount: 5, counterpartyId: 'others-cp' },
        ],
      }),
    );
    expect(plan.unknownExcludedItemIds).toEqual(['unknown']);
    expect(plan.items[0]!.accountEffects).toEqual([]);
    expect(plan.carryOvers[0]!.counterpartyId).toBeNull();
  });
  it('替其他人記結清不代表我是付款人；外人的結清與互轉不列入', () => {
    const plan = planLedgerLeave(
      input({
        transactions: [
          row({
            type: 'TRANSFER',
            accountId: 'others',
            toAccountId: 'other-two',
            settlement: {
              from: { userId: 'ming', name: '小明' },
              to: { userId: 'hua', name: '小華' },
            },
          }),
          row({ id: 'transfer', type: 'TRANSFER', accountId: 'others', toAccountId: 'other-two' }),
        ],
      }),
    );
    expect(plan.items).toEqual([]);
    expect(plan.transactions).toEqual([]);
  });
});
