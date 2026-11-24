import type { StatisticsFilters } from '@ledger/shared';

/** 網址、查詢與面板共用的篩選欄位。 */
export const FILTER_ID_KEYS = ['personIds', 'categoryIds', 'accountIds'] as const;
const FLAG_KEYS = ['includeUncategorized', 'includeOtherAccounts'] as const;
export type FilterIdKey = (typeof FILTER_ID_KEYS)[number];
export type FilterKey = FilterIdKey | (typeof FLAG_KEYS)[number];
export type StatsFilters = Required<StatisticsFilters>;

export function readStatsFilters(params: URLSearchParams): StatsFilters {
  return {
    personIds: [...new Set(params.getAll('personIds'))],
    categoryIds: [...new Set(params.getAll('categoryIds'))],
    accountIds: [...new Set(params.getAll('accountIds'))],
    includeUncategorized: params.get('includeUncategorized') === 'true',
    includeOtherAccounts: params.get('includeOtherAccounts') === 'true',
  };
}

export function appendStatsFilters(params: URLSearchParams, filters: StatisticsFilters) {
  for (const key of FILTER_ID_KEYS) {
    for (const id of filters[key] ?? []) params.append(key, id);
  }
  for (const key of FLAG_KEYS) {
    if (filters[key]) params.set(key, 'true');
  }
}

export function countStatsFilters(filters: StatsFilters) {
  return (
    FILTER_ID_KEYS.reduce((count, key) => count + filters[key].length, 0) +
    FLAG_KEYS.filter((key) => filters[key]).length
  );
}

export const EMPTY_STATS_FILTERS = readStatsFilters(new URLSearchParams());

export type FilterLists = Record<FilterIdKey, readonly { id: string; name: string }[] | undefined>;

/** 只用已載入的清單比對。找不到失效項目時，由使用者確認清除全部條件。 */
export function clearInvalidStatsFilters(filters: StatsFilters, lists: FilterLists): StatsFilters {
  const next = { ...filters };
  for (const key of FILTER_ID_KEYS) {
    const options = lists[key];
    if (options) next[key] = filters[key].filter((id) => options.some((item) => item.id === id));
  }
  return countStatsFilters(next) < countStatsFilters(filters) ? next : EMPTY_STATS_FILTERS;
}
