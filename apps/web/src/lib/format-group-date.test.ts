import { describe, expect, it } from 'vitest';
import { formatGroupDate } from './format';

/**
 * `formatGroupDate` 產生交易列表的日期分組標題。
 *
 * 這個 suite 釘三件事：月與日不補零、星期對得上、跨月與跨年不會算錯。
 * 日期字串刻意不帶 `Z`——不帶時區的字串一律以**本地時間**解讀，測試才不會
 * 因為跑在哪個時區而得到前一天。
 */
describe('formatGroupDate', () => {
  it('names the weekday of a Sunday', () => {
    expect(formatGroupDate('2026-08-16T12:00:00')).toBe('8月16日 星期日');
  });

  it('does not pad the month or the day', () => {
    // 標題是給人掃視的，`9月1日` 比 `09月01日` 好讀。
    expect(formatGroupDate('2026-09-01T09:30:00')).toBe('9月1日 星期二');
  });

  it('handles the last day of the year', () => {
    expect(formatGroupDate('2026-12-31T23:00:00')).toBe('12月31日 星期四');
  });
});
