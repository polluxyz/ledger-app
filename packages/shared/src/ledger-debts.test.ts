/**
 * 共享帳本欠款併進借還的純函式（3f）。
 *
 * 策略：`resolvePointer` 逐一核對決策 148 的四種情況（自動、改指、明確不指向、虛擬成員）。
 * `myLedgerAmounts` 與 `mergeTotals` 的測試由 uf-shared 補在下方。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mergeTotals, myLedgerAmounts, resolvePointer } from './ledger-debts.ts';

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

/** 驗證共享帳本結清轉帳如何換成我的角度，並逐筆加進個人往來總額。 */
describe('myLedgerAmounts：決策 142', () => {
  it('花蓮三日只收錄跟我有關的轉帳', () => {
    assert.deepEqual(
      myLedgerAmounts(
        [
          { fromPersonId: '小華', toPersonId: 'me', amount: 139400 },
          { fromPersonId: '小明', toPersonId: 'me', amount: 51200 },
          { fromPersonId: '小明', toPersonId: '小美', amount: 40000 },
          { fromPersonId: '小明', toPersonId: '阿美', amount: 20000 },
        ],
        'me',
      ),
      new Map([
        ['小華', 139400],
        ['小明', 51200],
      ]),
    );
  });

  it('我付給某人時以負數記錄', () => {
    assert.deepEqual(
      myLedgerAmounts([{ fromPersonId: 'me', toPersonId: '小華', amount: 35000 }], 'me'),
      new Map([['小華', -35000]]),
    );
  });

  it('同一個人一收一付抵銷為 0 時不放進結果', () => {
    assert.deepEqual(
      myLedgerAmounts(
        [
          { fromPersonId: '小明', toPersonId: 'me', amount: 12000 },
          { fromPersonId: 'me', toPersonId: '小明', amount: 12000 },
        ],
        'me',
      ),
      new Map(),
    );
  });

  it('同一個人的多筆轉帳相加', () => {
    assert.deepEqual(
      myLedgerAmounts(
        [
          { fromPersonId: '小明', toPersonId: 'me', amount: 12000 },
          { fromPersonId: '小明', toPersonId: 'me', amount: 20000 },
        ],
        'me',
      ),
      new Map([['小明', 32000]]),
    );
  });

  it('沒有轉帳時回傳空 Map', () => {
    assert.deepEqual(myLedgerAmounts([], 'me'), new Map());
  });
});

/** 驗證個人往來餘額與各共享帳本來源以整數分加總。 */
describe('mergeTotals：決策 143', () => {
  it('合併 SC-F1 明哥的個人往來與帳本金額', () => {
    assert.equal(mergeTotals(50000, [{ amount: 51200 }]), 101200);
  });

  it('沒有帳本來源時回傳原往來餘額', () => {
    assert.equal(mergeTotals(50000, []), 50000);
  });

  it('正負帳本來源會相加', () => {
    assert.equal(mergeTotals(50000, [{ amount: 51200 }, { amount: -20000 }]), 81200);
  });
});
