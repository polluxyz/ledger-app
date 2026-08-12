import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateTransactionRequest, Paginated, Transaction } from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';

/**
 * 某帳本的交易列表。排序、分頁、篩選全由後端負責，前端只呈現拿到的那一頁
 * （Slice 0 先取預設第一頁；分頁與篩選 UI 屬 Slice 3）。
 */
export function useTransactions(ledgerId: string | null) {
  return useQuery({
    queryKey: ['transactions', ledgerId],
    queryFn: () => apiRequest<Paginated<Transaction>>(`/ledgers/${ledgerId!}/transactions`),
    enabled: ledgerId !== null,
  });
}

/**
 * 新增交易。成功後讓該帳本的交易快取失效，react-query 會自動重取，
 * 因此畫面不必重整就會出現新的一筆。
 */
export function useCreateTransaction(ledgerId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateTransactionRequest) =>
      apiRequest<Transaction>(`/ledgers/${ledgerId!}/transactions`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['transactions', ledgerId] });
    },
  });
}
