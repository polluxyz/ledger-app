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
 * ## 「換頁就重置」怎麼做
 *
 * 只記「在哪一次瀏覽打開的」——React Router 每次導覽都會給 `location.key` 一個新值。
 * 右側欄開著 ⇔ 打開時記下的 key 等於現在的 key。換頁（包括離開再回到同一頁）key 就
 * 不同，右側欄自然算是關的；**不需要在換頁時去改任何 state**。
 *
 * 前兩個版本都踩過坑，留下來給之後的人：
 *
 * 1. 「面板內容卸載就關」：切換帳本時頁面以 `key={ledger.id}` 重建，右側欄會跟著關。
 * 2. 「路徑一變就在 render 期間把 open 設回 false」：React Router 7 的導覽走 transition，
 *    在分類頁交替按「新增支出分類／新增收入分類」再換頁時，舊的「開」會在之後的
 *    render 蓋回來，右側欄停在打開、內容卻是空的（2026-09-24 開發者回報的黑塊）。
 *
 * 切換帳本不會導覽，key 不變，右側欄照樣開著。分類頁自己的帳本選擇器會改網址的
 * `?ledgerId=`，那是一次導覽，右側欄會關——表單屬於上一本帳本，關掉是對的。
 *
 * 寬螢幕推開中間內容、窄螢幕是蓋在上面的抽屜，差別全在 CSS，這裡不需要知道斷點。
 */
export function RightPanelProvider({ children }: { children: ReactNode }) {
  const { key: locationKey } = useLocation();
  // 在哪一次瀏覽打開的；null＝關著。
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  // 用計數而不是布林：換頁時新頁面的登記可能比舊頁面的取消先發生。
  const [registrations, setRegistrations] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  const isRegistered = registrations > 0;
  const isOpen = isRegistered && openedAt === locationKey;

  const open = useCallback(() => setOpenedAt(locationKey), [locationKey]);
  const close = useCallback(() => setOpenedAt(null), []);

  const requestFocus = useCallback(() => {
    setOpenedAt(locationKey);
    setFocusRequest((count) => count + 1);
  }, [locationKey]);

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
