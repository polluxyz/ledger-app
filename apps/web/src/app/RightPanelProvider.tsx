import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { RightPanelContext } from './right-panel-context';

/**
 * 右側欄狀態的提供者（spec 2i §4.2、plan D21）。欄位與內容怎麼分工見
 * `right-panel-context.ts`。
 *
 * **預設關閉、不記憶、換頁就重置**（第二輪修訂 5、第三輪 SC-44）：右側欄只在使用者
 * 要記帳或新增東西時出現。
 *
 * 「換頁」用**網址**判斷，而不是「面板內容卸載了沒」：切換帳本時頁面會整個重建
 * （`key={ledger.id}`），內容會卸載再掛上，但使用者並沒有離開這一頁——正在記帳時
 * 換一本帳本，右側欄不該突然關掉。
 *
 * 第二輪只記「在哪個路徑打開的」，結果離開總覽再回來，路徑又一樣，右側欄就自己
 * 打開了（SC-44 的起因）。現在改成：路徑一變就把打開狀態清掉。用「在 render 期間
 * 依變化調整 state」的寫法（React 官方建議），不用 effect——effect 會先畫出一幀
 * 開著的右側欄再關掉。
 *
 * 寬螢幕推開中間內容、窄螢幕是蓋在上面的抽屜，差別全在 CSS，這裡不需要知道斷點。
 */
export function RightPanelProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [seenPath, setSeenPath] = useState(pathname);
  // 用計數而不是布林：換頁時新頁面的登記可能比舊頁面的取消先發生。
  const [registrations, setRegistrations] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  if (pathname !== seenPath) {
    setSeenPath(pathname);
    setOpen(false);
  }

  const isRegistered = registrations > 0;
  const isOpen = isRegistered && open && pathname === seenPath;

  const openPanel = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  const requestFocus = useCallback(() => {
    setOpen(true);
    setFocusRequest((count) => count + 1);
  }, []);

  const register = useCallback(() => {
    setRegistrations((count) => count + 1);
    return () => setRegistrations((count) => count - 1);
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
