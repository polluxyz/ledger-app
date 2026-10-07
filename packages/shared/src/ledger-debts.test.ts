/**
 * 共享帳本欠款併進借還的純函式（3f）。
 *
 * 策略：`resolvePointer` 逐一核對決策 148 的四種情況（自動、改指、明確不指向、虛擬成員）。
 * `myLedgerAmounts` 與 `mergeTotals` 的測試由 uf-shared 補在下方。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolvePointer } from './ledger-debts.ts';

const MING_USER = 'user-ming';
const MING_COUNTERPARTY = 'cp-ming';
const LANDLORD = 'cp-landlord';
const linked = new Map([[MING_USER, MING_COUNTERPARTY]]);

describe('resolvePointer：決策 148', () => {
  it('沒有設定、帳號符合連動對象 → 自動指向那個對象', () => {
    assert.deepEqual(
      resolvePointer({
        explicit: undefined,
        personUserId: MING_USER,
        linkedCounterpartyByUserId: linked,
      }),
      { counterpartyId: MING_COUNTERPARTY, auto: true },
    );
  });

  it('沒有設定、帳號沒有連動對象 → 不指向（仍算自動）', () => {
    assert.deepEqual(
      resolvePointer({
        explicit: undefined,
        personUserId: 'user-hua',
        linkedCounterpartyByUserId: linked,
      }),
      { counterpartyId: null, auto: true },
    );
  });

  it('虛擬成員沒有帳號 → 不指向', () => {
    assert.deepEqual(
      resolvePointer({
        explicit: undefined,
        personUserId: null,
        linkedCounterpartyByUserId: linked,
      }),
      { counterpartyId: null, auto: true },
    );
  });

  it('明確改指別的對象，蓋過自動指向', () => {
    assert.deepEqual(
      resolvePointer({
        explicit: LANDLORD,
        personUserId: MING_USER,
        linkedCounterpartyByUserId: linked,
      }),
      { counterpartyId: LANDLORD, auto: false },
    );
  });

  it('明確「不指向」，蓋過自動指向', () => {
    assert.deepEqual(
      resolvePointer({
        explicit: null,
        personUserId: MING_USER,
        linkedCounterpartyByUserId: linked,
      }),
      { counterpartyId: null, auto: false },
    );
  });
});
