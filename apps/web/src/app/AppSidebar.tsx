import { NavLink } from 'react-router-dom';
import { Button } from '../components/Button';
import { useAuth } from '../features/auth/use-auth';
import { LedgerSwitcher } from '../features/ledgers/LedgerSwitcher';
import type { Disclosure } from './use-disclosure';
import styles from './AppSidebar.module.css';

interface AppSidebarProps {
  /** 浮動選單的面板身分。窄螢幕時它就是被 ☰ 展開的那個面板。 */
  panel: Disclosure['panelProps'];
  isOpen: boolean;
  /** 點了導覽連結之後呼叫，用來收起窄螢幕的浮動選單。 */
  onNavigate: () => void;
}

/**
 * 側邊欄：作用中帳本切換器 ＋ 主導覽 ＋ 登出。
 *
 * **切換器排在導覽最上面**是刻意的：它決定其他每一個連結看到哪一本帳本的資料，
 * 是讀導覽之前該先知道的事。管理帳本的入口是導覽裡的「帳本」連結，所以切換器
 * 的下拉不再放一個「管理帳本」選項——那會讓同一個控制項做兩件事。
 *
 * 寬螢幕它是固定的一欄；窄螢幕（< 900px）收起來，由頂列的 ☰ 展開成浮在內容
 * 之上的面板。**兩種形態共用同一份 DOM**，差別只在 CSS（見 plan D6）——
 * 用 `matchMedia` 判斷寬度的話，斷點會同時存在於 CSS 與 JS，兩邊遲早分岔。
 *
 * 站名不在這裡，在 `AppTopBar`：側邊欄只在登入後渲染，而訪客也該看得到站名。
 */
export function AppSidebar({ panel, isOpen, onNavigate }: AppSidebarProps) {
  const { isAuthenticated, logout } = useAuth();

  // 未登入沒有導覽可看。登入 / 註冊的入口在首頁本身。
  if (!isAuthenticated) {
    return null;
  }

  return (
    <aside {...panel} className={`${styles.sidebar} ${isOpen ? styles.open : ''}`}>
      <div className={styles.switcher}>
        <LedgerSwitcher />
      </div>

      <nav className={styles.nav} aria-label="主要導覽">
        {/*
          連結文字一個字都不能改——`e2e/ledgers.spec.ts` 有 5 處靠
          `getByRole('link', { name })` 定位它們。
          每個連結都要 onNavigate：窄螢幕點完連結後頁面已經換了，
          選單還蓋在上面就變成擋路的東西。
        */}
        <NavLink to="/" className={navLinkClass} onClick={onNavigate} end>
          首頁
        </NavLink>
        <NavLink to="/ledgers" className={navLinkClass} onClick={onNavigate}>
          帳本
        </NavLink>
        <NavLink to="/accounts" className={navLinkClass} onClick={onNavigate}>
          帳戶
        </NavLink>
      </nav>

      <div className={styles.footer}>
        <Button variant="secondary" block onClick={logout}>
          登出
        </Button>
      </div>
    </aside>
  );
}

/** 目前所在的頁面不再是連結色，避免使用者以為點了會跳到別處。 */
function navLinkClass({ isActive }: { isActive: boolean }) {
  return isActive ? `${styles.link} ${styles.active}` : styles.link;
}
