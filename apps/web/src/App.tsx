import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './app/routes';
import { AppHeader } from './app/AppHeader';
import { AppProviders } from './app/providers';
import styles from './App.module.css';

/**
 * 應用外殼：由外而內是「路由 → 全域 Provider → 頁首 + 頁面」。
 * Router 放最外層，Provider 內部才能使用 useNavigate / useLocation。
 *
 * 頁首在路由**之外**，所以切頁時它不會被卸載重建，導覽也不必每頁重寫一次。
 */
export default function App() {
  return (
    <BrowserRouter>
      <AppProviders>
        <div className={styles.shell}>
          <AppHeader />
          <main>
            <AppRoutes />
          </main>
        </div>
      </AppProviders>
    </BrowserRouter>
  );
}
