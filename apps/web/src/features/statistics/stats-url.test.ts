import { describe, expect, it } from 'vitest';
import {
  currentTaiwanMonthRange,
  getStatsPeriodEndMonth,
  getStatsPeriodRange,
  isValidCustomDateRange,
  parseStatsUrl,
  serializeStatsUrl,
} from './stats-url';

/** 直接解析網址，驗證統計篩選與舊參數的正規化。 */
describe('stats-url', () => {
  const now = new Date('2026-10-15T04:00:00.000Z');
  const shared = { defaultLedgerId: 'active-ledger', now } as const;

  it('parses valid tab and ledger values and normalizes unknown values', () => {
    expect(parseStatsUrl('?tab=trend&ledger=family', shared).state).toMatchObject({
      tab: 'trend',
      ledgerId: 'family',
    });
    expect(parseStatsUrl('?tab=unknown&ledger=%20%20', shared).state).toMatchObject({
      tab: 'cat',
      ledgerId: 'active-ledger',
    });
    expect(parseStatsUrl('', { ...shared, defaultLedgerId: null }).state.ledgerId).toBeNull();
  });

  it('accepts one valid period and falls back to the Taiwan month for invalid values', () => {
    expect(parseStatsUrl('?month=2024-02', shared).state.period).toEqual({
      mode: 'month',
      month: '2024-02',
    });
    expect(parseStatsUrl('?year=2028', shared).state.period).toEqual({
      mode: 'year',
      year: '2028',
    });
    expect(parseStatsUrl('?from=2024-02-29&to=2024-03-01', shared).state.period).toEqual({
      mode: 'custom',
      from: '2024-02-29',
      to: '2024-03-01',
    });
    for (const search of [
      '?month=2026-13',
      '?year=20x6',
      '?from=2026-02-30&to=2026-03-01',
      '?from=2026-10-10',
      '?from=2026-10-20&to=2026-10-19',
    ]) {
      expect(parseStatsUrl(search, shared).state.period).toEqual({
        mode: 'month',
        month: '2026-10',
      });
    }
  });

  it('accepts leap day and custom periods of 366 days, but rejects 367 days', () => {
    expect(isValidCustomDateRange('2024-02-29', '2024-02-29')).toBe(true);
    expect(isValidCustomDateRange('2024-01-01', '2024-12-31')).toBe(true);
    expect(isValidCustomDateRange('2023-01-01', '2024-01-02')).toBe(false);
    expect(parseStatsUrl('?from=2024-01-01&to=2024-12-31', shared).state.period).toEqual({
      mode: 'custom',
      from: '2024-01-01',
      to: '2024-12-31',
    });
    expect(parseStatsUrl('?from=2023-01-01&to=2024-01-02', shared).state.period).toEqual({
      mode: 'month',
      month: '2026-10',
    });
  });

  it('normalizes the old member tab and preserves repeated filter ids and true flags', () => {
    const { state, search } = parseStatsUrl(
      '?tab=member&perspective=MINE&personIds=me&personIds=guest&personIds=me&includeUncategorized=true&includeOtherAccounts=false',
      shared,
    );
    expect(state.tab).toBe('cat');
    const params = new URLSearchParams(search);
    expect(params.getAll('personIds')).toEqual(['me', 'guest']);
    expect(params.get('includeUncategorized')).toBe('true');
    expect(params.has('includeOtherAccounts')).toBe(false);
    expect(params.has('perspective')).toBe(false);
  });

  it.each(['cat', 'trend'])('drops legacy chart parameters on %s', (tab) => {
    const parsed = parseStatsUrl('?tab=' + tab + '&chart=bar&chart=table', shared);
    expect(parsed.state.tab).toBe(tab);
    expect(new URLSearchParams(parsed.search).has('chart')).toBe(false);
  });

  it('serializes normalized state in a stable shape and derives endpoint ranges', () => {
    const state = parseStatsUrl(
      '?tab=trend&ledger=family&from=2026-10-05&to=2026-10-20&perspective=MINE&chart=line',
      shared,
    ).state;
    expect(serializeStatsUrl(state)).toBe('?tab=trend&ledger=family&from=2026-10-05&to=2026-10-20');
    expect(getStatsPeriodRange({ mode: 'year', year: '2024' })).toEqual({
      from: '2024-01-01',
      to: '2024-12-31',
    });
    expect(getStatsPeriodEndMonth({ mode: 'year', year: '2024' })).toBe('2024-12');
    expect(getStatsPeriodEndMonth({ mode: 'custom', from: '2026-10-05', to: '2026-10-20' })).toBe(
      '2026-10',
    );
  });

  it('uses the Taiwan month at UTC month boundaries', () => {
    expect(currentTaiwanMonthRange(new Date('2026-10-31T16:30:00.000Z'))).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
  });
});
