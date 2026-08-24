import { useQuery } from '@tanstack/react-query';
import type { AuthUser } from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';
import { useAuth } from './use-auth';

export const CURRENT_USER_KEY = ['users', 'me'] as const;

/**
 * 目前登入的使用者。
 *
 * `AuthContext` 刻意只保存 token，使用者資料一律向後端要——同一份資料存兩地遲早
 * 會不同步（見 `auth-context.ts`）。
 *
 * 需要它的地方目前只有一個：帳本明細頁要從成員清單裡認出「哪一位是我」，才知道
 * 該不該顯示 owner 才有的操作。**那是體驗，不是授權**；真正的防線在後端。
 */
export function useCurrentUser() {
  const { isAuthenticated } = useAuth();

  return useQuery({
    queryKey: CURRENT_USER_KEY,
    queryFn: () => apiRequest<AuthUser>('/users/me'),
    enabled: isAuthenticated,
  });
}
