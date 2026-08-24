import { Link, NavLink } from 'react-router-dom';
import { Button } from '../components/Button';
import { useAuth } from '../features/auth/use-auth';
import { LedgerSwitcher } from '../features/ledgers/LedgerSwitcher';
import styles from './AppHeader.module.css';

/**
 * 全站共用的頁首（S5-A）。
 *
 * 導覽刻意放在**外殼這一層**，而不是各頁自己畫一份：頁面一多，複製出來的那幾份
 * 遲早會有一份漏掉新連結，或間距對不齊。日後要調整位置或樣式，也只需要改這一個檔案。
 *
 * 站名是全站唯一的 `h1`，各頁標題一律降為 `h2`——一份文件只該有一個最高層標題，
 * 螢幕閱讀器才讀得出正確的層級。
 */
export function AppHeader() {
  const { isAuthenticated, logout } = useAuth();

  return (
    <header className={styles.header}>
      <h1 className={styles.title}>
        <Link className={styles.brand} to="/">
          記帳系統
        </Link>
      </h1>

      {/* 未登入時只顯示站名：登入 / 註冊的入口在首頁本身，頁首再放一次只是重複。 */}
      {isAuthenticated && (
        <nav className={styles.nav} aria-label="主要導覽">
          {/* 切換器放在導覽最前面：它決定「現在在哪一本帳本裡」，是讀其他連結
              之前該先知道的事。管理帳本的入口是隔壁的「帳本」連結，所以下拉
              裡不再放一個「管理帳本」選項——那會讓選單同時做兩件事。 */}
          <LedgerSwitcher />
          <NavLink to="/" className={navLinkClass} end>
            首頁
          </NavLink>
          <NavLink to="/ledgers" className={navLinkClass}>
            帳本
          </NavLink>
          <NavLink to="/accounts" className={navLinkClass}>
            帳戶
          </NavLink>
          <Button variant="secondary" onClick={logout}>
            登出
          </Button>
        </nav>
      )}
    </header>
  );
}

/** 目前所在的頁面不再是連結色，避免使用者以為點了會跳到別處。 */
function navLinkClass({ isActive }: { isActive: boolean }) {
  return isActive ? `${styles.link} ${styles.active}` : styles.link;
}
