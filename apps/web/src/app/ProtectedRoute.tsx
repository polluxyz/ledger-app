import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/use-auth';

/**
 * 需要登入才能看的頁面的守門員。與 GuestOnlyRoute 恰好相反。
 *
 * 未登入時把「原本想去哪」放進 `state.from`，登入成功後就能送回去；
 * `LoginPage` 會先用 `toSafeRedirect()` 收斂它，絕不原樣採信。
 *
 * 用 `replace` 而非 push：這次轉址不該留在歷史紀錄裡，否則使用者登入後按上一頁
 * 會回到「當時被擋下的那一刻」，然後又被擋一次。
 */
export function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  }
  return <Outlet />;
}
