import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../features/auth/use-auth';
import { useCurrentUser } from '../features/auth/use-current-user';
import { SettingsDialog } from './SettingsDialog';
import styles from './UserMenu.module.css';

/**
 * 側欄底部的使用者選單（2i · SC-32、D24）。
 *
 * 一層：「設定 / 個人資料 / 登出」。點「設定」關掉選單並跳出設定彈窗
 * （`SettingsDialog`，第二輪修訂取代了原本往右浮出的第二層）。
 * 2h 把登出與深淺切換各放一列在側欄裡；收合成 72px 後那些列只剩圖示，
 * 使用者認不出哪個是哪個，所以這一輪收進選單，入口統一成「使用者列」。
 *
 * 四件事值得先說明：
 *
 * 1. **這是揭露式面板（disclosure），不是 ARIA menu。** 裡面全部用原生
 *    `<button>` 與 `<a>`，不掛 `role="menuitem"`。
 *    掛了的話「登出」就不再是 button，既有 e2e 與單元測試的
 *    `getByRole('button', { name: '登出' })` 會整批失效——那等於改了斷言。
 * 2. **選單用 `position: fixed`**，位置依觸發鈕的實際座標算。側欄本身有
 *    `overflow-y: auto`，用 `absolute` 會被裁掉；而 fixed 的元素不受祖先
 *    `overflow` 影響（祖先沒有 `transform` 時）。
 * 3. **email 只放在 `title`**（沿用 2h 的決定）：成員清單也顯示同一批 email，
 *    兩邊都印成文字的話 `getByText(email)` 會同時對到兩處。
 * 4. **取不到使用者名稱時仍然要有這顆按鈕**（名稱「帳號選單」）。登出在裡面，
 *    按鈕不見就等於登不出去——`/users/me` 失敗不該把人鎖在站內。
 */
interface UserMenuProps {
  /** 側欄收合中。收合時選單改浮在側欄右邊，展開時浮在使用者列上方。 */
  collapsed: boolean;
  /** 側欄傳進來的「收合時視覺隱藏」class，套在名字上。 */
  labelClassName?: string;
  /** 點了選單裡的連結之後呼叫，用來收起浮動側欄。 */
  onNavigate?: () => void;
}

/** 選單與觸發鈕之間的間隙，單位 px。 */
const MENU_GAP = 8;

export function UserMenu({ collapsed, labelClassName, onNavigate }: UserMenuProps) {
  const { logout } = useAuth();
  const { data: currentUser } = useCurrentUser();

  const [isOpen, setIsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const menuId = useId();

  const displayName = currentUser?.name ?? '';
  const triggerLabel = displayName ? `${displayName}的選單` : '帳號選單';

  const closeMenuOnly = useCallback(() => {
    setIsOpen(false);
  }, []);

  /** 關掉選單並把焦點送回觸發鈕。不做的話焦點會掉到 `<body>`。 */
  const closeMenu = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  /**
   * 關掉設定彈窗，焦點回到**使用者觸發鈕**（SC-32.3）。
   *
   * 不是回到「設定」：開啟彈窗的同時選單就關了，那顆按鈕已經不在 DOM 裡。
   * 觸發鈕是使用者最後看得見的那個入口，回到它才接得下去。
   */
  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
    triggerRef.current?.focus();
  }, []);

  // 點選單外面就關。用 pointerdown 而不是 click，才不會與觸發鈕自己的
  // onClick 打架（同一個問題的說明見 `use-disclosure.ts`）。
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) {
        return;
      }
      closeMenuOnly();
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen, closeMenuOnly]);

  // 開啟時焦點送到第一個項目（SC-32.3）。
  useEffect(() => {
    if (isOpen) {
      menuItemsOf(menuRef.current)[0]?.focus();
    }
  }, [isOpen]);

  /*
   * 位置在畫面更新前算好（`useLayoutEffect`），使用者才不會看到選單先出現在
   * 左上角再跳過去。側欄展開時浮在使用者列**上方**、收合時浮在側欄**右邊**：
   * 72px 的側欄上方空間被導覽佔滿，往上長會蓋住導覽。
   */
  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }
    const trigger = triggerRef.current?.getBoundingClientRect();
    if (!trigger) {
      return;
    }
    setMenuStyle(
      collapsed
        ? { left: trigger.right + MENU_GAP, bottom: window.innerHeight - trigger.bottom }
        : { left: trigger.left, bottom: window.innerHeight - trigger.top + MENU_GAP },
    );
  }, [isOpen, collapsed]);

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setIsOpen(true);
    }
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(menuRef.current, 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(menuRef.current, -1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    }
  }

  /** 選單收掉、彈窗跳出來。兩件事同時發生，使用者只會看到一個浮動層。 */
  function openSettings() {
    setIsOpen(false);
    setIsSettingsOpen(true);
  }

  function handleNavigate() {
    setIsOpen(false);
    onNavigate?.();
  }

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        type="button"
        ref={triggerRef}
        className={styles.trigger}
        // email 不印成文字，只在滑鼠停留時出現。
        title={currentUser?.email}
        aria-label={triggerLabel}
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={styles.avatar} aria-hidden="true">
          {displayName ? firstCharacter(displayName) : <Icon name="user" />}
        </span>
        {displayName ? (
          <span className={[styles.userName, labelClassName].filter(Boolean).join(' ')}>
            {displayName}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <div
          id={menuId}
          ref={menuRef}
          className={styles.menu}
          style={menuStyle}
          onKeyDown={handleMenuKeyDown}
        >
          {/*
            `aria-haspopup="dialog"` 而不是 `aria-expanded`：它開的是彈窗，
            不是一塊「展開在原地」的區域，兩者對螢幕閱讀器的意思不一樣。
          */}
          <button
            type="button"
            className={styles.item}
            data-menu-item=""
            aria-haspopup="dialog"
            onClick={openSettings}
          >
            <span className={styles.itemIcon}>
              <Icon name="gear" />
            </span>
            <span className={styles.itemLabel}>設定</span>
          </button>

          <Link to="/profile" className={styles.item} data-menu-item="" onClick={handleNavigate}>
            <span className={styles.itemIcon}>
              <Icon name="user" />
            </span>
            <span className={styles.itemLabel}>個人資料</span>
          </Link>

          {/* 名稱仍然是「登出」，也仍然是原生 button，行為沿用 2h 的 `logout`。 */}
          <button type="button" className={styles.item} data-menu-item="" onClick={logout}>
            <span className={styles.itemIcon}>
              <Icon name="logout" />
            </span>
            <span className={styles.itemLabel}>登出</span>
          </button>
        </div>
      ) : null}

      <SettingsDialog open={isSettingsOpen} onClose={closeSettings} />
    </div>
  );
}

/** 選單裡可以被 ↑↓ 走到的項目，依 DOM 順序。 */
function menuItemsOf(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }
  return Array.from(container.querySelectorAll<HTMLElement>('[data-menu-item]'));
}

/** ↑↓ 在選單之內循環。走到頭再按會回到另一端，不會卡住。 */
function moveFocus(container: HTMLElement | null, step: number): void {
  const items = menuItemsOf(container);
  if (items.length === 0) {
    return;
  }
  const current = items.indexOf(document.activeElement as HTMLElement);
  const next = current === -1 ? 0 : (current + step + items.length) % items.length;
  items[next]?.focus();
}

/** 取第一個「字」。用 `Array.from` 而不是 `[0]`，否則 emoji 這類字元會被切成半個。 */
function firstCharacter(value: string): string {
  return Array.from(value)[0] ?? '';
}
