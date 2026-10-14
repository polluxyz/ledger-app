/**
 * 沒有分類的交易名稱（3h 決策 162、171、175）。
 *
 * 策略：把 `entry-labels.ts` 註解裡的對照表逐格斷言，另外確認不該有名稱的型別回 `null`，
 * 免得畫面把一般還款或借出也標成「少收」。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { differenceLabelOf, forgivenessLabelOf } from './entry-labels.ts';

describe('differenceLabelOf', () => {
  it('names the difference under a collection', () => {
    assert.equal(differenceLabelOf('COLLECT', 'EXPENSE'), '少收');
    assert.equal(differenceLabelOf('COLLECT', 'INCOME'), '多收');
  });

  it('names the difference under a repayment I made', () => {
    assert.equal(differenceLabelOf('REPAY', 'EXPENSE'), '多付');
    assert.equal(differenceLabelOf('REPAY', 'INCOME'), '少付');
  });

  it('returns null for types that never carry a difference', () => {
    for (const type of ['LEND', 'BORROW', 'EXPENSE', 'INCOME', 'TRANSFER'] as const) {
      assert.equal(differenceLabelOf(type, 'EXPENSE'), null);
    }
  });
});

describe('forgivenessLabelOf', () => {
  it('names both sides of a forgiveness', () => {
    assert.equal(forgivenessLabelOf('FORGIVE'), '呆帳');
    assert.equal(forgivenessLabelOf('FORGIVEN'), '債務免除');
  });

  it('returns null for other kinds', () => {
    for (const kind of ['LEND', 'COLLECT', 'SETTLEMENT', 'PAID_FOR_ME'] as const) {
      assert.equal(forgivenessLabelOf(kind), null);
    }
  });
});
