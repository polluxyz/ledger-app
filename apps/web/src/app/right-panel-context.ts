import { createContext, useContext } from 'react';

/**
 * 右側欄的共用狀態（spec 2i §4.2、plan D21）。
 *
 * 右側欄的**欄位**屬於外殼（`RightPanel`，放在 `App` 的第三欄），**內容**屬於頁面
 * （記帳頁用 `RightPanelContent` 把表單 portal 過去）。兩邊透過這個 context 溝通：
 *
 * - 頁面 mount 時 `register()` 登記「這一頁有右側欄」，unmount 時取消——
 *   沒有頁面登記時第三欄寬度是 0，管理頁完全不知道右側欄存在。
 * - 「＋ 新增交易」呼叫 `requestFocus()`：打開右側欄，並讓表單把焦點移到金額欄。
 *
 * 型別與 hook 放在這個 `.ts` 檔，Provider 與元件放在 `.tsx`——React fast refresh
 * 的 lint 規則不允許元件檔同時匯出 hook。
 */
export interface RightPanelState {
  /** 目前的頁面有沒有右側欄（至少一個 `RightPanelContent` 掛著）。 */
  isRegistered: boolean;
  /** 有登記、而且是打開的。預設關閉、不記憶，換頁就關（spec 2i 第二輪修訂 5）。 */
  isOpen: boolean;
  open: () => void;
  close: () => void;
  /** 打開，並要求表單把焦點移到第一個欄位（「＋ 新增交易」用）。 */
  requestFocus: () => void;
  /**
   * 每次 `requestFocus()` 加 1。表單在 effect 裡看到它變了就 focus。
   * 用遞增的數字而不是布林：連按兩次「＋ 新增交易」也要兩次都 focus。
   */
  focusRequest: number;
  /** portal 的目標；`RightPanel` 第一次 commit 後才會有值。 */
  slot: HTMLElement | null;
  setSlot: (element: HTMLElement | null) => void;
  /** 登記，回傳取消登記的函式（直接當 effect 的 cleanup 用）。 */
  register: () => () => void;
}

export const RightPanelContext = createContext<RightPanelState | null>(null);

export function useRightPanel(): RightPanelState {
  const value = useContext(RightPanelContext);
  if (!value) {
    throw new Error('useRightPanel 必須在 RightPanelProvider 之內使用');
  }
  return value;
}
