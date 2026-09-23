import { describe, expect, it } from 'vitest';
import { formatMoney } from './format';

/**
 * 帶貨幣符號的金額格式。
 *
 * 重點是負號的位置：原本帳戶餘額直接拼成 `$-6,820`，與交易列表的 `-$120`
 * 寫法不一致。這裡把「負號在 `$` 前面」釘住，並確認千分位與零不受影響。
 */
describe('formatMoney', () => {
  it('formats a positive amount with a thousands separator', () => {
    expect(formatMoney(48905)).toBe('$48,905');
  });

  it('puts the minus sign before the dollar sign', () => {
    expect(formatMoney(-6820)).toBe('-$6,820');
  });

  it('formats zero without a sign', () => {
    expect(formatMoney(0)).toBe('$0');
  });

  it('keeps small amounts without a separator', () => {
    expect(formatMoney(365)).toBe('$365');
    expect(formatMoney(-120)).toBe('-$120');
  });
});
