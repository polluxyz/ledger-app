import type { CSSProperties } from 'react';
import styles from './StatisticsListBar.module.css';

/** 清單內的裝飾橫條，長度以目前清單的最大金額為基準。 */
export function StatisticsListBar({
  amount,
  maximumAmount,
  color,
}: {
  amount: number;
  maximumAmount: number;
  color: string;
}) {
  const width = maximumAmount > 0 ? (amount / maximumAmount) * 100 : 0;
  return (
    <span className={styles.track} aria-hidden="true">
      <span
        className={styles.bar}
        data-testid="statistics-list-bar"
        style={{ width: `${width}%`, '--bar-color': color } as CSSProperties}
      />
    </span>
  );
}
