import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../features/auth/use-auth';
import type { Disclosure } from './use-disclosure';
import { useSidebarCollapsed, useSidebarFloatingRange } from './use-sidebar-collapsed';
import { UserMenu } from './UserMenu';
import styles from './AppSidebar.module.css';

interface AppSidebarProps {
  /** 浮動選單的面板身分。窄螢幕時它就是被 ☰ 展開的那個面板。 */
  panel: Disclosure['panelProps'];
  isOpen: boolean;
  /** 點了導覽連結之後呼叫，用來收起窄螢幕的浮動選單。 */
  onNavigate: () => void;
}

/**
 * 側欄：站名 ＋ 主導覽 ＋ 收合鈕 ＋ 使用者選單（2i · SC-31、D23、D27）。
 *
 * **站名 `h1` 住在這裡**，不在頂列：登入後 ≥ 901px 整條頂列被 CSS 隱藏，站名只剩
 * 側欄這一份。訪客沒有側欄，所以訪客的 `h1` 在頂列。全站任何時刻只有一個 `h1`，
 * `AppShell.test.tsx` 會擋住回歸。
 *
 * 2h 的帳本卡與深淺切換列都拿掉了：帳本切換器搬到記帳頁的頁首，深淺切換進了
 * 使用者選單（spec 2i §4.3、§4.4、§4.6）。「個人資料」也從導覽改到選單裡。
 *
 * 三種形態共用同一份 DOM，寬度差別在 CSS（2h D10）：
 *
 * - ≥ 1200px：展開，按收合鈕改成 72px 窄欄，選擇記在 localStorage。
 * - 901–1199px：外殼第一欄固定 72px。按收合鈕是**暫時**展開，側欄浮在內容上、
 *   中間區不動，點連結 / Esc / 點外面就收回，不記憶（D27）。
 * - ≤ 900px：收起來，由頂列的 ☰ 展開成浮在內容之上的面板。
 *
 * 收合時所有文字只是往左滑出並淡掉（`transform` ＋ `opacity`），不是移除——
 * 螢幕閱讀器與 e2e 讀的就是那些文字。動畫的細節見 `AppSidebar.module.css` 檔頭。
 */
export function AppSidebar({ panel, isOpen, onNavigate }: AppSidebarProps) {
  const { isAuthenticated } = useAuth();
  const { collapsed: storedCollapsed, toggle: toggleStored } = useSidebarCollapsed();
  const inFloatingRange = useSidebarFloatingRange();
  const [floatingRequested, setFloatingRequested] = useState(false);
  const panelId = panel.id;
  const { pathname } = useLocation();
  const navRef = useRef<HTMLElement | null>(null);
  const [marker, setMarker] = useState<{ top: number; height: number } | null>(null);
  const [markerReady, setMarkerReady] = useState(false);

  /*
   * 選中底色的位置（SC-43.1）。
   *
   * 導覽裡只有**一塊**底色，它靠 `transform: translateY()` 從舊的一項滑到新的一項。
   * 每個連結各自畫一塊的話，換頁時是「一塊消失、另一塊出現」，滑不起來。
   *
   * 量的是目前 `aria-current="page"` 那個連結——`NavLink` 已經把「哪一項算選中」
   * 算好了（`/ledgers/:id` 仍然選中「帳本」），這裡不必再判斷一次路徑。
   * 沒有任何一項選中時（例如 `/profile`）`marker` 是 null，底色就藏起來。
   *
   * 用 `useLayoutEffect` 而不是 `useEffect`：要在瀏覽器畫出這一幀之前就定位，
   * 否則換頁的第一幀底色還停在舊位置，會閃一下。
   */
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) {
      return;
    }
    const current = nav.querySelector<HTMLElement>('[aria-current="page"]');
    setMarker(current ? { top: current.offsetTop, height: current.offsetHeight } : null);
  }, [pathname, isAuthenticated]);

  /*
   * 第一次定位不播動畫（否則一進站底色會從最上面滑下來）。
   *
   * 做法是「先畫出來，下一幀才給 transition」：`requestAnimationFrame` 的 callback
   * 在這一幀畫完之後才跑，那時底色已經在定位上，之後的移動才是真正的換頁。
   */
  useEffect(() => {
    if (!marker || markerReady) {
      return;
    }
    const frame = requestAnimationFrame(() => setMarkerReady(true));
    return () => cancelAnimationFrame(frame);
  }, [marker, markerReady]);

  /*
   * 暫時展開只在 901–1199px 算數，所以用**推導**而不是另外存一份狀態：
   * 視窗被拉出那個區間時它自動失效，不必再寫一個 effect 去清它
   * （effect 裡呼叫 setState 會多跑一輪 render，`react-hooks` 也擋）。
   */
  const isFloatingOpen = inFloatingRange && floatingRequested;

  // 浮動展開時，點側欄外面或按 Esc 都收回（SC-31.6）。它蓋在內容上，
  // 不給這兩條路就只能再回頭找那顆按鈕。
  useEffect(() => {
    if (!isFloatingOpen) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      // 用 id 取回自己這個節點，而不是另外掛一個 ref：`panel.ref` 已經被
      // `useDisclosure` 佔住了，一個元素只能綁一個 ref。
      if (target && document.getElementById(panelId)?.contains(target)) {
        return;
      }
      setFloatingRequested(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setFloatingRequested(false);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFloatingOpen, panelId]);

  const handleNavigate = useCallback(() => {
    setFloatingRequested(false);
    onNavigate();
  }, [onNavigate]);

  /*
   * 同一顆按鈕，兩種行為：901–1199px 是「暫時浮出來看一眼」，不寫 localStorage
   * （D27）；≥ 1200px 才是會被記住的版面選擇。
   */
  const toggle = useCallback(() => {
    if (inFloatingRange) {
      setFloatingRequested((open) => !open);
      return;
    }
    toggleStored();
  }, [inFloatingRange, toggleStored]);

  // 未登入沒有導覽可看。登入 / 註冊的入口在首頁本身。
  if (!isAuthenticated) {
    return null;
  }

  const collapsed = inFloatingRange ? !isFloatingOpen : storedCollapsed;
  const classes = [
    styles.sidebar,
    isOpen ? styles.open : '',
    collapsed ? styles.collapsed : '',
    isFloatingOpen ? styles.floating : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <aside {...panel} data-chrome="" className={classes}>
      {/*
        內層 `.panel` 不是多餘的包裝：901–1199px 浮動展開時，外層 `<aside>`
        要維持 72px（外殼第一欄不動、中間內容不位移），真正變寬並浮起來的是它。
      */}
      <div className={styles.panel}>
        <div className={styles.brandRow}>
          <h1 className={styles.title}>
            <Link className={styles.brandMark} to="/" onClick={handleNavigate}>
              <span className={styles.logo} aria-hidden="true">
                帳
              </span>
              <span className={styles.collapsibleLabel}>記帳系統</span>
            </Link>
          </h1>
        </div>

        <nav ref={navRef} className={styles.nav} aria-label="主要導覽">
          {/*
            會滑動的那一塊選中底色（SC-43.1）。它是裝飾，名稱仍然來自連結本身；
            `aria-current="page"` 與加粗都還在連結上，螢幕閱讀器讀到的東西不變。
            `data-ready` 決定要不要過渡，見上面 `markerReady` 的說明。
          */}
          <span
            className={styles.navMarker}
            // 測試用的穩定抓取點：它沒有文字也沒有 role，class 名又是 CSS Modules
            // 編譯出來的，不給一個名字就只能用 class 前綴去猜。
            data-nav-marker=""
            data-ready={markerReady ? '' : undefined}
            hidden={!marker}
            aria-hidden="true"
            style={
              marker
                ? { height: `${marker.height}px`, transform: `translateY(${marker.top}px)` }
                : undefined
            }
          />
          {/*
            連結文字一個字都不能改——`e2e/ledgers.spec.ts` 有多處靠
            `getByRole('link', { name })` 定位它們。圖示是裝飾（aria-hidden），
            名稱仍然來自旁邊的 `<span>`，收合時那個 span 只是透明而已。
            每個連結都要 onNavigate：窄螢幕點完連結後頁面已經換了，
            選單還蓋在上面就變成擋路的東西。
          */}
          <NavLink to="/" className={navLinkClass} onClick={handleNavigate} end>
            <span className={styles.rowIcon}>
              <Icon name="home" />
            </span>
            <span className={styles.collapsibleLabel}>首頁</span>
          </NavLink>
          <NavLink to="/transactions" className={navLinkClass} onClick={handleNavigate}>
            <span className={styles.rowIcon}>
              <Icon name="receipt" />
            </span>
            <span className={styles.collapsibleLabel}>交易</span>
          </NavLink>
          <NavLink to="/counterparties" className={navLinkClass} onClick={handleNavigate}>
            <span className={styles.rowIcon}>
              <Icon name="user" />
            </span>
            <span className={styles.collapsibleLabel}>對象</span>
          </NavLink>
          <NavLink to="/ledgers" className={navLinkClass} onClick={handleNavigate}>
            <span className={styles.rowIcon}>
              <Icon name="book" />
            </span>
            <span className={styles.collapsibleLabel}>帳本</span>
          </NavLink>
          <NavLink to="/accounts" className={navLinkClass} onClick={handleNavigate}>
            <span className={styles.rowIcon}>
              <Icon name="wallet" />
            </span>
            <span className={styles.collapsibleLabel}>帳戶</span>
          </NavLink>
          {/* 分類連結刻意不帶 `?ledgerId=`：從導覽進去就是看作用中帳本那一本。
              要看別本的分類，入口在帳本明細頁，那裡才知道是哪一本。 */}
          <NavLink to="/categories" className={navLinkClass} onClick={handleNavigate}>
            <span className={styles.rowIcon}>
              <Icon name="tag" />
            </span>
            <span className={styles.collapsibleLabel}>分類</span>
          </NavLink>
        </nav>

        <div className={styles.footer}>
          {/*
            收合鈕從 2h 的品牌列搬到這裡，變成與其他列同高的一列（spec §4.3 假設 11）：
            展開與收合時位置相同，不會像 2h 那樣在 72px 放不下而消失。
            **無障礙名稱與 `aria-expanded` 維持 2h 的規則**，旁邊的文字是裝飾。
          */}
          <button
            type="button"
            className={styles.collapseRow}
            aria-label={collapsed ? '展開側欄' : '收合側欄'}
            aria-expanded={!collapsed}
            onClick={toggle}
          >
            <span className={styles.rowIcon}>
              <Icon name="chevronLeft" className={styles.collapseIcon} />
            </span>
            <span className={styles.collapsibleLabel} aria-hidden="true">
              {collapsed ? '展開側欄' : '收合側欄'}
            </span>
          </button>

          <UserMenu
            collapsed={collapsed}
            labelClassName={styles.collapsibleLabel}
            onNavigate={handleNavigate}
          />
        </div>
      </div>
    </aside>
  );
}

/**
 * 目前所在的頁面：文字加亮 ＋ 加粗。底色與左緣那條金線不在這裡了——第三輪改成
 * 導覽裡共用的一塊 `.navMarker`，換頁時它會滑過去（SC-43.1）。
 */
function navLinkClass({ isActive }: { isActive: boolean }) {
  return isActive ? `${styles.link} ${styles.active}` : styles.link;
}
