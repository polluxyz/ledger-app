import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/use-auth';

/**
 * 受保護路由的守門員：未登入一律導向 /login。
 *
 * 這只是「體驗層」的保護——真正的安全防線在後端（每個端點都會驗 JWT 與帳本
 * 權限）。前端擋下來只是為了避免使用者看到注定失敗的畫面。
 *
 * 記下來源位置（state.from），讓登入後可以回到原本想去的頁面。
 */
export function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
