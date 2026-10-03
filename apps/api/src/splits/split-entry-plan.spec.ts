/** 逐人比對的單元測試，驗證修改、增減人與改付款人的規則。 */
import { composeSplitEntries, planSplitEntries } from './split-entry-plan';

const date = new Date('2026-10-03T12:00:00.000Z');
describe('planSplitEntries', () => {
  it('keeps a matching person and kind, amending only changed values', () => {
    const old = [
      { id: 'a', counterpartyId: 'ming', kind: 'PAID_FOR_THEM' as const, amount: 750, date },
    ];
    const plan = planSplitEntries(
      old,
      [{ counterpartyId: 'ming', kind: 'PAID_FOR_THEM', amount: 1000 }],
      date,
    );
    expect(plan.create).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.amend).toEqual([
      { old: old[0], next: { counterpartyId: 'ming', kind: 'PAID_FOR_THEM', amount: 1000 } },
    ]);
  });
  it('deletes removed people and creates newly added people', () => {
    const old = [
      { id: 'a', counterpartyId: 'mei', kind: 'PAID_FOR_THEM' as const, amount: 750, date },
    ];
    const plan = planSplitEntries(
      old,
      [{ counterpartyId: 'hua', kind: 'PAID_FOR_THEM', amount: 750 }],
      date,
    );
    expect(plan.remove).toEqual(old);
    expect(plan.create).toHaveLength(1);
  });
  it('replaces an entry when the same person changes kind', () => {
    const old = [
      { id: 'a', counterpartyId: 'ming', kind: 'PAID_FOR_THEM' as const, amount: 750, date },
    ];
    const plan = planSplitEntries(
      old,
      [{ counterpartyId: 'ming', kind: 'PAID_FOR_ME', amount: 750 }],
      date,
    );
    expect(plan.remove).toEqual(old);
    expect(plan.create[0]?.kind).toBe('PAID_FOR_ME');
  });
});

describe('composeSplitEntries', () => {
  const participants = [
    { counterpartyId: null },
    { counterpartyId: 'ming' },
    { counterpartyId: 'hua' },
  ];
  it.each([
    ['EXPENSE', null, 'PAID_FOR_THEM', 2],
    ['INCOME', null, 'RECEIVED_FOR_THEM', 2],
    ['EXPENSE', { counterpartyId: 'ming' }, 'PAID_FOR_ME', 1],
    ['INCOME', { counterpartyId: 'ming' }, 'RECEIVED_FOR_ME', 1],
  ] as const)('%s with payer %j creates %s', (type, payer, kind, count) => {
    const entries = composeSplitEntries({ type, payer, participants }, [100, 200, 300]);
    expect(entries).toHaveLength(count);
    expect(entries.every((entry) => entry.kind === kind)).toBe(true);
    expect(entries[0]?.amount).toBe(payer ? 100 : 200);
  });
});
