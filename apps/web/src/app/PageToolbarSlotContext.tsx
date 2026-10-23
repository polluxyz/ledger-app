import { createContext, useContext } from 'react';

/**
 * 頂端橫條把自己的內層節點登記在這裡，讓頁面以 portal 放入當前路由專屬的內容。
 * Context 不持有輸入或草稿狀態，避免共用外殼延長頁面資料的生命週期。
 */
export interface PageToolbarSlotContextValue {
  element: HTMLDivElement | null;
  setElement: (element: HTMLDivElement | null) => void;
}

export const PageToolbarSlotContext = createContext<PageToolbarSlotContextValue | null>(null);

export function usePageToolbarSlot() {
  const context = useContext(PageToolbarSlotContext);
  if (!context) {
    throw new Error('usePageToolbarSlot 必須在 PageToolbarSlotProvider 內使用。');
  }
  return context;
}
