import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthTokenResponse, AuthUser, LoginRequest, RegisterRequest } from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';
import { clearActiveLedgerId } from '../../lib/active-ledger-storage';
import { clearToken, onTokenExpired, readToken, writeToken } from '../../lib/token-storage';
import { homeLayoutEditStore } from '../../app/home-layout-edit-store';
import { AuthContext, type AuthContextValue } from './auth-context';

/**
 * 提供登入狀態給整棵元件樹。初始值直接讀 localStorage，因此重整頁面仍保持登入。
 *
 * 註冊與登入都是「動作」而非「查詢」，故直接呼叫 api client，不經 react-query。
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readToken());
  const queryClient = useQueryClient();
  const logoutInProgress = useRef(false);

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

  const clearLocalSession = useCallback(
    (expectedToken?: string | null) => {
      // 登出會使這位使用者的未完成版面與所有晚到請求失效。
      homeLayoutEditStore.clearAll();
      if (expectedToken === undefined || readToken() === expectedToken) clearToken();
      setToken(null);
      // 作用中帳本只是偏好設定，但它是別人帳本的 id，沒有理由留在瀏覽器裡。
      clearActiveLedgerId();
      // 清掉快取，避免下一位登入者看到上一位的資料。
      queryClient.clear();
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    if (logoutInProgress.current) return;
    logoutInProgress.current = true;
    const tokenAtClick = readToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      if (tokenAtClick) {
        await apiRequest('/auth/logout', { method: 'POST', signal: controller.signal });
      }
    } catch {
      // 離線或伺服器失敗時仍清除本機，不顯示訊息。
    } finally {
      clearTimeout(timeout);
      clearLocalSession(tokenAtClick);
      logoutInProgress.current = false;
    }
  }, [clearLocalSession]);

  useEffect(() => onTokenExpired(clearLocalSession), [clearLocalSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      isAuthenticated: token !== null,
      login,
      register,
      logout: () => {
        void logout();
      },
    }),
    [token, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
