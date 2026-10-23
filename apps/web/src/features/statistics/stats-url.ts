import type { StatisticsPerspective } from '@ledger/shared';
import type { ChartType } from './charts/chart-types';

/** 統計頁可分享的網址狀態；圖型是目前分頁的設定，其他兩頁只留在 localStorage。 */
export type StatsTab = 'cat' | 'trend' | 'member';

export type StatsPeriod =
  | { mode: 'month'; month: string }
  | { mode: 'year'; year: string }
  | { mode: 'custom'; from: string; to: string };

export interface StatsUrlState {
  tab: StatsTab;
  ledgerId: string | null;
  period: StatsPeriod;
  perspective: StatisticsPerspective;
  chart: ChartType;
}

export interface StatsChartPreferences {
  cat: 'donut' | 'bar';
  trend: 'bar' | 'line' | 'table';
  member: 'bar' | 'donut';
}

export interface StatsStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface ParseStatsUrlOptions {
  /** 非共享帳本不支援成員分頁，也不支援「我」口徑。 */
  ledgerKind?: string;
  /** 網址未帶有效帳本時使用作用中帳本。 */
  defaultLedgerId?: string | null;
  /** 供純函式測試固定台灣月份；正式頁面省略時使用目前時間。 */
  now?: Date;
  /** 可注入測試 storage；省略時安全地讀取瀏覽器 localStorage。 */
  storage?: StatsStorage | null;
}

export const STATS_CHART_STORAGE_KEY = 'stats.chart';

export const DEFAULT_STATS_CHARTS: StatsChartPreferences = {
  cat: 'donut',
  trend: 'bar',
  member: 'bar',
};

/**
 * 解析並正規化統計頁網址。參數順序固定，頁面可以把輸出的 search 以 replace 寫回，
 * 不會讓無效或缺少的狀態多佔一筆瀏覽器歷史。
 */
export function parseStatsUrl(
  search: string,
  options: ParseStatsUrlOptions = {},
): { state: StatsUrlState; search: string } {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const requestedTab = params.get('tab');
  let tab: StatsTab = isStatsTab(requestedTab) ? requestedTab : 'cat';
  const ledgerId = normalizeLedgerId(params.get('ledger')) ?? options.defaultLedgerId ?? null;
  const ledgerIsShared = options.ledgerKind === 'SHARED';

  if (tab === 'member' && !ledgerIsShared) {
    tab = 'cat';
  }

  const period = parsePeriod(params, options.now ?? new Date());
  const requestedPerspective = params.get('perspective');
  const perspective: StatisticsPerspective =
    !ledgerIsShared || tab === 'member'
      ? 'LEDGER'
      : requestedPerspective === 'MINE'
        ? 'MINE'
        : 'LEDGER';

  const requestedChart = params.get('chart');
  const charts = readStatsChartPreferences(options.storage);
  const chart =
    requestedChart === null
      ? charts[tab]
      : isChartTypeForTab(tab, requestedChart)
        ? requestedChart
        : DEFAULT_STATS_CHARTS[tab];

  const state: StatsUrlState = { tab, ledgerId, period, perspective, chart };
  return { state, search: serializeStatsUrl(state) };
}

/** 組出穩定順序的統計頁查詢字串，僅包含可分享的頁面狀態。 */
export function serializeStatsUrl(state: StatsUrlState): string {
  const params = new URLSearchParams();
  params.set('tab', state.tab);
  if (state.ledgerId !== null && state.ledgerId !== '') {
    params.set('ledger', state.ledgerId);
  }
  if (state.period.mode === 'month') {
    params.set('month', state.period.month);
  } else if (state.period.mode === 'year') {
    params.set('year', state.period.year);
  } else {
    params.set('from', state.period.from);
    params.set('to', state.period.to);
  }
  params.set('perspective', state.perspective);
  params.set('chart', state.chart);
  return `?${params.toString()}`;
}

/** 目前台灣月份的起訖日，首頁卡片與統計頁共用同一份換算。 */
export function currentTaiwanMonthRange(now = new Date()): { from: string; to: string } {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) {
    throw new Error('無法取得台灣時區的目前月份。');
  }

  return monthRange(`${year}-${month}`);
}

/** 取得所選統計期間給統計端點使用的包含式日期範圍。 */
export function getStatsPeriodRange(period: StatsPeriod): { from: string; to: string } {
  if (period.mode === 'custom') {
    return { from: period.from, to: period.to };
  }
  if (period.mode === 'month') {
    return monthRange(period.month);
  }
  return {
    from: `${period.year}-01-01`,
    to: `${period.year}-12-31`,
  };
}

/** 趨勢端點一律以所選期間最後一個月為結尾。 */
export function getStatsPeriodEndMonth(period: StatsPeriod): string {
  if (period.mode === 'month') {
    return period.month;
  }
  if (period.mode === 'year') {
    return `${period.year}-12`;
  }
  return period.to.slice(0, 7);
}

/** 使用者親自切換圖型時呼叫；讀取與寫入失敗都不影響畫面狀態。 */
export function saveStatsChartPreference(
  tab: StatsTab,
  chart: ChartType,
  storage?: StatsStorage | null,
): void {
  if (!isChartTypeForTab(tab, chart)) {
    return;
  }
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) {
    return;
  }

  try {
    const preferences = readStatsChartPreferences(resolvedStorage);
    if (tab === 'cat') {
      preferences.cat = chart as StatsChartPreferences['cat'];
    } else if (tab === 'trend') {
      preferences.trend = chart as StatsChartPreferences['trend'];
    } else {
      preferences.member = chart as StatsChartPreferences['member'];
    }
    resolvedStorage.setItem(STATS_CHART_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // 隱私模式或受限瀏覽器可能拒絕 storage；頁面狀態仍由網址與 React 管理。
  }
}

/** 讀取三個分頁的圖型；格式不符時整筆視為沒有儲存過。 */
export function readStatsChartPreferences(storage?: StatsStorage | null): StatsChartPreferences {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) {
    return { ...DEFAULT_STATS_CHARTS };
  }

  try {
    const stored = resolvedStorage.getItem(STATS_CHART_STORAGE_KEY);
    if (stored === null) {
      return { ...DEFAULT_STATS_CHARTS };
    }
    const value: unknown = JSON.parse(stored);
    if (!isStatsChartPreferences(value)) {
      return { ...DEFAULT_STATS_CHARTS };
    }
    return { ...value };
  } catch {
    return { ...DEFAULT_STATS_CHARTS };
  }
}

/** 日期必須真實存在，且自訂期間最多包含 366 個台灣日。 */
export function isValidCustomDateRange(from: string, to: string): boolean {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (start === null || end === null || end < start) {
    return false;
  }
  const inclusiveDays = (end - start) / 86_400_000 + 1;
  return inclusiveDays <= 366;
}

function parsePeriod(params: URLSearchParams, now: Date): StatsPeriod {
  const month = params.get('month');
  const year = params.get('year');
  const from = params.get('from');
  const to = params.get('to');

  // 一次只接受一種期間。多帶時依月、年、自訂的順序取第一個宣告模式。
  if (month !== null) {
    return isYearMonth(month) ? { mode: 'month', month } : defaultMonthPeriod(now);
  }
  if (year !== null) {
    return isYear(year) ? { mode: 'year', year } : defaultMonthPeriod(now);
  }
  if (from !== null || to !== null) {
    return from !== null && to !== null && isValidCustomDateRange(from, to)
      ? { mode: 'custom', from, to }
      : defaultMonthPeriod(now);
  }
  return defaultMonthPeriod(now);
}

function defaultMonthPeriod(now: Date): StatsPeriod {
  return { mode: 'month', month: currentTaiwanMonthRange(now).from.slice(0, 7) };
}

function monthRange(month: string): { from: string; to: string } {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const lastDate = new Date(0);
  lastDate.setUTCHours(0, 0, 0, 0);
  lastDate.setUTCFullYear(year, monthNumber, 0);
  const lastDay = lastDate.getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

function parseIsoDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined || year < 1) {
    return null;
  }
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  const timestamp = date.getTime();
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? timestamp
    : null;
}

function isYearMonth(value: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return false;
  }
  return Number(value.slice(0, 4)) > 0;
}

function isYear(value: string): boolean {
  return /^\d{4}$/.test(value) && Number(value) > 0;
}

function normalizeLedgerId(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isStatsTab(value: string | null): value is StatsTab {
  return value === 'cat' || value === 'trend' || value === 'member';
}

function isChartTypeForTab(tab: StatsTab, value: string): value is ChartType {
  switch (tab) {
    case 'cat':
      return value === 'donut' || value === 'bar';
    case 'trend':
      return value === 'bar' || value === 'line' || value === 'table';
    case 'member':
      return value === 'bar' || value === 'donut';
  }
}

function isStatsChartPreferences(value: unknown): value is StatsChartPreferences {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const preferences = value as Record<string, unknown>;
  return (
    Object.keys(preferences).length === 3 &&
    isChartTypeForTab('cat', String(preferences.cat)) &&
    isChartTypeForTab('trend', String(preferences.trend)) &&
    isChartTypeForTab('member', String(preferences.member))
  );
}

function getStorage(storage: StatsStorage | null | undefined): StatsStorage | null {
  if (storage !== undefined) {
    return storage;
  }
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}
