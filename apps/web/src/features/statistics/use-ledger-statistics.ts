import { useQuery } from '@tanstack/react-query';
import type {
  GetLedgerStatisticsQuery,
  LedgerStatistics,
  StatisticsPerspective,
} from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';

/**
 * 某帳本、期間與視角的收支摘要。這支 hook 同時供首頁與統計頁使用，因此期間與視角
 * 都由呼叫端提供；每一項查詢條件都放進 key，避免切換條件時讀到其他結果。
 */
export function useLedgerStatistics(ledgerId: string | null, query: GetLedgerStatisticsQuery) {
  const perspective: StatisticsPerspective = query.perspective ?? 'LEDGER';

  return useQuery({
    queryKey: ['ledger-statistics', ledgerId, query.from, query.to, perspective] as const,
    queryFn: () => {
      const params = new URLSearchParams({ from: query.from, to: query.to });
      if (query.perspective !== undefined) {
        params.set('perspective', query.perspective);
      }
      return apiRequest<LedgerStatistics>(
        `/ledgers/${ledgerId as string}/statistics?${params.toString()}`,
      );
    },
    enabled: ledgerId !== null,
  });
}
