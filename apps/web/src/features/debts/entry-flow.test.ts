import type { DebtEntry, DebtEntryKind } from '@ledger/shared';
import { describe, expect, it } from 'vitest';
import { getDebtEntryFlow } from './entry-flow';

const CASES: {
  kind: DebtEntryKind;
  /** 實際 API 的正負號（debt-entry-rules.ts 的 DELTA_SIGN），不是任意值。 */
  delta: number;
  direction: 'theyOweMe' | 'iOweThem' | null;
  marker: 'none' | 'repay' | 'check';
  description: string;
}[] = [
  {
    kind: 'LEND',
    delta: 100_000,
    direction: 'theyOweMe',
    marker: 'none',
    description: '我借給小明 $1,000',
  },
  {
    kind: 'BORROW',
    delta: -12_300,
    direction: 'iOweThem',
    marker: 'none',
    description: '我向小明借 $123',
  },
  {
    kind: 'COLLECT',
    delta: -30_000,
    direction: 'theyOweMe',
    marker: 'repay',
    description: '小明還我 $300',
  },
  {
    kind: 'REPAY',
    delta: 40_000,
    direction: 'iOweThem',
    marker: 'repay',
    description: '我還小明 $400',
  },
  {
    kind: 'PAID_FOR_ME',
    delta: -50_000,
    direction: 'iOweThem',
    marker: 'none',
    description: '小明幫我付 $500',
  },
  {
    kind: 'PAID_FOR_THEM',
    delta: 50_000,
    direction: 'theyOweMe',
    marker: 'none',
    description: '我幫小明付 $500',
  },
  {
    kind: 'RECEIVED_FOR_ME',
    delta: 60_000,
    direction: 'theyOweMe',
    marker: 'none',
    description: '小明幫我代收 $600',
  },
  {
    kind: 'RECEIVED_FOR_THEM',
    delta: -65_000,
    direction: 'iOweThem',
    marker: 'none',
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
    settlesEntryId: null,
    difference: null,
    sync: 'NONE',
    paired: false,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
  };
}

/**
 * 逐一驗證 11 種紀錄的箭頭方向、圖示與完整說明：一般紀錄依 delta 正負號，
 * 還款依種類（delta 正負號與一般紀錄相反），調整紀錄不畫箭頭。
 */
describe('getDebtEntryFlow', () => {
  it.each(CASES)('$kind maps its direction, marker, and description', (testCase) => {
    expect(getDebtEntryFlow(makeEntry(testCase.kind, testCase.delta), '小明')).toEqual({
      direction: testCase.direction,
      marker: testCase.marker,
      description: testCase.description,
    });
  });

  it('derives normal-entry direction from the delta sign regardless of kind', () => {
    expect(getDebtEntryFlow(makeEntry('BORROW', 100), '小明').direction).toBe('theyOweMe');
    expect(getDebtEntryFlow(makeEntry('LEND', -100), '小明').direction).toBe('iOweThem');
  });

  it('keeps repayment direction on the kind even when the delta sign is inverted', () => {
    // 還款讓欠款變少，delta 正負號與一般紀錄相反：方向看種類，不看正負號。
    expect(getDebtEntryFlow(makeEntry('COLLECT', 100), '小明').direction).toBe('theyOweMe');
    expect(getDebtEntryFlow(makeEntry('REPAY', -100), '小明').direction).toBe('iOweThem');
  });
});
