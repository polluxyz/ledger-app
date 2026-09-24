import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavigationType, useLocation, useNavigationType } from 'react-router-dom';
import { RightPanelContext } from './right-panel-context';

/**
 * 右側欄狀態的提供者（spec 2i §4.2、plan D21）。欄位與內容怎麼分工見
 * `right-panel-context.ts`。
 *
 * **預設關閉、不記憶，一般導覽會收起**（第二輪修訂 5、第三輪 SC-44）。交易頁切換
 * 「明細／借還」會帶 `keepRightPanel`，讓這個單一導覽可以沿用原本的開啟狀態（W15）。
 *
 * ## 「換頁就重置」怎麼做
 *
 * 只記「在哪一次瀏覽打開的」——React Router 每次導覽都會給 `location.key` 一個新值。
 * 右側欄開著 ⇔ 打開時記下的 key 等於現在的 key。一般導覽與瀏覽器上一頁／下一頁都會
 * 換 key，右側欄自然收起；W15 只在明確帶旗標的非 POP 導覽後，於 layout effect 把記號
 * 移到新 key。這樣不在 render 期間更新 state，也能在瀏覽器繪製前保留面板。
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
  const location = useLocation();
  const locationKey = location.key;
  const navigationType = useNavigationType();
  const previousLocationKey = useRef<string | null>(null);
  // 在哪一次瀏覽打開的；null＝關著。
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  // 用計數而不是布林：換頁時新頁面的登記可能比舊頁面的取消先發生。
  const [registrations, setRegistrations] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  const isRegistered = registrations > 0;
  const isOpen = isRegistered && openedAt === locationKey;

  useLayoutEffect(() => {
    const previousKey = previousLocationKey.current;
    if (previousKey !== null && previousKey !== locationKey) {
      const keepRightPanel = hasKeepRightPanelFlag(location.state as unknown);

      // 切換交易頁檢視會換 location key。只有旗標明確要求、而且上一頁真的開著時，
      // 才把開啟記號搬到新 key；layout effect 在繪製前完成，避免側欄閃成黑塊。
      if (
        navigationType !== NavigationType.Pop &&
        keepRightPanel &&
        isRegistered &&
        openedAt === previousKey
      ) {
        setOpenedAt(locationKey);
      } else if (openedAt === previousKey) {
        // 清除舊 key 上的開啟記號，避免瀏覽器返回舊 history entry 時又意外打開側欄。
        setOpenedAt(null);
      }
    }
    previousLocationKey.current = locationKey;
  }, [isRegistered, location.key, location.state, locationKey, navigationType, openedAt]);

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

/** 只接受明確為 true 的導覽旗標，任意 location state 都維持一般收起行為。 */
function hasKeepRightPanelFlag(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    'keepRightPanel' in state &&
    state.keepRightPanel === true
  );
}
