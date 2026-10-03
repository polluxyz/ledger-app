/**
 * 分帳份額計算的契約測試（3c，SC-S5）。
 *
 * 策略：spec §3.4 的表格逐列抄成案例（金額已換成分），再補邊界——吸收者三種情況、
 * 名單不合法、加總不符、份額 ≤ 0、四捨五入剛好 .5 的情況。自動調整另一組，
 * 用決策 94 的例子（3 人、我 20% → 其他人各 40%）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeSplitShares, fillRemainingShares } from './split-shares.ts';

const ME = null;
const MING = 'ming';
const HUA = 'hua';
const MEI = 'mei';

function people(...ids: Array<string | null>) {
  return ids.map((counterpartyId) => ({ counterpartyId }));
}

describe('computeSplitShares：spec §3.4 的表格', () => {
  it('1,000 元、我付、3 人均分、精度分 → 333.33、333.33、我 333.34', () => {
    assert.deepEqual(
      computeSplitShares({
        total: 100000,
        method: 'EQUAL',
        payerCounterpartyId: ME,
        participants: people(MING, HUA, ME),
      }),
      { ok: true, shares: [33333, 33333, 33334] },
    );
  });

  it('1,000 元、我付、3 人均分、精度元 → 333、333、我 334', () => {
    assert.deepEqual(
      computeSplitShares({
        total: 100000,
        method: 'EQUAL',
        precision: 'YUAN',
        payerCounterpartyId: ME,
        participants: people(MING, HUA, ME),
      }),
      { ok: true, shares: [33300, 33300, 33400] },
    );
  });

  it('2,000 元、我付、3 人均分、精度元 → 667、667、我 666', () => {
    assert.deepEqual(
      computeSplitShares({
        total: 200000,
        method: 'EQUAL',
        precision: 'YUAN',
        payerCounterpartyId: ME,
        participants: people(MING, HUA, ME),
      }),
      { ok: true, shares: [66700, 66700, 66600] },
    );
  });

  it('3,000 元、小明付、我 20%、小明 40%、小華 40% → 我 600、小明 1,200、小華 1,200', () => {
    assert.deepEqual(
      computeSplitShares({
        total: 300000,
        method: 'RATIO',
        payerCounterpartyId: MING,
        participants: [
          { counterpartyId: ME, ratio: 2000 },
          { counterpartyId: MING, ratio: 4000 },
          { counterpartyId: HUA, ratio: 4000 },
        ],
      }),
      { ok: true, shares: [60000, 120000, 120000] },
    );
  });

  it('0.02 元、3 人均分 → SPLIT_SHARE_NOT_POSITIVE', () => {
    assert.deepEqual(
      computeSplitShares({
        total: 2,
        method: 'EQUAL',
        payerCounterpartyId: ME,
        participants: people(MING, HUA, ME),
      }),
      { ok: false, error: 'SPLIT_SHARE_NOT_POSITIVE' },
    );
  });
});

describe('computeSplitShares：晚餐 3,000 元 4 人均分', () => {
  it('每人 750', () => {
    assert.deepEqual(
      computeSplitShares({
        total: 300000,
        method: 'EQUAL',
        payerCounterpartyId: ME,
        participants: people(ME, MING, HUA, MEI),
      }),
      { ok: true, shares: [75000, 75000, 75000, 75000] },
    );
  });
});

describe('computeSplitShares：吸收者（決策 92）', () => {
  const base = { total: 1000, method: 'EQUAL' as const, precision: 'YUAN' as const };

  it('付款人有參加 → 付款人吸收', () => {
    // 10 元 3 人：其他人四捨五入到元是 3 元，付款人小明拿剩下的 4 元。
    assert.deepEqual(
      computeSplitShares({
        ...base,
        payerCounterpartyId: MING,
        participants: people(ME, MING, HUA),
      }),
      { ok: true, shares: [300, 400, 300] },
    );
  });

  it('付款人沒參加、我有參加 → 我吸收', () => {
    assert.deepEqual(
      computeSplitShares({
        ...base,
        payerCounterpartyId: MEI,
        participants: people(MING, ME, HUA),
      }),
      { ok: true, shares: [300, 400, 300] },
    );
  });

  it('付款人和我都沒參加 → 名單第一位吸收', () => {
    assert.deepEqual(
      computeSplitShares({
        ...base,
        payerCounterpartyId: ME,
        participants: people(HUA, MING, MEI),
      }),
      { ok: true, shares: [400, 300, 300] },
    );
  });
});

describe('computeSplitShares：四捨五入', () => {
  it('剛好 .5 進位，吸收者補差額（可能比別人少）', () => {
    // 1.50 元 4 人、精度分：37.5 分 → 其他人 38，吸收者（我）150 − 114 = 36。
    assert.deepEqual(
      computeSplitShares({
        total: 150,
        method: 'EQUAL',
        payerCounterpartyId: ME,
        participants: people(MING, HUA, MEI, ME),
      }),
      { ok: true, shares: [38, 38, 38, 36] },
    );
  });

  it('比例 33.33% × 3 不等於 100% → SPLIT_SUM_MISMATCH', () => {
    assert.deepEqual(
      computeSplitShares({
        total: 100000,
        method: 'RATIO',
        payerCounterpartyId: ME,
        participants: [
          { counterpartyId: ME, ratio: 3333 },
          { counterpartyId: MING, ratio: 3333 },
          { counterpartyId: HUA, ratio: 3333 },
        ],
      }),
      { ok: false, error: 'SPLIT_SUM_MISMATCH' },
    );
  });

  it('比例 33.34% + 33.33% + 33.33%：1,000 元的 33.33% 是 333.30，吸收者（我）拿 333.40', () => {
    assert.deepEqual(
      computeSplitShares({
        total: 100000,
        method: 'RATIO',
        payerCounterpartyId: ME,
        participants: [
          { counterpartyId: ME, ratio: 3334 },
          { counterpartyId: MING, ratio: 3333 },
          { counterpartyId: HUA, ratio: 3333 },
        ],
      }),
      { ok: true, shares: [33340, 33330, 33330] },
    );
  });

  it('總額上限 × 比例不溢位', () => {
    const result = computeSplitShares({
      total: 2_000_000_000,
      method: 'RATIO',
      payerCounterpartyId: ME,
      participants: [
        { counterpartyId: ME, ratio: 1 },
        { counterpartyId: MING, ratio: 9999 },
      ],
    });
    assert.deepEqual(result, { ok: true, shares: [200000, 1_999_800_000] });
  });
});

describe('computeSplitShares：自訂金額', () => {
  it('加總等於總額 → 照給的值', () => {
    assert.deepEqual(
      computeSplitShares({
        total: 300000,
        method: 'AMOUNT',
        payerCounterpartyId: ME,
        participants: [
          { counterpartyId: ME, amount: 100000 },
          { counterpartyId: MING, amount: 100000 },
          { counterpartyId: HUA, amount: 100000 },
        ],
      }),
      { ok: true, shares: [100000, 100000, 100000] },
    );
  });

  it('加總不符 → SPLIT_SUM_MISMATCH', () => {
    assert.deepEqual(
      computeSplitShares({
        total: 300000,
        method: 'AMOUNT',
        payerCounterpartyId: ME,
        participants: [
          { counterpartyId: ME, amount: 100000 },
          { counterpartyId: MING, amount: 100000 },
        ],
      }),
      { ok: false, error: 'SPLIT_SUM_MISMATCH' },
    );
  });

  it('有人是 0 → SPLIT_SHARE_NOT_POSITIVE', () => {
    assert.deepEqual(
      computeSplitShares({
        total: 300000,
        method: 'AMOUNT',
        payerCounterpartyId: ME,
        participants: [
          { counterpartyId: ME, amount: 300000 },
          { counterpartyId: MING, amount: 0 },
        ],
      }),
      { ok: false, error: 'SPLIT_SHARE_NOT_POSITIVE' },
    );
  });
});

describe('computeSplitShares：名單不合法 → SPLIT_PARTICIPANTS_INVALID', () => {
  const cases: Array<[string, Parameters<typeof computeSplitShares>[0]]> = [
    ['空名單', { total: 100, method: 'EQUAL', payerCounterpartyId: ME, participants: [] }],
    [
      '同一人兩次',
      { total: 100, method: 'EQUAL', payerCounterpartyId: ME, participants: people(MING, MING) },
    ],
    [
      '我兩次',
      { total: 100, method: 'EQUAL', payerCounterpartyId: ME, participants: people(ME, ME) },
    ],
    [
      '自訂金額少給一個值',
      {
        total: 100,
        method: 'AMOUNT',
        payerCounterpartyId: ME,
        participants: [{ counterpartyId: ME, amount: 100 }, { counterpartyId: MING }],
      },
    ],
    [
      '比例超過 10000',
      {
        total: 100,
        method: 'RATIO',
        payerCounterpartyId: ME,
        participants: [
          { counterpartyId: ME, ratio: 10001 },
          { counterpartyId: MING, ratio: 0 },
        ],
      },
    ],
    [
      '金額不是整數',
      {
        total: 100,
        method: 'AMOUNT',
        payerCounterpartyId: ME,
        participants: [
          { counterpartyId: ME, amount: 50.5 },
          { counterpartyId: MING, amount: 49.5 },
        ],
      },
    ],
  ];
  for (const [name, input] of cases) {
    it(name, () => {
      assert.deepEqual(computeSplitShares(input), {
        ok: false,
        error: 'SPLIT_PARTICIPANTS_INVALID',
      });
    });
  }
});

describe('fillRemainingShares：自動調整（決策 94）', () => {
  it('3 人、比例、我固定 20% → 其他人各 40%', () => {
    assert.deepEqual(
      fillRemainingShares({
        total: 300000,
        method: 'RATIO',
        payerCounterpartyId: ME,
        participants: [
          { counterpartyId: ME, value: 2000 },
          { counterpartyId: MING },
          { counterpartyId: HUA },
        ],
      }),
      { values: [2000, 4000, 4000], remainder: 0 },
    );
  });

  it('3 人、金額、小華固定 1,000 → 剩下 2,000 由我與小明平分', () => {
    assert.deepEqual(
      fillRemainingShares({
        total: 300000,
        method: 'AMOUNT',
        payerCounterpartyId: ME,
        participants: [
          { counterpartyId: ME },
          { counterpartyId: MING },
          { counterpartyId: HUA, value: 100000 },
        ],
      }),
      { values: [100000, 100000, 100000], remainder: 0 },
    );
  });

  it('比例除不盡：剩下 100% 給 3 人 → 吸收者（付款人小明）拿零頭', () => {
    assert.deepEqual(
      fillRemainingShares({
        total: 0,
        method: 'RATIO',
        payerCounterpartyId: MING,
        participants: [{ counterpartyId: ME }, { counterpartyId: MING }, { counterpartyId: HUA }],
      }),
      { values: [3333, 3334, 3333], remainder: 0 },
    );
  });

  it('付款人已固定 → 沒固定的人裡，我吸收', () => {
    assert.deepEqual(
      fillRemainingShares({
        total: 1000,
        method: 'AMOUNT',
        precision: 'YUAN',
        payerCounterpartyId: MING,
        participants: [
          { counterpartyId: MING, value: 100 },
          { counterpartyId: HUA },
          { counterpartyId: ME },
          { counterpartyId: MEI },
        ],
      }),
      { values: [100, 300, 300, 300], remainder: 0 },
    );
  });

  it('全部都固定且不足 → remainder 是還差的量', () => {
    assert.deepEqual(
      fillRemainingShares({
        total: 300000,
        method: 'AMOUNT',
        payerCounterpartyId: ME,
        participants: [
          { counterpartyId: ME, value: 100000 },
          { counterpartyId: MING, value: 100000 },
        ],
      }),
      { values: [100000, 100000], remainder: 100000 },
    );
  });

  it('固定的值超過 → 沒固定的人給 0、remainder 是負的', () => {
    assert.deepEqual(
      fillRemainingShares({
        total: 0,
        method: 'RATIO',
        payerCounterpartyId: ME,
        participants: [{ counterpartyId: ME, value: 11500 }, { counterpartyId: MING }],
      }),
      { values: [11500, 0], remainder: -1500 },
    );
  });
});
