import type { ReactNode } from 'react';
import styles from './PageContent.module.css';

interface PageContentProps {
  /** `wide`：記帳頁（總覽、交易）；`narrow`：管理頁。見 spec 2i §4.8。 */
  width: 'wide' | 'narrow';
  children: ReactNode;
}

/**
 * 在外殼的中間欄裡置中、並限制最大寬度的容器。
 *
 * 管理頁因為各自有好幾個 return 分支，改用 CSS 的 `composes` 取用同一份樣式
 * （見 `PageContent.module.css`），不必每個分支都包一層。
 */
export function PageContent({ width, children }: PageContentProps) {
  return <div className={styles[width]}>{children}</div>;
}
