import { useQuery } from '@tanstack/react-query';
import type { Category, CategoryType } from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';

/**
 * 某帳本的分類，可依交易型別篩選——記一筆支出時只該看到支出分類。
 * 篩選交給後端做（`?type=`），前端不自行過濾。
 *
 * 型別參數用 `CategoryType`（僅收入／支出）而非 `TransactionType`：轉帳沒有分類，
 * 用寬的那組會讓人以為可以傳 `TRANSFER` 進來查。
 */
export function useCategories(ledgerId: string | null, type: CategoryType) {
  return useQuery({
    queryKey: ['categories', ledgerId, type],
    queryFn: () => apiRequest<Category[]>(`/ledgers/${ledgerId!}/categories?type=${type}`),
    // 沒有帳本 id 就不發請求。
    enabled: ledgerId !== null,
  });
}
