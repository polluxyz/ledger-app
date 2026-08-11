import { Navigate, Route, Routes } from 'react-router-dom';
import HomePage from '../pages/HomePage';
import LoginPage from '../pages/LoginPage';
import RegisterPage from '../pages/RegisterPage';
import { ProtectedRoute } from './ProtectedRoute';

/**
 * 路由表。公開路由（登入／註冊）與受保護路由分開，後者一律包在
 * ProtectedRoute 之下，新增頁面時不會漏掉權限檢查。
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<HomePage />} />
      </Route>

      {/* 未知路徑導回首頁；未登入時 ProtectedRoute 會再轉到 /login。 */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
