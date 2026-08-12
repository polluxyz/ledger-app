import { createContext } from 'react';
import type { LoginRequest, RegisterRequest } from '@ledger/shared';

/**
 * 登入狀態與相關動作。刻意只保存 token——使用者資料另外用 react-query 向
 * `/users/me` 取得，避免同一份資料存兩地而不同步。
 *
 * Context 與 Provider 元件分檔，是為了讓每個檔案只匯出單一種東西
 * （react-refresh 的 lint 規則要求，這樣 HMR 才能正確運作）。
 */
export interface AuthContextValue {
  /** 目前的 JWT；未登入為 null。 */
  token: string | null;
  isAuthenticated: boolean;
  login: (credentials: LoginRequest) => Promise<void>;
  register: (input: RegisterRequest) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
