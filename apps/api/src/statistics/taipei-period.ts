/** 台灣曆日固定使用 +08:00；全程用 UTC 運算，避免主機時區與日光節約時間介入。 */
export interface TaipeiPeriod {
  start: Date;
  end: Date;
}

const DAY_MS = 86_400_000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function calendarDate(year: number, month: number, day: number): Date {
  const result = new Date(0);
  // Date.UTC 會將 0～99 年當成 1900～1999，明確指定完整年份才能驗證四位年份。
  result.setUTCFullYear(year, month - 1, day);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('Expected YYYY-MM-DD');
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = calendarDate(year, month, day);
  if (
    year < 1 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError('Invalid Taipei calendar date');
  }
  return date;
}

function parseMonth(value: string): Date {
  if (!/^\d{4}-\d{2}$/.test(value)) throw new RangeError('Expected YYYY-MM');
  return parseDate(`${value}-01`);
}

/** 起訖日皆包含，最多 366 日；格式、曆日、順序或長度無效時拋 RangeError，供 DTO 轉成 400。 */
export function taipeiDatePeriod(from: string, to: string): TaipeiPeriod {
  const startDay = parseDate(from).getTime();
  const endDay = parseDate(to).getTime() + DAY_MS;
  if (endDay <= startDay || endDay - startDay > 366 * DAY_MS) {
    throw new RangeError('Expected 1 to 366 Taipei calendar days');
  }
  return {
    start: new Date(startDay - TAIPEI_OFFSET_MS),
    end: new Date(endDay - TAIPEI_OFFSET_MS),
  };
}

/** 完整台灣曆月的 UTC 半開區間；無效月份拋 RangeError。 */
export function taipeiMonthPeriod(month: string): TaipeiPeriod {
  const first = parseMonth(month);
  return {
    start: new Date(first.getTime() - TAIPEI_OFFSET_MS),
    end: new Date(
      calendarDate(first.getUTCFullYear(), first.getUTCMonth() + 2, 1).getTime() - TAIPEI_OFFSET_MS,
    ),
  };
}

/** 含 endMonth，往前 1～24 個完整曆月，由舊到新；無效輸入或超出四位年份拋 RangeError。 */
export function taipeiMonths(endMonth: string, count = 12): string[] {
  const last = parseMonth(endMonth);
  if (!Number.isInteger(count) || count < 1 || count > 24) {
    throw new RangeError('Expected 1 to 24 months');
  }
  return Array.from({ length: count }, (_, index) => {
    const date = calendarDate(last.getUTCFullYear(), last.getUTCMonth() + 2 - count + index, 1);
    if (date.getUTCFullYear() < 1) throw new RangeError('Month precedes year 0001');
    return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}
