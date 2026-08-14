import { useQuery } from '@tanstack/react-query';
import type { Account } from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';

/**
 * 目前使用者的帳戶（含即時餘額）。
 *
 * 與分類不同，這裡**不需要帳本 id**——帳戶屬於使用者、跨帳本共用，端點也在頂層。
 * 因此 query key 不帶帳本，切換帳本時也不必重新請求。
 */
export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiRequest<Account[]>('/accounts'),
  });
}
