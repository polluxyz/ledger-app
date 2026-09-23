import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { RIGHT_PANEL_COLLAPSED_KEY, RightPanelContext } from './right-panel-context';

/**
 * 右側欄狀態的提供者（spec 2i §4.2、plan D21）。欄位與內容怎麼分工見
 * `right-panel-context.ts`。
 *
 * ## 兩種「打開」
 *
 * - **≥ 901px**：右側欄常駐（D2-A：第一次使用的人要一眼看到在哪裡記帳），使用者
 *   收起後記在 localStorage，總覽與交易頁共用同一個狀態。
 * - **≤ 900px**：右側欄是蓋在內容上的抽屜，預設關閉、**不記憶**——窄螢幕上它會
 *   蓋住整個內容，重新整理後還蓋著只會擋路。
 *
 * 斷點原則上只寫在 CSS（2h D10），這裡是唯一的例外：「要不要寫進 localStorage」
 * 是行為而不是外觀，CSS 做不到。jsdom 沒有 `matchMedia`，當成寬螢幕。
 */
const NARROW_QUERY = '(max-width: 900px)';

function subscribeNarrow(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function isNarrowNow(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches;
}

/** 讀寫都包 `try`：隱私模式下 localStorage 會拋錯，失敗一律當成「打開」。 */
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(RIGHT_PANEL_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) {
      localStorage.setItem(RIGHT_PANEL_COLLAPSED_KEY, 'true');
    } else {
      // 與側欄收合（`use-sidebar-collapsed`）同一個慣例：預設狀態就是「沒有值」。
      localStorage.removeItem(RIGHT_PANEL_COLLAPSED_KEY);
    }
  } catch {
    // 存不了就只在這次瀏覽有效。
  }
}

export function RightPanelProvider({ children }: { children: ReactNode }) {
  const isNarrow = useSyncExternalStore(subscribeNarrow, isNarrowNow, () => false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 用計數而不是布林：換頁時新頁面的登記可能比舊頁面的取消先發生。
  const [registrations, setRegistrations] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  const isRegistered = registrations > 0;
  const isOpen = isRegistered && (isNarrow ? drawerOpen : !collapsed);

  const open = useCallback(() => {
    if (isNarrow) {
      setDrawerOpen(true);
    } else {
      setCollapsed(false);
      writeCollapsed(false);
    }
  }, [isNarrow]);

  const close = useCallback(() => {
    if (isNarrow) {
      setDrawerOpen(false);
    } else {
      setCollapsed(true);
      writeCollapsed(true);
    }
  }, [isNarrow]);

  const requestFocus = useCallback(() => {
    open();
    setFocusRequest((count) => count + 1);
  }, [open]);

  const register = useCallback(() => {
    setRegistrations((count) => count + 1);
    return () => {
      setRegistrations((count) => count - 1);
      // 離開記帳頁時抽屜一定要收起來，否則回來時它還蓋在內容上。
      setDrawerOpen(false);
    };
  }, []);

  const value = useMemo(
    () => ({
      isRegistered,
      isOpen,
      open,
      close,
      requestFocus,
      focusRequest,
      slot,
      setSlot,
      register,
    }),
    [isRegistered, isOpen, open, close, requestFocus, focusRequest, slot, register],
  );

  return <RightPanelContext.Provider value={value}>{children}</RightPanelContext.Provider>;
}
