import { taipeiDatePeriod, taipeiMonthPeriod, taipeiMonths } from './taipei-period';

/** 用精確 UTC 邊界驗證台灣曆日；同一組測試會在不同 TZ 執行。 */
describe('Taipei periods', () => {
  it('keeps October 31 23:30 in October and November 1 00:10 in November', () => {
    const october = taipeiMonthPeriod('2026-10');
    expect(october.start.toISOString()).toBe('2026-09-30T16:00:00.000Z');
    expect(october.end.toISOString()).toBe('2026-10-31T16:00:00.000Z');
    expect(new Date('2026-10-31T23:30:00+08:00') < october.end).toBe(true);
    expect(new Date('2026-11-01T00:10:00+08:00') < october.end).toBe(false);
    expect(taipeiMonthPeriod('2026-11').start).toEqual(october.end);
  });

  it('accepts one day, a leap day, and an inclusive 366-day year', () => {
    expect(taipeiDatePeriod('2028-02-29', '2028-02-29')).toEqual({
      start: new Date('2028-02-28T16:00:00Z'),
      end: new Date('2028-02-29T16:00:00Z'),
    });
    const leapYear = taipeiDatePeriod('2028-01-01', '2028-12-31');
    expect(leapYear.end.getTime() - leapYear.start.getTime()).toBe(366 * 86400000);
    expect(taipeiDatePeriod('2026-10-31', '2026-11-01').end.toISOString()).toBe(
      '2026-11-01T16:00:00.000Z',
    );
  });

  it.each([
    ['2028-01-01', '2029-01-01'],
    ['2026-11-01', '2026-10-31'],
    ['2026-02-30', '2026-03-01'],
    ['2027-02-29', '2027-03-01'],
    ['2026-2-01', '2026-02-02'],
    ['2026-02-01T00:00:00Z', '2026-02-02'],
    ['', '2026-02-02'],
    ['0000-01-01', '0000-01-01'],
    ['2026-13-01', '2026-13-02'],
    ['2026-01-00', '2026-01-01'],
    ['2026-01-01', '2026-02-30'],
  ])('rejects invalid inclusive dates %s to %s', (from, to) => {
    expect(() => taipeiDatePeriod(from, to)).toThrow(RangeError);
  });

  it('lists complete months across a year and preserves four-digit years', () => {
    const months = taipeiMonths('2026-10');
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2025-11');
    expect(months[11]).toBe('2026-10');
    expect(taipeiMonths('2026-01', 2)).toEqual(['2025-12', '2026-01']);
    expect(taipeiMonths('2028-02', 1)).toEqual(['2028-02']);
    expect(taipeiMonths('0099-01', 1)).toEqual(['0099-01']);
    expect(taipeiMonthPeriod('2028-02').end.toISOString()).toBe('2028-02-29T16:00:00.000Z');
    expect(taipeiMonths('2026-10', 24)).toHaveLength(24);
  });

  it.each(['2026-00', '2026-13', '2026-1', '2026-01-01', '', '0000-01', 'junk'])(
    'rejects invalid month %s',
    (month) => {
      expect(() => taipeiMonthPeriod(month)).toThrow(RangeError);
      expect(() => taipeiMonths(month)).toThrow(RangeError);
    },
  );

  it.each([0, 25, 1.5, NaN, Infinity])('rejects invalid month count %s', (count) => {
    expect(() => taipeiMonths('2026-10', count)).toThrow(RangeError);
  });

  it('rejects month lists preceding the supported calendar', () => {
    expect(() => taipeiMonths('0001-01', 2)).toThrow(RangeError);
  });
});
