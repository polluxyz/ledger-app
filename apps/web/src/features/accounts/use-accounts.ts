import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Account, CreateAccountRequest, UpdateAccountRequest } from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';

/**
 * 帳戶的伺服器狀態。
 *
 * 與分類不同，這裡**不需要帳本 id**——帳戶屬於使用者、跨帳本共用，端點也在頂層。
 * 因此 query key 不帶帳本，切換帳本時也不必重新請求。
 *
 * ⚠️ **餘額是算出來的，任何會改變交易的操作都必須讓 `ACCOUNTS_KEY` 失效**
 * （新增 / 編輯 / 刪除交易皆是）。少做這件事不會拋錯、不會讓測試變紅，畫面上的
 * 餘額只會停在舊數字直到重整——那種問題很難被發現，也很難聯想到原因。
 * 交易那側的實作見 `features/transactions/use-transactions.ts`。
 */
export const ACCOUNTS_KEY = ['accounts'] as const;

/** 目前使用者的帳戶（含即時餘額）。 */
export function useAccounts() {
  return useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: () => apiRequest<Account[]>('/accounts'),
  });
}

/**
 * 以下三個 mutation 都不攔截錯誤——`apiRequest` 已把後端的統一錯誤格式轉成
 * `ApiError`，呼叫端交給 `FormError` 呈現即可。前端不自行改寫錯誤訊息：
 * 那是後端的職責，重寫只會讓兩邊講法不一致。
 */

/** 新增帳戶。名稱重複時後端回 409 `ACCOUNT_NAME_TAKEN`。 */
export function useCreateAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateAccountRequest) =>
      apiRequest<Account>('/accounts', { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
    },
  });
}

/**
 * 改名或調整初始餘額。
 *
 * 調整初始餘額會讓該帳戶的餘額整體平移——這正是「一開始填錯、事後校正」時想要的
 * 行為，也是為什麼這裡同樣要讓快取失效：交易一筆都沒變，餘額卻變了。
 */
export function useUpdateAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...input }: UpdateAccountRequest & { id: string }) =>
      apiRequest<Account>(`/accounts/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
    },
  });
}

/** 刪除帳戶。仍被交易引用時後端回 409 `ACCOUNT_IN_USE`（含已軟刪除的交易）。 */
export function useDeleteAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    // 成功時後端回 204 無 body，`apiRequest` 會回 undefined。
    mutationFn: (id: string) => apiRequest<void>(`/accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
    },
  });
}
