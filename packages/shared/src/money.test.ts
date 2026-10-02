/**
 * 金額換算的契約測試（3c-0，SC-M7）。
 *
 * 策略：每個函式用一張「輸入 → 預期」表逐列斷言，表裡的值直接抄自 `money.ts` 的
 * 註解與 spec §4，所以註解改了這裡也要跟著改。另外針對浮點數的經典陷阱
 * （`0.1 + 0.2`、`0.29 * 100`）各放一列，證明解析沒有經過浮點數。
 *
 * 用 Node 內建的 test runner（`node:test`），shared 不另外裝測試套件（plan §1）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_AMOUNT_CENTS,
  MAX_INITIAL_BALANCE_CENTS,
  centsToInput,
  formatAmount,
  formatMoney,
  parseMoneyInput,
} from './money.ts';

describe('formatAmount', () => {
  const cases: Array<[number, string]> = [
    [300000, '3,000'],
    [33333, '333.33'],
    [50, '0.50'],
    [5, '0.05'],
    [0, '0'],
    [-120000, '1,200'],
    [123456789, '1,234,567.89'],
    [MAX_AMOUNT_CENTS, '20,000,000'],
  ];
  for (const [cents, expected] of cases) {
    it(`${cents} → ${expected}`, () => {
      assert.equal(formatAmount(cents), expected);
    });
  }
});

describe('formatMoney', () => {
  const cases: Array<[number, string]> = [
    [33333, '$333.33'],
    [300000, '$3,000'],
    [-120000, '-$1,200'],
    [-33, '-$0.33'],
    [0, '$0'],
    [4_000_000_000, '$40,000,000'],
  ];
  for (const [cents, expected] of cases) {
    it(`${cents} → ${expected}`, () => {
      assert.equal(formatMoney(cents), expected);
    });
  }
});

describe('centsToInput', () => {
  const cases: Array<[number, string]> = [
    [33333, '333.33'],
    [300000, '3000'],
    [50, '0.5'],
    [5, '0.05'],
    [0, '0'],
    [-120000, '-1200'],
    [-33, '-0.33'],
  ];
  for (const [cents, expected] of cases) {
    it(`${cents} → ${expected}`, () => {
      assert.equal(centsToInput(cents), expected);
    });
  }

  it('centsToInput 的結果再 parse 回來會得到原值', () => {
    for (const cents of [0, 1, 5, 50, 99, 100, 33333, 300000, 123456789]) {
      assert.equal(parseMoneyInput(centsToInput(cents)), cents);
    }
    assert.equal(parseMoneyInput(centsToInput(-33), { allowNegative: true }), -33);
  });
});

describe('parseMoneyInput', () => {
  const valid: Array<[string, number]> = [
    ['333.33', 33333],
    ['3000', 300000],
    ['0.5', 50],
    ['0.05', 5],
    ['1,200', 120000],
    ['1,234,567.89', 123456789],
    ['  42  ', 4200],
    ['0', 0],
    ['007', 700],
    // 浮點數陷阱：parseFloat('0.29') * 100 = 28.999999999999996
    ['0.29', 29],
    ['0.3', 30],
    ['1.1', 110],
    ['20000000', MAX_AMOUNT_CENTS],
  ];
  for (const [text, expected] of valid) {
    it(`"${text}" → ${expected}`, () => {
      assert.equal(parseMoneyInput(text), expected);
    });
  }

  const invalid = [
    '',
    '   ',
    'abc',
    '1.234',
    '.5',
    '5.',
    '1.2.3',
    '--5',
    '+5',
    '1e3',
    '١٢٣',
    '12a',
    '$100',
  ];
  for (const text of invalid) {
    it(`"${text}" → null`, () => {
      assert.equal(parseMoneyInput(text), null);
    });
  }

  it('負數預設不接受', () => {
    assert.equal(parseMoneyInput('-5'), null);
    assert.equal(parseMoneyInput('-5', { allowNegative: false }), null);
  });

  it('allowNegative 時接受負數（帳戶期初餘額）', () => {
    assert.equal(parseMoneyInput('-5', { allowNegative: true }), -500);
    assert.equal(parseMoneyInput('-1,200.5', { allowNegative: true }), -120050);
    assert.equal(parseMoneyInput('-0.33', { allowNegative: true }), -33);
  });

  it('超出安全整數範圍 → null', () => {
    assert.equal(parseMoneyInput('99999999999999999'), null);
  });
});

describe('上下限常數', () => {
  it('2,000 萬元，且在 int4 範圍內', () => {
    assert.equal(MAX_AMOUNT_CENTS, 2_000_000_000);
    assert.equal(MAX_INITIAL_BALANCE_CENTS, 2_000_000_000);
    assert.ok(MAX_AMOUNT_CENTS <= 2_147_483_647);
  });
});
