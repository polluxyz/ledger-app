import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MarkedTransaction, Paginated } from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';

/** 首頁標註卡的查詢 key；標註或取消標註後以前綴失效所有顯示模式。 */
export const MARKED_TRANSACTIONS_KEY = ['marked-transactions'] as const;
const INITIAL_LIMIT = 10;
const PAGE_LIMIT = 100;

/** 取得首頁標註卡資料；展開時依 API 上限分頁，取回目前所有標註。 */
export function useMarkedTransactions(expanded = false) {
  return useQuery({
    queryKey: [...MARKED_TRANSACTIONS_KEY, expanded],
    queryFn: async () => {
      const limit = expanded ? PAGE_LIMIT : INITIAL_LIMIT;
      const firstPage = await apiRequest<Paginated<MarkedTransaction>>(
        `/transactions/marked?page=1&limit=${limit}`,
      );
      if (!expanded || firstPage.total <= firstPage.items.length) {
        return firstPage;
      }

      const pageCount = Math.ceil(firstPage.total / PAGE_LIMIT);
      const laterPages = await Promise.all(
        Array.from({ length: pageCount - 1 }, (_, index) =>
          apiRequest<Paginated<MarkedTransaction>>(
            `/transactions/marked?page=${index + 2}&limit=${PAGE_LIMIT}`,
          ),
        ),
      );
      return {
        ...firstPage,
        items: [...firstPage.items, ...laterPages.flatMap((page) => page.items)],
        limit: PAGE_LIMIT,
      };
    },
    placeholderData: keepPreviousData,
  });
}

/** 標註狀態屬於目前使用者，成功後重抓所有交易列與首頁標註卡。 */
export function useSetTransactionMark() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      ledgerId,
      transactionId,
      currentlyMarked,
    }: {
      ledgerId: string;
      transactionId: string;
      currentlyMarked: boolean;
    }) =>
      apiRequest<void>(`/ledgers/${ledgerId}/transactions/${transactionId}/mark`, {
        method: currentlyMarked ? 'DELETE' : 'PUT',
      }),
    onSuccess: (_data, { ledgerId, transactionId }) => {
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['transaction', ledgerId, transactionId] });
      void queryClient.invalidateQueries({ queryKey: MARKED_TRANSACTIONS_KEY });
    },
  });
}
