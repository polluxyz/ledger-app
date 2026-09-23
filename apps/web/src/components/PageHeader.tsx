import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

interface PageHeaderProps {
  /** 頁面標題，渲染成 `h2`（站名才是全站唯一的 `h1`）。 */
  title: string;
  /** 標題上方的一行小字，說明「現在在哪」，例如「日常開銷・私人帳本」。 */
  context?: ReactNode;
  /** 標題下方的一行說明。 */
  description?: ReactNode;
  /** 靠右的主要動作，例如「新增帳戶」按鈕。 */
  actions?: ReactNode;
}

/**
 * 所有頁面共用的頁首（phase-2h SC-24.5）。
 *
 * 2h 之前每一頁各寫各的 header，寬度與間距各不相同，換頁時標題會跳位置。
 * 統一之後，每一頁的標題都落在同一條左緣、同一個高度。
 *
 * **標題刻意是 `h2`。** 站名是全站唯一的 `h1`（`AppShell.test.tsx` 釘住），
 * 而 e2e 用 `getByRole('heading', { name: '分類' })` 這類選取器找頁面標題——
 * 標題文字與層級都不能變。
 */
export function PageHeader({ title, context, description, actions }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        {context && <p className={styles.context}>{context}</p>}
        <h2 className={styles.title}>{title}</h2>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
