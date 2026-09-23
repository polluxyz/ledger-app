import { Navigate, Route, Routes } from 'react-router-dom';
import AccountsPage from '../pages/AccountsPage';
import CategoriesPage from '../pages/CategoriesPage';
import HomePage from '../pages/HomePage';
import LedgerDetailPage from '../pages/LedgerDetailPage';
import LedgersPage from '../pages/LedgersPage';
import LoginPage from '../pages/LoginPage';
import ProfilePage from '../pages/ProfilePage';
import RegisterPage from '../pages/RegisterPage';
import { GuestOnlyRoute } from './GuestOnlyRoute';
import { ProtectedRoute } from './ProtectedRoute';

/**
 * 路由表。
 *
 * `/` 刻意是**公開**的：未登入者看得到介面預覽（空狀態），登入後同一頁顯示
 * 真實資料。要「記帳」時才需要登入。
 *
 * 登入 / 註冊頁包在 GuestOnlyRoute 之下，已登入者會被送回首頁。
 * 需要登入才能看的頁面則包在 ProtectedRoute 之下——**日後新增的受保護頁面請
 * 一併掛進去，不要各自寫登入檢查**，否則遲早有一頁會漏掉。
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />

      <Route element={<GuestOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/ledgers" element={<LedgersPage />} />
        <Route path="/ledgers/:ledgerId" element={<LedgerDetailPage />} />
        {/* 分類頁的帳本由 `?ledgerId=` 指定，不是路徑參數——它與側邊欄的作用中
            帳本各自獨立，網址帶得走才能從帳本明細頁直接連過來。 */}
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>

      {/* 未知路徑導回首頁。 */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
