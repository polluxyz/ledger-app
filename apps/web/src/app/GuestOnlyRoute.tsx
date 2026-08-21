import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/use-auth';
import { toSafeRedirect } from '../lib/safe-redirect';

/**
 * 登入 / 註冊頁的守門員：已登入者不該再看到這些頁面，直接送走。
 * 與 ProtectedRoute 恰好相反。
 *
 * 送去哪裡要看 `state.from`——使用者可能是被 ProtectedRoute 從某個頁面擋下來、
 * 轉來這裡登入的，登入完成後該回到原本想去的地方。
 *
 * 這件事必須由這裡負責，不能只靠 `LoginPage` 自己轉址：token 一設好，這個
 * 守門員就會在同一輪渲染把人送走，比表單的 onSuccess 更早生效。少了下面這行，
 * `from` 永遠到不了目的地，使用者一律被丟回首頁。
 *
 * `from` 來自可被任意寫入的 router state，因此一律先用 `toSafeRedirect()` 收斂
 * 成站內路徑，絕不原樣採信。
 */
export function GuestOnlyRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (isAuthenticated) {
    return (
      <Navigate to={toSafeRedirect((location.state as { from?: unknown } | null)?.from)} replace />
    );
  }
  return <Outlet />;
}
