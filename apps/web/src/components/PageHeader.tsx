import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

interface PageHeaderProps {
  /** 頁面標題，渲染成 `h2`（站名才是全站唯一的 `h1`）。 */
  title: string;
  /** 標題下方的一行說明。 */
  description?: ReactNode;
}

/**
 * 所有頁面共用的頁首（phase-2h SC-24.5、spec 2i SC-38.5）。
 *
 * 2h 之前每一頁各寫各的 header，寬度與間距各不相同，換頁時標題會跳位置。
 * 統一之後，每一頁的標題都落在同一條左緣、同一個高度。
 *
 * **只剩標題與說明。** 2i 第二輪修訂把「標題上方那一行」（帳本切換器、返回連結）
 * 與「標題右邊的頁面層級按鈕」全部移到中間區最上方的橫條，頁面改用
 * `PageToolbarStart` / `PageToolbarActions` 放進去。標題上方沒有東西之後，每一頁
 * 的標題才真的落在同一條線上（SC-38.5）。原本的 `context` 與 `actions` 兩個插槽
 * 因此沒有任何頁面在用，一併移除——留著等於留一條「其實不該走」的路。
 *
 * **標題刻意是 `h2`。** 站名是全站唯一的 `h1`（`AppShell.test.tsx` 釘住），
 * 而 e2e 用 `getByRole('heading', { name: '分類' })` 這類選取器找頁面標題——
 * 標題文字與層級都不能變。
 */
export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <h2 className={styles.title}>{title}</h2>
      {description && <p className={styles.description}>{description}</p>}
    </header>
  );
}
