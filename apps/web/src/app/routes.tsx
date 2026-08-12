import { Navigate, Route, Routes } from 'react-router-dom';
import HomePage from '../pages/HomePage';
import LoginPage from '../pages/LoginPage';
import RegisterPage from '../pages/RegisterPage';
import { GuestOnlyRoute } from './GuestOnlyRoute';

/**
 * 路由表。
 *
 * `/` 刻意是**公開**的：未登入者看得到介面預覽（空狀態），登入後同一頁顯示
 * 真實資料。要「記帳」時才需要登入。
 *
 * 登入 / 註冊頁包在 GuestOnlyRoute 之下，已登入者會被送回首頁。
 * 之後需要真正受保護的頁面（帳本管理、分類…）時，再包上 ProtectedRoute。
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />

      <Route element={<GuestOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      {/* 未知路徑導回首頁。 */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
