import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './app/routes';
import { AppProviders } from './app/providers';
import styles from './App.module.css';

/**
 * 應用外殼：由外而內是「路由 → 全域 Provider → 頁面」。
 * Router 放最外層，Provider 內部才能使用 useNavigate / useLocation。
 */
export default function App() {
  return (
    <BrowserRouter>
      <AppProviders>
        <main className={styles.container}>
          <AppRoutes />
        </main>
      </AppProviders>
    </BrowserRouter>
  );
}
