import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetLedgerStatisticsDto, GetStatisticsTrendDto } from './get-statistics.dto';

/** DTO 只轉換月份數量；必填欄位與 enum 不接受隱式轉型，跨欄位曆日規則另測 service。 */
describe('Statistics query DTOs', () => {
  it('keeps the documented defaults and transforms the numeric query string', async () => {
    const statistics = plainToInstance(GetLedgerStatisticsDto, {
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(await validate(statistics)).toEqual([]);
    expect(statistics.perspective).toBe('LEDGER');
    const trend = plainToInstance(GetStatisticsTrendDto, { endMonth: '2026-10', months: '24' });
    expect(await validate(trend)).toEqual([]);
    expect(trend.months).toBe(24);
    expect(plainToInstance(GetStatisticsTrendDto, { endMonth: '2026-10' }).months).toBe(12);
  });

  it.each([0, 25, 1.5, 'abc', null])('rejects invalid months %j', async (months) => {
    expect(
      await validate(plainToInstance(GetStatisticsTrendDto, { endMonth: '2026-10', months })),
    ).not.toHaveLength(0);
  });
});
