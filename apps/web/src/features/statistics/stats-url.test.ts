import { describe, expect, it, vi } from 'vitest';
import {
  currentTaiwanMonthRange,
  DEFAULT_STATS_CHARTS,
  getStatsPeriodEndMonth,
  getStatsPeriodRange,
  isValidCustomDateRange,
  parseStatsUrl,
  readStatsChartPreferences,
  saveStatsChartPreference,
  serializeStatsUrl,
  STATS_CHART_STORAGE_KEY,
  type StatsStorage,
} from './stats-url';

/**
 * 統計頁網址的純函式行為。每個輸入直接解析，不掛 React；storage 由小型替身注入，
 * 以釘住失效時仍可正常顯示的契約。
 */
describe('stats-url', () => {
  const now = new Date('2026-10-15T04:00:00.000Z');
  const shared = { ledgerKind: 'SHARED', defaultLedgerId: 'active-ledger', now } as const;

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

  it('normalizes perspective for personal ledgers and the member tab', () => {
    expect(parseStatsUrl('?perspective=MINE', shared).state.perspective).toBe('MINE');
    expect(parseStatsUrl('?perspective=invalid', shared).state.perspective).toBe('LEDGER');
    expect(parseStatsUrl('?tab=member&perspective=MINE', shared).state).toMatchObject({
      tab: 'member',
      perspective: 'LEDGER',
    });
    expect(
      parseStatsUrl('?tab=member&perspective=MINE', { ...shared, ledgerKind: 'PERSONAL' }).state,
    ).toMatchObject({ tab: 'cat', perspective: 'LEDGER' });
    expect(
      parseStatsUrl('?perspective=MINE', { ...shared, ledgerKind: 'PERSONAL' }).state,
    ).toMatchObject({ perspective: 'LEDGER' });
  });

  it('accepts chart types only for the current tab and canonicalizes invalid values', () => {
    expect(parseStatsUrl('?tab=cat&chart=bar', shared).state.chart).toBe('bar');
    expect(parseStatsUrl('?tab=trend&chart=line', shared).state.chart).toBe('line');
    expect(parseStatsUrl('?tab=trend&chart=donut', shared).state.chart).toBe('bar');
    expect(parseStatsUrl('?tab=member&chart=donut', shared).state.chart).toBe('donut');
    expect(parseStatsUrl('?tab=cat&chart=line', shared).state.chart).toBe('donut');
    expect(parseStatsUrl('?tab=cat&chart=line', shared).search).toContain('chart=donut');
  });

  it('uses URL chart first, then localStorage, then the tab default', () => {
    const storage = memoryStorage(JSON.stringify({ cat: 'bar', trend: 'line', member: 'donut' }));
    expect(parseStatsUrl('?tab=cat&chart=donut', { ...shared, storage }).state.chart).toBe('donut');
    expect(parseStatsUrl('?tab=cat', { ...shared, storage }).state.chart).toBe('bar');
    expect(parseStatsUrl('?tab=trend', { ...shared, storage }).state.chart).toBe('line');
    expect(parseStatsUrl('?tab=member', { ...shared, storage }).state.chart).toBe('donut');
    expect(parseStatsUrl('?tab=cat', shared).state.chart).toBe(DEFAULT_STATS_CHARTS.cat);
  });

  it('stores only the three legal chart choices and ignores storage failures or invalid content', () => {
    const storage = memoryStorage(null);
    saveStatsChartPreference('trend', 'table', storage);
    expect(storage.value).toBe(JSON.stringify({ cat: 'donut', trend: 'table', member: 'bar' }));
    expect(readStatsChartPreferences(storage)).toEqual({
      cat: 'donut',
      trend: 'table',
      member: 'bar',
    });
    expect(JSON.parse(storage.value ?? '{}')).toEqual({
      cat: 'donut',
      trend: 'table',
      member: 'bar',
    });
    expect(STATS_CHART_STORAGE_KEY).toBe('stats.chart');

    expect(readStatsChartPreferences(memoryStorage('{'))).toEqual(DEFAULT_STATS_CHARTS);
    expect(
      readStatsChartPreferences(memoryStorage('{"cat":"line","trend":"bar","member":"bar"}')),
    ).toEqual(DEFAULT_STATS_CHARTS);
    expect(
      readStatsChartPreferences(
        memoryStorage('{"cat":"bar","trend":"line","member":"bar","user":"name"}'),
      ),
    ).toEqual(DEFAULT_STATS_CHARTS);

    const getThrows: StatsStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => undefined,
    };
    const setThrows: StatsStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(parseStatsUrl('?tab=cat', { ...shared, storage: getThrows }).state.chart).toBe('donut');
    expect(() => saveStatsChartPreference('cat', 'bar', setThrows)).not.toThrow();
    expect(() => saveStatsChartPreference('cat', 'line', storage)).not.toThrow();
  });

  it('serializes normalized state in a stable shape and derives endpoint ranges', () => {
    const state = parseStatsUrl(
      '?tab=trend&ledger=family&from=2026-10-05&to=2026-10-20&perspective=MINE&chart=line',
      shared,
    ).state;
    expect(serializeStatsUrl(state)).toBe(
      '?tab=trend&ledger=family&from=2026-10-05&to=2026-10-20&perspective=MINE&chart=line',
    );
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

function memoryStorage(value: string | null): StatsStorage & { value: string | null } {
  const storage = {
    value,
    getItem: vi.fn(() => storage.value),
    setItem: vi.fn((_key: string, nextValue: string) => {
      storage.value = nextValue;
    }),
  };
  return storage;
}
