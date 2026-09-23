import { Link, NavLink } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ThemeToggle } from '../components/ThemeToggle';
import { useAuth } from '../features/auth/use-auth';
import { useCurrentUser } from '../features/auth/use-current-user';
import { LedgerSwitcher } from '../features/ledgers/LedgerSwitcher';
import type { Disclosure } from './use-disclosure';
import { useSidebarCollapsed } from './use-sidebar-collapsed';
import styles from './AppSidebar.module.css';

interface AppSidebarProps {
  /** 浮動選單的面板身分。窄螢幕時它就是被 ☰ 展開的那個面板。 */
  panel: Disclosure['panelProps'];
  isOpen: boolean;
  /** 點了導覽連結之後呼叫，用來收起窄螢幕的浮動選單。 */
  onNavigate: () => void;
}

/**
 * 側欄：站名 ＋ 帳本卡 ＋ 主導覽 ＋ 深淺切換 ＋ 使用者與登出（2h · D12、D13、D18）。
 *
 * **站名 `h1` 住在這裡**，不在頂列：登入後 ≥ 901px 整條頂列被 CSS 隱藏，站名只剩
 * 側欄這一份。訪客沒有側欄，所以訪客的 `h1` 在頂列（D12 的表）。全站任何時刻只有
 * 一個 `h1`，`AppShell.test.tsx` 會擋住回歸。
 *
 * 三種形態共用同一份 DOM，差別只在 CSS（D10：斷點只存在 CSS）：
 *
 * - ≥ 1200px：展開，使用者可以按收合鈕改成窄欄。
 * - 901–1199px：一律收合成 72px 的窄欄（那個寬度放不下三欄）。
 * - ≤ 900px：收起來，由頂列的 ☰ 展開成浮在內容之上的面板。
 *
 * 收合時所有文字改成**視覺隱藏**而不是移除——螢幕閱讀器與 e2e 讀的就是那些文字。
 */
export function AppSidebar({ panel, isOpen, onNavigate }: AppSidebarProps) {
  const { isAuthenticated, logout } = useAuth();
  const { collapsed, toggle } = useSidebarCollapsed();
  const { data: currentUser } = useCurrentUser();

  // 未登入沒有導覽可看。登入 / 註冊的入口在首頁本身。
  if (!isAuthenticated) {
    return null;
  }

  const classes = [styles.sidebar, isOpen ? styles.open : '', collapsed ? styles.collapsed : '']
    .filter(Boolean)
    .join(' ');

  return (
    <aside
      {...panel}
      data-chrome=""
      /*
       * `data-sidebar-collapsed` 是給**別的 CSS Module** 用的鉤子：
       * `LedgerSwitcher.module.css` 看不到這個檔案的 `.collapsed` 類名
       * （CSS Modules 會把類名改寫成各自獨有的字串），但屬性選取器不會被改寫。
       */
      data-sidebar-collapsed={collapsed ? '' : undefined}
      className={classes}
    >
      <div className={styles.brandRow}>
        <h1 className={styles.title}>
          <Link className={styles.brandMark} to="/" onClick={onNavigate}>
            <span className={styles.logo} aria-hidden="true">
              帳
            </span>
            <span className={styles.collapsibleLabel}>記帳系統</span>
          </Link>
        </h1>

        {/* 只有 ≥ 1200px 看得到（CSS）。其他寬度的收合與否由斷點決定，按鈕沒有意義。 */}
        <button
          type="button"
          className={styles.collapseButton}
          aria-label={collapsed ? '展開側欄' : '收合側欄'}
          aria-expanded={!collapsed}
          onClick={toggle}
        >
          <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} />
        </button>
      </div>

      <div className={styles.ledgerCard}>
        <p className={styles.ledgerCardLabel}>目前帳本</p>
        <LedgerSwitcher />
      </div>

      <nav className={styles.nav} aria-label="主要導覽">
        {/*
          連結文字一個字都不能改——`e2e/ledgers.spec.ts` 有 5 處靠
          `getByRole('link', { name })` 定位它們。圖示是裝飾（aria-hidden），
          名稱仍然來自旁邊的 `<span>`，收合時那個 span 只是看不見而已。
          每個連結都要 onNavigate：窄螢幕點完連結後頁面已經換了，
          選單還蓋在上面就變成擋路的東西。
        */}
        <NavLink to="/" className={navLinkClass} onClick={onNavigate} end>
          <Icon name="home" />
          <span className={styles.collapsibleLabel}>首頁</span>
        </NavLink>
        <NavLink to="/ledgers" className={navLinkClass} onClick={onNavigate}>
          <Icon name="book" />
          <span className={styles.collapsibleLabel}>帳本</span>
        </NavLink>
        <NavLink to="/accounts" className={navLinkClass} onClick={onNavigate}>
          <Icon name="wallet" />
          <span className={styles.collapsibleLabel}>帳戶</span>
        </NavLink>
        {/* 分類連結刻意不帶 `?ledgerId=`：從導覽進去就是看作用中帳本那一本。
            要看別本的分類，入口在帳本明細頁，那裡才知道是哪一本。 */}
        <NavLink to="/categories" className={navLinkClass} onClick={onNavigate}>
          <Icon name="tag" />
          <span className={styles.collapsibleLabel}>分類</span>
        </NavLink>
        <NavLink to="/profile" className={navLinkClass} onClick={onNavigate}>
          <Icon name="user" />
          <span className={styles.collapsibleLabel}>個人資料</span>
        </NavLink>
      </nav>

      <div className={styles.footer}>
        <div className={styles.themeRow}>
          <ThemeToggle labelClassName={styles.collapsibleLabel} />
        </div>

        {/*
          使用者資料只是招呼語，取不到就不顯示——側欄不該因為 `/users/me` 失敗而壞掉。

          **email 只放在 `title` 裡，不印成文字**：成員清單（`MemberList`）也顯示
          同一批 email，兩邊都是純文字的話，`getByText(email)` 會同時對到側欄與
          成員列——e2e 的 `ledgers.spec.ts` 與單元測試都是這樣定位成員的。
          滑鼠停在使用者區塊上仍看得到完整 email。
        */}
        {currentUser?.name ? (
          <div className={styles.userRow} title={currentUser.email}>
            <span className={styles.avatar} aria-hidden="true">
              {firstCharacter(currentUser.name)}
            </span>
            <p className={styles.userName}>{currentUser.name}</p>
          </div>
        ) : null}

        <button type="button" className={styles.logout} onClick={logout}>
          <Icon name="logout" />
          <span className={styles.collapsibleLabel}>登出</span>
        </button>
      </div>
    </aside>
  );
}

/**
 * 目前所在的頁面：底色 ＋ 加粗 ＋ 左緣一條金線（CSS 的 inset box-shadow）。
 * 不再改成別的文字顏色——黑底上換色不如換底色明顯。
 */
function navLinkClass({ isActive }: { isActive: boolean }) {
  return isActive ? `${styles.link} ${styles.active}` : styles.link;
}

/** 取第一個「字」。用 `Array.from` 而不是 `[0]`，否則 emoji 這類字元會被切成半個。 */
function firstCharacter(value: string): string {
  return Array.from(value)[0] ?? '';
}
