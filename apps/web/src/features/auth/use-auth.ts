import { useContext } from 'react';
import { AuthContext, type AuthContextValue } from './auth-context';

/**
 * 取用登入狀態。若在 AuthProvider 之外呼叫會直接拋錯——與其回傳 undefined
 * 讓錯誤在遠處以難懂的形式炸開，不如在源頭講清楚。
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth 必須在 <AuthProvider> 內使用。');
  }
  return context;
}
