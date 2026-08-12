import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthTokenResponse, AuthUser, LoginRequest, RegisterRequest } from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';
import { clearToken, readToken, writeToken } from '../../lib/token-storage';
import { AuthContext, type AuthContextValue } from './auth-context';

/**
 * 提供登入狀態給整棵元件樹。初始值直接讀 localStorage，因此重整頁面仍保持登入。
 *
 * 註冊與登入都是「動作」而非「查詢」，故直接呼叫 api client，不經 react-query。
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readToken());
  const queryClient = useQueryClient();

  const login = useCallback(async (credentials: LoginRequest) => {
    const { accessToken } = await apiRequest<AuthTokenResponse>('/auth/login', {
      method: 'POST',
      body: credentials,
      anonymous: true,
    });
    writeToken(accessToken);
    setToken(accessToken);
  }, []);

  /** 註冊成功後直接以同一組帳密登入，省去使用者再輸入一次。 */
  const register = useCallback(
    async (input: RegisterRequest) => {
      await apiRequest<AuthUser>('/auth/register', {
        method: 'POST',
        body: input,
        anonymous: true,
      });
      await login({ email: input.email, password: input.password });
    },
    [login],
  );

  const logout = useCallback(() => {
    clearToken();
    setToken(null);
    // 清掉快取，避免下一位登入者看到上一位的資料。
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ token, isAuthenticated: token !== null, login, register, logout }),
    [token, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
