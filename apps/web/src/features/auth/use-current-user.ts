import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthUser, UpdateUserRequest } from '@ledger/shared';
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

/**
 * 更新個人資料（目前後端只開放改顯示名稱）。
 *
 * **只送 name**：`UpdateUserDto` 的白名單只有這個欄位，全域又開了
 * `forbidNonWhitelisted`，多送任何鍵都會被退成 400。
 *
 * 不攔截錯誤——`apiRequest` 已把後端的統一格式轉成 `ApiError`，
 * 呼叫端交給 `FormError` 原樣呈現即可。
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateUserRequest) =>
      apiRequest<AuthUser>('/users/me', { method: 'PATCH', body: input }),
    onSuccess: () => {
      // 名字不只出現在這一頁（帳本成員清單等處也用它認人），改完要讓快取失效。
      void queryClient.invalidateQueries({ queryKey: CURRENT_USER_KEY });
    },
  });
}
