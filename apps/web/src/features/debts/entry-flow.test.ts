import type { DebtEntry, DebtEntryKind } from '@ledger/shared';
import { describe, expect, it } from 'vitest';
import { getDebtEntryFlow } from './entry-flow';

const CASES: {
  kind: DebtEntryKind;
  delta: number;
  direction: 'toThem' | 'toMe' | null;
  marker: 'none' | 'repay' | 'paidFor' | 'check';
  description: string;
}[] = [
  {
    kind: 'LEND',
    delta: 100_000,
    direction: 'toThem',
    marker: 'none',
    description: '我借小明 $1,000',
  },
  {
    kind: 'BORROW',
    delta: 12_300,
    direction: 'toThem',
    marker: 'none',
    description: '我向小明借 $123',
  },
  {
    kind: 'COLLECT',
    delta: -30_000,
    direction: 'toMe',
    marker: 'repay',
    description: '小明還我 $300',
  },
  {
    kind: 'REPAY',
    delta: -40_000,
    direction: 'toMe',
    marker: 'repay',
    description: '我還小明 $400',
  },
  {
    kind: 'PAID_FOR_ME',
    delta: 50_000,
    direction: 'toThem',
    marker: 'paidFor',
    description: '小明幫我付 $500',
  },
  {
    kind: 'PAID_FOR_THEM',
    delta: -50_000,
    direction: 'toMe',
    marker: 'paidFor',
    description: '我幫小明付 $500',
  },
  {
    kind: 'RECEIVED_FOR_ME',
    delta: -60_000,
    direction: 'toMe',
    marker: 'paidFor',
    description: '小明幫我代收 $600',
  },
  {
    kind: 'RECEIVED_FOR_THEM',
    delta: 65_000,
    direction: 'toThem',
    marker: 'paidFor',
    description: '我幫小明代收 $650',
  },
  {
    kind: 'SETTLEMENT',
    delta: 7_000,
    direction: null,
    marker: 'check',
    description: '我和小明結清差額 $70',
  },
  {
    kind: 'FORGIVE',
    delta: -400,
    direction: null,
    marker: 'check',
    description: '我免除小明欠我的 $4',
  },
  {
    kind: 'FORGIVEN',
    delta: 800,
    direction: null,
    marker: 'check',
    description: '小明免除我欠的款項 $8',
  },
];

function makeEntry(kind: DebtEntryKind, delta: number): DebtEntry {
  return {
    id: 'entry-1',
    counterpartyId: 'counterparty-1',
    kind,
    delta,
    date: '2026-09-20',
    note: null,
    transactionId: null,
    splitId: null,
    sync: 'NONE',
    paired: false,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
  };
}

/** 逐一驗證 11 種紀錄的標記與完整說明，並用刻意不同於種類慣例的正負號驗方向。 */
describe('getDebtEntryFlow', () => {
  it.each(CASES)('$kind maps its marker, description, and delta direction', (testCase) => {
    expect(getDebtEntryFlow(makeEntry(testCase.kind, testCase.delta), '小明')).toEqual({
      direction: testCase.direction,
      marker: testCase.marker,
      description: testCase.description,
    });
  });

  it('uses delta sign for flow entries regardless of kind', () => {
    expect(getDebtEntryFlow(makeEntry('BORROW', 100), '小明').direction).toBe('toThem');
    expect(getDebtEntryFlow(makeEntry('LEND', -100), '小明').direction).toBe('toMe');
  });
});
