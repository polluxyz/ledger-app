/**
 * 共享帳本淨額與結清建議的契約測試（3e，SC-E16）。
 *
 * 策略：先用「花蓮三日」逐筆核對淨額，再檢查收入與結清方向；結清建議涵蓋 §3.3、SC-E9、
 * 同額建立順序、零淨額、筆數上限與不平衡輸入。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeLedgerNets, suggestSettlements } from './ledger-settlement.ts';

const ME = 'me';
const MING = 'ming';
const HUA = 'hua';
const MEI = 'mei';

describe('computeLedgerNets：spec §3.2', () => {
  it('花蓮三日三筆支出得到我 +305,000、小明 −100,000、小華 −205,000 分', () => {
    const nets = computeLedgerNets({
      personIds: [ME, MING, HUA, 'unused'],
      entries: [
        {
          kind: 'EXPENSE',
          payerId: ME,
          total: 600000,
          shares: [
            { personId: ME, share: 200000 },
            { personId: MING, share: 200000 },
            { personId: HUA, share: 200000 },
          ],
        },
        {
          kind: 'EXPENSE',
          payerId: MING,
          total: 150000,
          shares: [
            { personId: ME, share: 50000 },
            { personId: MING, share: 50000 },
            { personId: HUA, share: 50000 },
          ],
        },
        {
          kind: 'EXPENSE',
          payerId: HUA,
          total: 90000,
          shares: [
            { personId: ME, share: 45000 },
            { personId: HUA, share: 45000 },
          ],
        },
      ],
    });

    assert.deepEqual(
      nets,
      new Map([
        [ME, 305000],
        [MING, -100000],
        [HUA, -205000],
        ['unused', 0],
      ]),
    );
    assert.equal(
      [...nets.values()].reduce((sum, net) => sum + net, 0),
      0,
    );
  });

  it('收入分帳方向與支出相反', () => {
    assert.deepEqual(
      computeLedgerNets({
        personIds: [ME, MING, HUA],
        entries: [
          {
            kind: 'INCOME',
            payerId: ME,
            total: 100000,
            shares: [
              { personId: MING, share: 60000 },
              { personId: HUA, share: 40000 },
            ],
          },
        ],
      }),
      new Map([
        [ME, -100000],
        [MING, 60000],
        [HUA, 40000],
      ]),
    );
  });

  it('結清讓付款人淨額增加、收款人淨額減少', () => {
    assert.deepEqual(
      computeLedgerNets({
        personIds: [ME, MING, HUA],
        entries: [{ kind: 'SETTLEMENT', fromId: MING, toId: ME, amount: 42000 }],
      }),
      new Map([
        [ME, -42000],
        [MING, 42000],
        [HUA, 0],
      ]),
    );
  });

  it('交易出現但不在 personIds 的人依首次出現順序加到最後，且總和仍為 0', () => {
    const nets = computeLedgerNets({
      personIds: ['known'],
      entries: [{ kind: 'SETTLEMENT', fromId: 'outside-a', toId: 'outside-b', amount: 125 }],
    });

    assert.deepEqual(
      nets,
      new Map([
        ['known', 0],
        ['outside-a', 125],
        ['outside-b', -125],
      ]),
    );
    assert.equal(
      [...nets.values()].reduce((sum, net) => sum + net, 0),
      0,
    );
  });
});

describe('suggestSettlements：spec §3.3 與 SC-E16', () => {
  it('照 §3.3 的三人淨額產生兩筆結清', () => {
    assert.deepEqual(
      suggestSettlements([
        { personId: ME, net: 305000 },
        { personId: MING, net: -100000 },
        { personId: HUA, net: -205000 },
      ]),
      [
        { fromPersonId: HUA, toPersonId: ME, amount: 205000 },
        { fromPersonId: MING, toPersonId: ME, amount: 100000 },
      ],
    );
  });

  it('照 SC-E9 依序結清小華→我、小明→我、小明→阿美，且筆數不超過淨額人數減一', () => {
    const nets = [
      { personId: ME, net: 265000 },
      { personId: MING, net: -100000 },
      { personId: HUA, net: -205000 },
      { personId: MEI, net: 40000 },
    ];
    const suggestions = suggestSettlements(nets);

    assert.deepEqual(suggestions, [
      { fromPersonId: HUA, toPersonId: ME, amount: 205000 },
      { fromPersonId: MING, toPersonId: ME, amount: 60000 },
      { fromPersonId: MING, toPersonId: MEI, amount: 40000 },
    ]);
    assert.ok(suggestions.length <= nets.filter(({ net }) => net !== 0).length - 1);
  });

  it('全部淨額是 0 時回傳空陣列', () => {
    assert.deepEqual(
      suggestSettlements([
        { personId: ME, net: 0 },
        { personId: MING, net: 0 },
      ]),
      [],
    );
  });

  it('同額的付款人與收款人都依輸入建立順序排序', () => {
    assert.deepEqual(
      suggestSettlements([
        { personId: 'debtor-first', net: -100 },
        { personId: 'creditor-first', net: 100 },
        { personId: 'debtor-second', net: -100 },
        { personId: 'creditor-second', net: 100 },
      ]),
      [
        { fromPersonId: 'debtor-first', toPersonId: 'creditor-first', amount: 100 },
        { fromPersonId: 'debtor-second', toPersonId: 'creditor-second', amount: 100 },
      ],
    );
  });

  it('淨額總和不為 0 時丟出程式錯誤', () => {
    assert.throws(
      () =>
        suggestSettlements([
          { personId: ME, net: 100 },
          { personId: MING, net: -50 },
        ]),
      Error,
    );
  });
});
