import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ErrorBoundary } from '../components/ErrorBoundary';

/**
 * 包住頁面內容的錯誤邊界：某一頁出錯時只換掉中間欄，側欄還能點到別頁。
 *
 * 以 `location.key` 當 `resetKey`：每一次導覽都會換一個新的 key，所以切到別頁、
 * 或點同一頁的連結（路徑相同、查詢字串不同）都會清掉錯誤，不必重新整理。
 */
export function PageErrorBoundary({ children }: { children: ReactNode }) {
  const { key } = useLocation();
  return <ErrorBoundary resetKey={key}>{children}</ErrorBoundary>;
}
