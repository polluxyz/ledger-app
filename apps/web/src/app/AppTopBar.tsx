import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ThemeToggle } from '../components/ThemeToggle';
import { useAuth } from '../features/auth/use-auth';
import type { Disclosure } from './use-disclosure';
import styles from './AppTopBar.module.css';

interface AppTopBarProps {
  /** 窄螢幕的選單開關。來自 `App` 的 `useDisclosure`，面板在 `AppSidebar`。 */
  menuTrigger: Disclosure['triggerProps'];
}

/**
 * 頂列，兩種形態（D12）：
 *
 * - **訪客**：站名（全站唯一的 `h1`）＋ 深淺切換鈕。訪客沒有側欄，站名只能住在這裡。
 * - **登入後**：☰ ＋ 站名，只在 ≤ 900px 出現（≥ 901px 側欄攤開，整條 CSS 隱藏）。
 *   這裡的站名是**普通文字、不是 heading**——登入後唯一的 `h1` 在側欄裡，
 *   這裡再多一個的話，jsdom 測試與 e2e 都會數到兩個。
 *
 * **刻意不顯示頁面標題**：每頁已有自己的 `h2`，頂列再放一次會讓
 * `getByRole('heading', { name })` 對到兩個（見 `tasks/phase-2f-plan.md` D5）。
 */
export function AppTopBar({ menuTrigger }: AppTopBarProps) {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return (
      <header data-chrome="" className={`${styles.topbar} ${styles.signedIn}`}>
        {/* aria-label 與 useDisclosure 的接法都不變（e2e 靠「主選單」定位）。 */}
        <button type="button" className={styles.menuButton} aria-label="主選單" {...menuTrigger}>
          <Icon name="menu" size={20} />
        </button>

        <span className={styles.brandMark}>
          <BrandLogo />
          <span>記帳系統</span>
        </span>
      </header>
    );
  }

  return (
    <header data-chrome="" className={`${styles.topbar} ${styles.guest}`}>
      <h1 className={styles.title}>
        <Link className={styles.brandMark} to="/">
          <BrandLogo />
          <span>記帳系統</span>
        </Link>
      </h1>

      <ThemeToggle />
    </header>
  );
}

/**
 * 「帳」字標誌方塊。裝飾——站名的無障礙名稱是「記帳系統」，多讀一個「帳」
 * 只會干擾，所以掛 `aria-hidden`（樣式與側欄的標誌同一套規格）。
 */
function BrandLogo() {
  return (
    <span className={styles.logo} aria-hidden="true">
      帳
    </span>
  );
}
