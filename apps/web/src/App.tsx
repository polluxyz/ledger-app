import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './app/routes';
import { AppSidebar } from './app/AppSidebar';
import { AppTopBar } from './app/AppTopBar';
import { AppProviders } from './app/providers';
import { useDisclosure } from './app/use-disclosure';
import styles from './App.module.css';

/**
 * 應用外殼：由外而內是「路由 → 全域 Provider → 頂列 + 側邊欄 + 頁面」。
 * Router 放最外層，Provider 內部才能使用 useNavigate / useLocation。
 *
 * 頂列與側邊欄在路由**之外**，所以切頁時它們不會被卸載重建，導覽也不必每頁
 * 重寫一次。
 *
 * 窄螢幕的浮動選單狀態放在這一層：**觸發鈕在頂列、面板是側邊欄**，兩個元件
 * 各自持有一半，狀態只能放在它們共同的父層。`useDisclosure` 不依賴任何
 * Provider，所以擺在這裡不需要多包一層元件。
 */
export default function App() {
  const menu = useDisclosure();

  return (
    <BrowserRouter>
      <AppProviders>
        <div className={styles.shell}>
          <AppTopBar menuTrigger={menu.triggerProps} />
          <div className={styles.body}>
            <AppSidebar panel={menu.panelProps} isOpen={menu.isOpen} onNavigate={menu.close} />
            <main className={styles.main}>
              <AppRoutes />
            </main>
          </div>
        </div>
      </AppProviders>
    </BrowserRouter>
  );
}
