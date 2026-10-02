import { describe, expect, it } from 'vitest';
import { formatMoney, formatTransactionAmount } from './format';

/**
 * 帶貨幣符號的金額格式。
 *
 * 重點是以分作為輸入：整數元不帶小數、有零頭才顯示小數，並把「負號在 `$` 前面」
 * 釘住，避免帳戶餘額與交易列表有兩種寫法。
 */
describe('formatMoney', () => {
  it('formats a positive amount with a thousands separator', () => {
    expect(formatMoney(4_890_500)).toBe('$48,905');
    expect(formatMoney(33333)).toBe('$333.33');
    expect(formatMoney(50)).toBe('$0.50');
  });

  it('puts the minus sign before the dollar sign', () => {
    expect(formatMoney(-682_000)).toBe('-$6,820');
  });

  it('formats zero without a sign', () => {
    expect(formatMoney(0)).toBe('$0');
  });

  it('keeps small amounts without a separator', () => {
    expect(formatMoney(36_500)).toBe('$365');
    expect(formatMoney(-12_000)).toBe('-$120');
  });
});

/**
 * 交易金額的前綴（2i 從 TransactionList 與 HomePage 收攏到這裡）。釘住三種型別
 * 各自的寫法——e2e 用這個字串找列，改了它兩頁的測試都會跟著壞。
 */
describe('formatTransactionAmount', () => {
  it('prefixes expenses with a minus and incomes with a plus', () => {
    expect(formatTransactionAmount('EXPENSE', 12000)).toBe('-$120');
    expect(formatTransactionAmount('EXPENSE', 33333)).toBe('-$333.33');
    expect(formatTransactionAmount('INCOME', 500000)).toBe('+$5,000');
  });

  it('leaves transfers unsigned because no money was spent or earned', () => {
    expect(formatTransactionAmount('TRANSFER', 50000)).toBe('$500');
  });
});
