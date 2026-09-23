import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/icon-paths';
import { useAuth } from '../features/auth/use-auth';
import { useCurrentUser } from '../features/auth/use-current-user';
import { useTheme, type ThemePreference } from './use-theme';
import styles from './UserMenu.module.css';

/**
 * 側欄底部的使用者選單（2i · SC-32、D24）。
 *
 * 兩層：第一層是「設定 / 個人資料 / 登出」，「設定」再往右浮出第二層「外觀」。
 * 2h 把登出與深淺切換各放一列在側欄裡；收合成 72px 後那些列只剩圖示，
 * 使用者認不出哪個是哪個，所以這一輪收進選單，入口統一成「使用者列」。
 *
 * 四件事值得先說明：
 *
 * 1. **這是揭露式面板（disclosure），不是 ARIA menu。** 裡面全部用原生
 *    `<button>`、`<a>`、`<input type="radio">`，不掛 `role="menuitem"`。
 *    掛了的話「登出」就不再是 button，既有 e2e 與單元測試的
 *    `getByRole('button', { name: '登出' })` 會整批失效——那等於改了斷言。
 *    原生元素另外附帶一個好處：radio 群組的方向鍵移動是瀏覽器內建的。
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

/** 第二層放不放得下靠它估，單位 px；與 `.menu` 的 `min-width` 一致。 */
const SETTINGS_MENU_WIDTH = 176;

const THEME_OPTIONS: readonly { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: 'system', label: '跟隨系統', icon: 'monitor' },
  { value: 'light', label: '淺色', icon: 'sun' },
  { value: 'dark', label: '深色', icon: 'moon' },
];

export function UserMenu({ collapsed, labelClassName, onNavigate }: UserMenuProps) {
  const { logout } = useAuth();
  const { data: currentUser } = useCurrentUser();
  const { preference, choose } = useTheme();

  const [isOpen, setIsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const [settingsStyle, setSettingsStyle] = useState<CSSProperties>({});

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);

  const menuId = useId();
  const settingsId = useId();
  const appearanceLabelId = useId();
  // 同一頁可能同時有別的 radio 群組，名字帶上這個實例的 id 才不會混在一起。
  const themeGroupName = `${useId()}-theme`;

  const displayName = currentUser?.name ?? '';
  const triggerLabel = displayName ? `${displayName}的選單` : '帳號選單';

  const closeAll = useCallback(() => {
    setIsSettingsOpen(false);
    setIsOpen(false);
  }, []);

  /** 關掉第二層並把焦點送回開啟它的「設定」（SC-32.3）。 */
  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
    settingsButtonRef.current?.focus();
  }, []);

  /** 關掉整層並把焦點送回觸發鈕。不做的話焦點會掉到 `<body>`。 */
  const closeMenu = useCallback(() => {
    closeAll();
    triggerRef.current?.focus();
  }, [closeAll]);

  // 點選單外面：兩層一起關。用 pointerdown 而不是 click，才不會與
  // 觸發鈕自己的 onClick 打架（同一個問題的說明見 `use-disclosure.ts`）。
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) {
        return;
      }
      closeAll();
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen, closeAll]);

  // 開啟時焦點送到第一個項目（SC-32.3）。
  useEffect(() => {
    if (isOpen) {
      menuItemsOf(menuRef.current)[0]?.focus();
    }
  }, [isOpen]);

  // 第二層打開時焦點送到**目前選中**的那顆 radio，使用者一眼看得到自己在哪。
  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }
    const radios = radiosOf(settingsRef.current);
    (radios.find((radio) => radio.checked) ?? radios[0])?.focus();
  }, [isSettingsOpen]);

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

  useLayoutEffect(() => {
    if (!isSettingsOpen) {
      return;
    }
    const button = settingsButtonRef.current?.getBoundingClientRect();
    const menu = menuRef.current?.getBoundingClientRect();
    if (!button || !menu) {
      return;
    }
    // 預設在第一層右邊；右邊放不下就疊在第一層上方（spec §4.4）。
    const rightEdge = button.right + MENU_GAP;
    const fitsOnTheRight = rightEdge + SETTINGS_MENU_WIDTH <= window.innerWidth;
    setSettingsStyle({ left: fitsOnTheRight ? rightEdge : menu.left, top: button.top });
  }, [isSettingsOpen]);

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

  /*
   * 第二層是第一層的**兄弟節點**，不是子節點，所以這個 handler 不會接到
   * 第一層的鍵盤事件，兩層的 Esc 各自管各自那一層。
   *
   * 這裡刻意不處理 ↑↓：radio 群組內的方向鍵移動是瀏覽器內建的，自己寫一份
   * 只會與內建行為打架。← 要 `preventDefault`，否則會被當成「移到上一顆 radio」。
   */
  function handleSettingsKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft' || event.key === 'Escape') {
      event.preventDefault();
      closeSettings();
    }
  }

  function handleSettingsButtonKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    // Enter 與 Space 不必處理：原生 `<button>` 會轉成 click，由 onClick 接手。
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setIsSettingsOpen(true);
    }
  }

  function handleNavigate() {
    closeAll();
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
          <button
            type="button"
            ref={settingsButtonRef}
            className={styles.item}
            data-menu-item=""
            aria-expanded={isSettingsOpen}
            aria-controls={settingsId}
            onClick={() => setIsSettingsOpen((open) => !open)}
            onKeyDown={handleSettingsButtonKeyDown}
          >
            <span className={styles.itemIcon}>
              <Icon name="gear" />
            </span>
            <span className={styles.itemLabel}>設定</span>
            <Icon name="chevronRight" />
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

      {isOpen && isSettingsOpen ? (
        <div
          id={settingsId}
          ref={settingsRef}
          className={`${styles.menu} ${styles.settingsMenu}`}
          style={settingsStyle}
          onKeyDown={handleSettingsKeyDown}
        >
          <p id={appearanceLabelId} className={styles.groupLabel}>
            外觀
          </p>
          {/*
            三個選項是一組單選，所以用原生 radio 包在 `radiogroup` 裡：方向鍵移動、
            一次只能選一個、螢幕閱讀器報「第幾個、共三個」全部免費。
            選完刻意**不關閉**：留著才看得到自己選了哪一個。
          */}
          <div role="radiogroup" aria-labelledby={appearanceLabelId}>
            {THEME_OPTIONS.map((option) => (
              <label key={option.value} className={styles.item}>
                <input
                  type="radio"
                  className={styles.radio}
                  name={themeGroupName}
                  value={option.value}
                  checked={preference === option.value}
                  onChange={() => choose(option.value)}
                />
                <span className={styles.itemIcon}>
                  <Icon name={option.icon} />
                </span>
                <span className={styles.itemLabel}>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 第一層裡可以被 ↑↓ 走到的項目，依 DOM 順序。 */
function menuItemsOf(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }
  return Array.from(container.querySelectorAll<HTMLElement>('[data-menu-item]'));
}

function radiosOf(container: HTMLElement | null): HTMLInputElement[] {
  if (!container) {
    return [];
  }
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
}

/** ↑↓ 在第一層之內循環。走到頭再按會回到另一端，不會卡住。 */
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
