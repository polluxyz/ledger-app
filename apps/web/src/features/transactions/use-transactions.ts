import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateTransactionRequest,
  ListTransactionsQuery,
  Paginated,
  Transaction,
  UpdateTransactionRequest,
} from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';
import { invalidateAfterMoneyWrite } from '../../lib/invalidate-after-money-write';

/**
 * 某帳本交易快取的**前綴** key。實際的 key 還會接上查詢參數（見 `useTransactions`），
 * 但失效時一律用這個前綴——react-query 是前綴比對，一次涵蓋所有分頁與篩選組合。
 */
export function transactionsKey(ledgerId: string | null) {
  return ['transactions', ledgerId] as const;
}

/**
 * 把查詢參數組成查詢字串。空值一律不送——送出 `?type=` 這種空參數會被後端的
 * 驗證擋成 400，而使用者只是「沒有選這個篩選條件」而已。
 */
function toQueryString(query: ListTransactionsQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }
  const queryString = params.toString();
  return queryString === '' ? '' : `?${queryString}`;
}

/**
 * 某帳本的交易列表。排序、分頁、篩選全由後端負責，前端只呈現拿到的那一頁。
 *
 * **查詢參數必須進 query key**：少了它，第 2 頁的結果會蓋掉第 1 頁的快取，
 * 翻回去會看到錯的資料。
 *
 * `keepPreviousData` 讓換頁時畫面保留上一頁的內容，直到新的一頁回來。少了它，
 * 每次換頁都會閃一下「載入中」，清單高度跟著跳動。
 */
export function useTransactions(ledgerId: string | null, query: ListTransactionsQuery = {}) {
  return useQuery({
    queryKey: [...transactionsKey(ledgerId), query],
    queryFn: () =>
      apiRequest<Paginated<Transaction>>(
        `/ledgers/${ledgerId!}/transactions${toQueryString(query)}`,
      ),
    enabled: ledgerId !== null,
    placeholderData: keepPreviousData,
  });
}

/** 新增交易。成功後使用共用失效函式，讓相關畫面不必重整就能載入新資料。 */
export function useCreateTransaction(ledgerId: string | null) {
  const mutation = useCreateTransactionForLedger();

  return {
    ...mutation,
    mutate: (input: CreateTransactionRequest, options?: Parameters<typeof mutation.mutate>[1]) =>
      mutation.mutate({ ledgerId, input }, options),
    mutateAsync: (input: CreateTransactionRequest) => mutation.mutateAsync({ ledgerId, input }),
  };
}

/**
 * 新增交易時由呼叫端指定帳本，供 AI 草稿寫入它所屬的帳本；成功後沿用共用失效清單。
 */
export function useCreateTransactionForLedger() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      ledgerId,
      input,
    }: {
      ledgerId: string | null;
      input: CreateTransactionRequest;
    }) =>
      apiRequest<Transaction>(`/ledgers/${ledgerId!}/transactions`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => invalidateAfterMoneyWrite(queryClient),
  });
}

/**
 * 編輯交易。只送有變動的欄位，沒送的欄位後端維持原值。
 *
 * 例外是備註：`undefined` 代表「不動」，要清空必須送空字串
 * （見 `UpdateTransactionRequest` 的說明）。那件事由表單決定，這裡照送。
 */
export function useUpdateTransaction(ledgerId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      transactionId,
      input,
    }: {
      transactionId: string;
      input: UpdateTransactionRequest;
    }) =>
      apiRequest<Transaction>(`/ledgers/${ledgerId!}/transactions/${transactionId}`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => invalidateAfterMoneyWrite(queryClient),
  });
}

/**
 * 刪除交易。後端是軟刪除（設 `deletedAt` 保留資料列供稽核），成功回 204 無內容。
 * 對使用者而言仍是回不去的——**後端沒有還原端點**，確認文案要講清楚。
 */
export function useDeleteTransaction(ledgerId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (transactionId: string) =>
      apiRequest<void>(`/ledgers/${ledgerId!}/transactions/${transactionId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => invalidateAfterMoneyWrite(queryClient),
  });
}
