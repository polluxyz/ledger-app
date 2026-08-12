import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../features/auth/use-auth';

/**
 * 登入 / 註冊頁的守門員：已登入者不該再看到這些頁面，直接送回首頁。
 * 與 ProtectedRoute 恰好相反。
 */
export function GuestOnlyRoute() {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
