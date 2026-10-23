import { buildAiCatalog } from './ai-catalog';
import { isRealDate, validateAiDrafts } from './ai-draft-validation';

/** 每條不可信欄位獨立測試，使用固定代號核對投影，避免測試跟著模型邏輯走。 */
describe('AI draft validation', () => {
  const catalog = buildAiCatalog(
    [
      { id: 'daily', name: '日常' },
      { id: 'trip', name: '旅行' },
    ],
    [
      { id: 'food', name: '餐飲', ledgerId: 'daily', type: 'EXPENSE' },
      { id: 'salary', name: '薪資', ledgerId: 'daily', type: 'INCOME' },
      { id: 'tripFood', name: '餐飲', ledgerId: 'trip', type: 'EXPENSE' },
    ],
    [
      { id: 'cash', name: '現金' },
      { id: 'bank', name: '銀行' },
    ],
    'daily',
    '2040-03-01',
  );
  const defaults = new Map([
    ['daily', 'cash'],
    ['trip', 'bank'],
  ]);
  const base = {
    type: 'EXPENSE',
    ledger: null,
    amountYuan: '60',
    date: null,
    title: ' 早餐 ',
    category: 'C1',
    account: null,
    toAccount: null,
  };
  const validate = (value: unknown) =>
    validateAiDrafts(value, catalog, defaults, '2040-03-01').drafts;
  const one = (overrides: Record<string, unknown>) =>
    validate({ drafts: [{ ...base, ...overrides }] })[0]!;

  it('projects only allowed fields and resolves exact codes', () => {
    expect(one({ payerPersonId: 'foreign', ledgerSplit: {}, extra: 'ignored' })).toEqual({
      ledgerId: 'daily',
      type: 'EXPENSE',
      amount: 6000,
      date: '2040-03-01',
      title: '早餐',
      categoryId: 'food',
      accountId: 'cash',
      toAccountId: null,
    });
  });
  it.each([
    ['0.01', 1],
    ['0.29', 29],
    ['20000000', 2000000000],
    ['20000000.01', null],
    ['0', null],
    ['-1', null],
    ['1.234', null],
    ['1e2', null],
    ['1,2', null],
    [29, null],
    [null, null],
    [' 1', null],
    ['+1', null],
  ])('validates amount %p as %p', (amountYuan, expected) => {
    expect(one({ amountYuan }).amount).toBe(expected);
  });
  it.each([
    ['', null],
    [' ', null],
    ['a'.repeat(100), 'a'.repeat(100)],
    ['a'.repeat(101), null],
    ['早餐', '早餐'],
    ['🍳'.repeat(100), '🍳'.repeat(100)],
    ['🍳'.repeat(101), null],
    [5, null],
  ])('validates title %p', (title, expected) => {
    expect(one({ title }).title).toBe(expected);
  });
  it.each([null, 'L999', 'L1x', 'L01', 'daily', 1, '__proto__'])(
    'falls back for ledger %p',
    (ledger) => {
      expect(one({ ledger }).ledgerId).toBe('daily');
    },
  );
  it('uses the final ledger for category and default account', () => {
    expect(one({ ledger: 'L2', category: 'C1' })).toMatchObject({
      ledgerId: 'trip',
      categoryId: null,
      accountId: 'bank',
    });
    expect(one({ ledger: 'L2', category: 'C3' }).categoryId).toBe('tripFood');
    expect(one({ category: 'C2' }).categoryId).toBeNull();
    expect(one({ type: 'INCOME', category: 'C2' }).categoryId).toBe('salary');
  });
  it.each(['?', 'A1x', 'A01', 'cash', undefined, 1, '__proto__'])(
    'does not default explicit invalid account %p',
    (account) => {
      expect(one({ account }).accountId).toBeNull();
    },
  );
  it('does not default a missing account key or unavailable default', () => {
    const missing: Record<string, unknown> = { ...base };
    delete missing.account;
    expect(validate({ drafts: [missing] })[0]!.accountId).toBeNull();
    expect(
      validateAiDrafts({ drafts: [base] }, catalog, new Map(), '2040-03-01').drafts[0]!.accountId,
    ).toBeNull();
    expect(
      validateAiDrafts({ drafts: [base] }, catalog, new Map([['daily', 'foreign']]), '2040-03-01')
        .drafts[0]!.accountId,
    ).toBeNull();
  });
  it('transfer clears category, resolves both accounts, and keeps identical accounts', () => {
    expect(one({ type: 'TRANSFER', account: 'A2', toAccount: 'A1' })).toMatchObject({
      categoryId: null,
      accountId: 'bank',
      toAccountId: 'cash',
    });
    expect(one({ type: 'TRANSFER', account: 'A1', toAccount: 'A1' })).toMatchObject({
      accountId: 'cash',
      toAccountId: 'cash',
    });
    expect(one({ type: 'TRANSFER', toAccount: null }).toAccountId).toBeNull();
    expect(one({ type: 'TRANSFER', toAccount: '?' }).toAccountId).toBeNull();
    expect(one({ toAccount: 'A1' }).toAccountId).toBeNull();
  });
  it.each([
    ['2026-02-30', false],
    ['2024-02-29', true],
    ['1900-02-29', false],
    ['2000-02-29', true],
    ['0000-01-01', false],
    ['2026-13-01', false],
    ['2026-01-00', false],
    ['2026-4-01', false],
    [1, false],
  ])('validates real calendar date %p', (date, expected) => {
    expect(isRealDate(date)).toBe(expected);
    expect(one({ date }).date).toBe(expected ? date : null);
  });
  it.each([null, [], {}, { drafts: null }, { drafts: 'bad' }])(
    'returns empty for malformed envelope %p',
    (value) => {
      expect(validate(value)).toEqual([]);
    },
  );
  it('takes ten before skipping invalid entries without replacing from eleventh', () => {
    expect(
      validate({ drafts: [null, 1, { ...base, type: 'LEND' }, ...Array<unknown>(8).fill(base)] }),
    ).toHaveLength(7);
    expect(validate({ drafts: Array<unknown>(11).fill(base) })).toHaveLength(10);
  });
});
