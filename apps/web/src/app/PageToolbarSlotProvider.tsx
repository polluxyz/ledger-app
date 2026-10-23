import { useState, type ReactNode } from 'react';
import { PageToolbarSlotContext } from './PageToolbarSlotContext';

/**
 * 讓頁面把單一元件放進外殼的頂端橫條。插槽節點由橫條註冊，頁面卸載時 portal
 * 也會隨頁面一起卸載，因此這裡只管理節點，不保存頁面內容。
 */
export function PageToolbarSlotProvider({ children }: { children: ReactNode }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);

  return (
    <PageToolbarSlotContext.Provider value={{ element, setElement }}>
      {children}
    </PageToolbarSlotContext.Provider>
  );
}
