import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateTransactionRequest, Paginated, Transaction } from '@ledger/shared';
import { ACCOUNTS_KEY } from '../accounts/use-accounts';
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
 *
 * **帳戶快取也要一起失效**（D5）：餘額是後端依交易算出來的，記一筆帳就變了。
 * 少了這一行不會拋錯、不會讓任何測試變紅，只會讓首頁的餘額停在舊數字直到重整——
 * 那種問題很難被發現，也很難聯想到原因，所以 `use-transactions.test.tsx` 有一條
 * 專屬測試釘住它。日後新增「編輯交易」「刪除交易」時，同樣要失效這個 key。
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
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
    },
  });
}
