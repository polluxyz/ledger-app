import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { RightPanelContext } from './right-panel-context';

/**
 * 右側欄狀態的提供者（spec 2i §4.2、plan D21）。欄位與內容怎麼分工見
 * `right-panel-context.ts`。
 *
 * **預設關閉、不記憶**（第二輪修訂 5）：右側欄只在使用者要記帳時出現——按
 * 「＋ 新增交易」或點一筆交易。記帳頁離開時（`RightPanelContent` 卸載）就關，
 * 回來時又是乾淨的版面。
 *
 * 寬螢幕推開中間內容、窄螢幕是蓋在上面的抽屜，差別全在 CSS，這裡不需要知道斷點。
 */
export function RightPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // 用計數而不是布林：換頁時新頁面的登記可能比舊頁面的取消先發生。
  const [registrations, setRegistrations] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  const isRegistered = registrations > 0;
  const isOpen = isRegistered && open;

  const openPanel = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  const requestFocus = useCallback(() => {
    setOpen(true);
    setFocusRequest((count) => count + 1);
  }, []);

  const register = useCallback(() => {
    setRegistrations((count) => count + 1);
    return () => {
      setRegistrations((count) => count - 1);
      setOpen(false);
    };
  }, []);

  const value = useMemo(
    () => ({
      isRegistered,
      isOpen,
      open: openPanel,
      close,
      requestFocus,
      focusRequest,
      slot,
      setSlot,
      register,
    }),
    [isRegistered, isOpen, openPanel, close, requestFocus, focusRequest, slot, register],
  );

  return <RightPanelContext.Provider value={value}>{children}</RightPanelContext.Provider>;
}
