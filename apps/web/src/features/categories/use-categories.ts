import { useQuery } from '@tanstack/react-query';
import type { Category, TransactionType } from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';

/**
 * 某帳本的分類，可依交易型別篩選——記一筆支出時只該看到支出分類。
 * 篩選交給後端做（`?type=`），前端不自行過濾。
 */
export function useCategories(ledgerId: string | null, type: TransactionType) {
  return useQuery({
    queryKey: ['categories', ledgerId, type],
    queryFn: () => apiRequest<Category[]>(`/ledgers/${ledgerId!}/categories?type=${type}`),
    // 沒有帳本 id 就不發請求。
    enabled: ledgerId !== null,
  });
}
