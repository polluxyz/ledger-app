import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

interface PageHeaderProps {
  /** 頁面標題，渲染成 `h2`（站名才是全站唯一的 `h1`）。 */
  title: string;
  /** 標題下方的一行說明。 */
  description?: ReactNode;
  /** 標題同一排右邊的頁面層級動作（「＋ 新增交易」這類按鈕）。 */
  actions?: ReactNode;
}

/**
 * 所有頁面共用的頁首（phase-2h SC-24.5、spec 2i SC-38.5）。
 *
 * 2h 之前每一頁各寫各的 header，寬度與間距各不相同，換頁時標題會跳位置。
 * 統一之後，每一頁的標題都落在同一條左緣、同一個高度。
 *
 * **標題永遠是第一個東西。** 2i 曾把「標題上方那一行」（帳本切換器、返回連結）
 * 與「標題右邊的按鈕」全部移到中間區最上方的橫條；2026-10-07 橫條清空留給 AI
 * 功能之後，按鈕回到頁面內容——經由 `actions` 放在標題同一排的右邊，不佔掉
 * 標題上方那一行，每一頁的標題仍然落在同一條線上。返回連結之類「標題上方」的
 * 東西由各頁自己放在 `<PageHeader>` 之前。
 *
 * **標題刻意是 `h2`。** 站名是全站唯一的 `h1`（`AppShell.test.tsx` 釘住），
 * 而 e2e 用 `getByRole('heading', { name: '分類' })` 這類選取器找頁面標題——
 * 標題文字與層級都不能變。
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <h2 className={styles.title}>{title}</h2>
      {actions && <div className={styles.actions}>{actions}</div>}
      {description && <p className={styles.description}>{description}</p>}
    </header>
  );
}
