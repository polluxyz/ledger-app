import { useQuery } from '@tanstack/react-query';
import type {
  GetStatisticsTrendQuery,
  StatisticsPerspective,
  StatisticsTrend,
} from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';
import { appendStatsFilters } from './statistics-filters';

/**
 * 某帳本、結尾月份與視角的完整曆月趨勢。每一項查詢條件都放入 query key，圖型切換
 * 不會改變這些條件，因此只換畫法時會沿用同一份回應。
 */
export function useStatisticsTrend(ledgerId: string | null, query: GetStatisticsTrendQuery) {
  const months = query.months ?? 12;
  const perspective: StatisticsPerspective = query.perspective ?? 'LEDGER';

  const filters = new URLSearchParams();
  appendStatsFilters(filters, query);
  const filterKey = filters.toString();

  return useQuery({
    queryKey: [
      'statistics-trend',
      ledgerId,
      query.endMonth,
      months,
      perspective,
      ...(filterKey ? [filterKey] : []),
    ] as const,
    queryFn: () => {
      const params = new URLSearchParams({ endMonth: query.endMonth, months: String(months) });
      if (query.perspective !== undefined) {
        params.set('perspective', query.perspective);
      }
      for (const [key, value] of filters) params.append(key, value);
      return apiRequest<StatisticsTrend>(
        `/ledgers/${ledgerId as string}/statistics/trend?${params.toString()}`,
      );
    },
    enabled: ledgerId !== null,
  });
}
