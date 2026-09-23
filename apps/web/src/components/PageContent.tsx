import type { ReactNode } from 'react';
import styles from './PageContent.module.css';

/**
 * 在外殼的中間欄裡置中、並限制最大寬度的容器（spec 2i §4.8）。
 *
 * 管理頁因為各自有好幾個 return 分支，改用 CSS 的 `composes` 取用同一份樣式
 * （見 `PageContent.module.css`），不必每個分支都包一層。
 */
export function PageContent({ children }: { children: ReactNode }) {
  return <div className={styles.content}>{children}</div>;
}
