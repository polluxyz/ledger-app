import {
  safeStatisticsInteger,
  statisticsAttributionCte,
  statisticsGroupsSql,
  statisticsPeopleSql,
  statisticsTotalsFromRow,
  statisticsTotalsSql,
  statisticsTrendSql,
} from './statistics-sql';
import { taipeiMonthPeriod } from './taipei-period';

const scope = { ledgerId: "ledger' OR true --", userId: 'viewer', ...taipeiMonthPeriod('2026-10') };

/** 檢查 SQL 的參數化、單一歸屬來源與整數輸出邊界；真實查詢語意另由差異 e2e 驗證。 */
describe('Statistics SQL boundaries', () => {
  it.each([
    statisticsAttributionCte,
    statisticsTotalsSql,
    statisticsGroupsSql,
    statisticsPeopleSql,
    statisticsTrendSql,
  ])('keeps ledger IDs, viewer IDs, and UTC bounds as parameters (%p)', (build) => {
    const query = build(scope);
    expect(query.text).not.toContain(scope.ledgerId);
    expect(query.values).toEqual(
      expect.arrayContaining([scope.ledgerId, scope.userId, scope.start, scope.end]),
    );
    expect(query.text).toContain('"deletedAt" IS NULL');
    expect(query.text).toContain('"date" >=');
    expect(query.text).toContain('"date" <');
  });

  it('marks the timestamp as UTC before converting to Taipei', () => {
    expect(statisticsTrendSql(scope).text).toContain(
      `("date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Taipei'`,
    );
    expect(statisticsTrendSql(scope).text).not.toContain(`"date" AT TIME ZONE 'Asia/Taipei'`);
  });

  it('only filters MINE for groups and trend, while totals and people retain both scopes', () => {
    expect(statisticsGroupsSql(scope, 'MINE').text).toContain('WHERE true AND "isMe"');
    expect(statisticsTrendSql(scope, 'MINE').text).toContain('WHERE true AND "isMe"');
    expect(statisticsPeopleSql(scope).text).not.toContain('WHERE true AND "isMe"');
  });

  it('preserves safe limits and computes a negative net exactly', () => {
    expect(safeStatisticsInteger(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(safeStatisticsInteger(BigInt(Number.MIN_SAFE_INTEGER))).toBe(Number.MIN_SAFE_INTEGER);
    expect(statisticsTotalsFromRow({ income: 20n, expense: 30n })).toEqual({
      income: 20,
      expense: 30,
      net: -10,
    });
  });

  it.each([9007199254740992n, -9007199254740992n, 9007199254740993n])(
    'rejects unsafe SQL sum %s',
    (value) => {
      expect(() => safeStatisticsInteger(value)).toThrow(RangeError);
    },
  );

  it('rejects unsafe individual sums even when the net returns to the safe range', () => {
    expect(() =>
      statisticsTotalsFromRow({ income: 9007199254740993n, expense: 9007199254740993n }),
    ).toThrow(RangeError);
  });
});
