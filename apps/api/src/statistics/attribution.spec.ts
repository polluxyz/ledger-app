import { attributeTransactions } from './attribution';
import type { AttributionPerson, AttributionTransaction } from './attribution';
import { taipeiMonthPeriod } from './taipei-period';

const scope = { ledgerId: 'ledger', userId: 'me', ...taipeiMonthPeriod('2026-10') };
const people: AttributionPerson[] = [
  { id: 'person-me', userId: 'me', name: null, user: { name: '我' } },
  { id: 'person-other', userId: 'other', name: null, user: { name: '小美' } },
  { id: 'guest', userId: null, name: '訪客', user: null },
];
const transaction: AttributionTransaction = {
  id: 'transaction',
  ledgerId: 'ledger',
  creatorId: 'me',
  creator: { name: '我' },
  payerPersonId: 'person-me',
  categoryId: null,
  differenceOf: null,
  debtEntry: null,
  type: 'EXPENSE',
  amount: 100,
  date: new Date('2026-10-01T00:00:00Z'),
  deletedAt: null,
  ledgerSplit: null,
};

/** 三層歸屬規則分別斷言每人金額，並驗證帳本、刪除、期間與交易型別的排除。 */
describe('Statistics reference attribution', () => {
  it('uses stored shares rather than recalculating equal amounts or including the payer', () => {
    const rows = attributeTransactions(
      [
        {
          ...transaction,
          ledgerSplit: {
            shares: [
              { personId: 'person-other', share: 71 },
              { personId: 'guest', share: 29 },
            ],
          },
        },
      ],
      people,
      scope,
    );
    expect(rows.map(({ personId, amount, isMe }) => ({ personId, amount, isMe }))).toEqual([
      { personId: 'person-other', amount: 71n, isMe: false },
      { personId: 'guest', amount: 29n, isMe: false },
    ]);
    expect(rows.reduce((sum, row) => sum + row.amount, 0n)).toBe(100n);
  });

  it('attributes unsplit amounts to the payer even when the creator is someone else', () => {
    const [row] = attributeTransactions(
      [{ ...transaction, payerPersonId: 'guest' }],
      people,
      scope,
    );
    expect(row).toMatchObject({ personId: 'guest', amount: 100n, isMe: false, name: '訪客' });
  });

  it('falls back to the creator, including private ledgers without LedgerPerson', () => {
    const old = { ...transaction, payerPersonId: null };
    expect(attributeTransactions([old], people, scope)[0]).toMatchObject({
      personId: 'person-me',
      isMe: true,
    });
    expect(attributeTransactions([old], [], scope)[0]).toMatchObject({
      personId: 'me',
      isMe: true,
    });
  });

  it('handles income shares and late October by Taipei calendar month', () => {
    const [row] = attributeTransactions(
      [
        {
          ...transaction,
          type: 'INCOME',
          date: new Date('2026-10-31T23:30:00+08:00'),
          ledgerSplit: { shares: [{ personId: 'person-me', share: 100 }] },
        },
      ],
      people,
      scope,
    );
    expect(row).toMatchObject({ direction: 'INCOME', amount: 100n, month: '2026-10', isMe: true });
  });

  it.each(['TRANSFER', 'LEND', 'BORROW', 'COLLECT', 'REPAY'] as const)(
    'excludes %s even when categorized',
    (type) => {
      expect(
        attributeTransactions([{ ...transaction, type, categoryId: 'category' }], people, scope),
      ).toEqual([]);
    },
  );

  it('excludes deleted, other-ledger, and out-of-period transactions including the exclusive end', () => {
    const excluded = [
      { ...transaction, deletedAt: new Date() },
      { ...transaction, ledgerId: 'other' },
      { ...transaction, date: new Date(scope.start.getTime() - 1) },
      { ...transaction, date: scope.end },
      { ...transaction, date: new Date('2026-11-01T00:10:00+08:00') },
    ];
    expect(attributeTransactions(excluded, people, scope)).toEqual([]);
    expect(
      attributeTransactions([{ ...transaction, date: scope.start }], people, scope),
    ).toHaveLength(1);
  });

  it('rejects unsafe stored amounts before converting to BigInt', () => {
    expect(() =>
      attributeTransactions(
        [{ ...transaction, amount: Number.MAX_SAFE_INTEGER + 1 }],
        people,
        scope,
      ),
    ).toThrow(RangeError);
  });
});
