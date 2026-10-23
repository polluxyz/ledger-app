import { useQuery } from '@tanstack/react-query';
import type { BalanceTrend, GetBalanceTrendQuery } from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';

/**
 * 使用者自己的資產趨勢。帳戶跨帳本共用，因此 query key 與查詢參數都不接受帳本 id；
 * 從台灣時區取當月作為預設終點，首頁顯示最近 12 個完整月份。
 */
export function useBalanceTrend(query: GetBalanceTrendQuery = defaultBalanceTrendQuery()) {
  return useQuery({
    queryKey: ['balance-trend', query.endMonth, query.months ?? 12] as const,
    queryFn: () => {
      const params = new URLSearchParams({
        endMonth: query.endMonth,
        months: String(query.months ?? 12),
      });
      return apiRequest<BalanceTrend>(`/accounts/balance-trend?${params.toString()}`);
    },
  });
}

function defaultBalanceTrendQuery(): GetBalanceTrendQuery {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;

  if (!year || !month) {
    throw new Error('無法取得台灣時區的目前月份。');
  }

  return { endMonth: `${year}-${month}`, months: 12 };
}
