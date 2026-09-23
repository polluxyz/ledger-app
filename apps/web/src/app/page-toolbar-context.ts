import { createContext, useContext } from 'react';

/**
 * 中間區最上方橫條的兩個插槽（spec 2i SC-38、第二輪修訂 3、4）。
 *
 * 橫條本身屬於外殼（`PageToolbar`，每一頁都在同一個位置），內容屬於頁面：
 * 總覽與交易把帳本切換器放左邊、各頁把「頁面層級的主要按鈕」放右邊。頁面用
 * `PageToolbarStart`／`PageToolbarActions` 把東西 portal 過去，做法與右側欄相同。
 *
 * 為什麼不讓每一頁自己畫橫條：橫條要在同一個位置、捲動時固定在上方，而且與
 * 內容包裝同寬。每一頁各畫一次的話，這三件事都得各自做對一次。
 *
 * 型別與 hook 放在這個 `.ts` 檔，元件放在 `PageToolbar.tsx`——React fast refresh
 * 的 lint 規則不允許元件檔同時匯出 hook。
 */
export interface PageToolbarSlots {
  start: HTMLElement | null;
  end: HTMLElement | null;
  setStart: (element: HTMLElement | null) => void;
  setEnd: (element: HTMLElement | null) => void;
}

export const PageToolbarContext = createContext<PageToolbarSlots | null>(null);

export function usePageToolbar(): PageToolbarSlots {
  const value = useContext(PageToolbarContext);
  if (!value) {
    throw new Error('usePageToolbar 必須在 PageToolbarProvider 之內使用');
  }
  return value;
}
