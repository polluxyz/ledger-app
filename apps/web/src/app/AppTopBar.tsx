import { Link } from 'react-router-dom';
import { useAuth } from '../features/auth/use-auth';
import type { Disclosure } from './use-disclosure';
import styles from './AppTopBar.module.css';

interface AppTopBarProps {
  /** 窄螢幕的選單開關。來自 `App` 的 `useDisclosure`，面板在 `AppSidebar`。 */
  menuTrigger: Disclosure['triggerProps'];
}

/**
 * 全站頂列。它只做兩件事：顯示站名，以及在窄螢幕顯示開關選單的 ☰。
 *
 * **刻意不顯示頁面標題。** 每一頁都已經有自己的 `h2`（例如 `AccountsPage` 的
 * 「帳戶」），頂列再放一次同樣的字，`getByRole('heading', { name })` 就會同時
 * 對到兩個而拋錯——`e2e/ledgers.spec.ts` 正好有這種斷言。理由完整寫在
 * `tasks/phase-2f-plan.md` D5。
 *
 * 站名是**全站唯一的 `h1`**，而且在未登入時也要在（訪客也該知道自己在哪個站）。
 * 因此它放在這裡，不放側邊欄——側邊欄只在登入後才渲染。
 */
export function AppTopBar({ menuTrigger }: AppTopBarProps) {
  const { isAuthenticated } = useAuth();

  return (
    <header className={styles.topbar}>
      {/* 未登入沒有導覽可以展開，☰ 就不該出現。 */}
      {isAuthenticated && (
        <button type="button" className={styles.menuButton} aria-label="主選單" {...menuTrigger}>
          {/* 三條槓用 CSS 畫，不用字元——不同系統的 ☰ 字形寬度差很多。 */}
          <span className={styles.menuIcon} aria-hidden="true" />
        </button>
      )}

      <h1 className={styles.title}>
        <Link className={styles.brand} to="/">
          記帳系統
        </Link>
      </h1>
    </header>
  );
}
