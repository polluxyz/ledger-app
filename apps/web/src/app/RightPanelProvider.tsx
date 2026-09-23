import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { RightPanelContext } from './right-panel-context';

/**
 * 右側欄狀態的提供者（spec 2i §4.2、plan D21）。欄位與內容怎麼分工見
 * `right-panel-context.ts`。
 *
 * **預設關閉、不記憶、換頁就關**（第二輪修訂 5）：右側欄只在使用者要記帳時出現——
 * 按「＋ 新增交易」或點一筆交易。
 *
 * 「換頁就關」用**網址**判斷，而不是「面板內容卸載了沒」：切換帳本時頁面會整個
 * 重建（`key={ledger.id}`），內容會卸載再掛上，但使用者並沒有離開這一頁——正在
 * 記帳時換一本帳本，右側欄不該突然關掉。所以只記「在哪個路徑打開的」，路徑一變
 * 就視為關閉，不需要任何 effect。
 *
 * 寬螢幕推開中間內容、窄螢幕是蓋在上面的抽屜，差別全在 CSS，這裡不需要知道斷點。
 */
export function RightPanelProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  // 在哪個路徑打開的；null＝關著。
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  // 用計數而不是布林：換頁時新頁面的登記可能比舊頁面的取消先發生。
  const [registrations, setRegistrations] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  const isRegistered = registrations > 0;
  const isOpen = isRegistered && openedAt === pathname;

  const open = useCallback(() => setOpenedAt(pathname), [pathname]);
  const close = useCallback(() => setOpenedAt(null), []);

  const requestFocus = useCallback(() => {
    setOpenedAt(pathname);
    setFocusRequest((count) => count + 1);
  }, [pathname]);

  const register = useCallback(() => {
    setRegistrations((count) => count + 1);
    return () => setRegistrations((count) => count - 1);
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
