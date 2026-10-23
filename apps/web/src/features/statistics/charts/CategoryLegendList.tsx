import type { CSSProperties } from 'react';
import type { StatisticsGroup } from '@ledger/shared';
import { formatMoney } from '../../../lib/format';
import { getStatisticsGroupColor, type ChartTheme } from './chart-colors';
import { fixedGroupLabel, formatPercentageBps } from './chart-format';
import styles from './CategoryLegendList.module.css';

/** 分類清單保留後端順序，使用 percentageBps 原值格式化百分比，不自行重算。 */
export interface CategoryLegendListProps {
  items: readonly StatisticsGroup[];
  direction: 'expense' | 'income';
  theme?: ChartTheme;
  onSelect?: (group: StatisticsGroup) => void;
}

export function CategoryLegendList({
  items,
  direction,
  theme = 'dark',
  onSelect,
}: CategoryLegendListProps) {
  return (
    <ul className={styles.list} aria-label={`${direction === 'expense' ? '支出' : '收入'}分類清單`}>
      {items.map((group) => {
        const name = group.category?.name ?? fixedGroupLabel(group.kind);
        const color = getStatisticsGroupColor(group, theme);
        const content = (
          <>
            <span className={styles.swatch} style={{ '--swatch-color': color } as CSSProperties} />
            <span className={styles.name}>{name}</span>
            <span className={styles.amount}>{formatMoney(group.amount)}</span>
            <span className={styles.percentage}>{formatPercentageBps(group.percentageBps)}</span>
          </>
        );

        return (
          <li className={styles.item} key={group.category?.id ?? group.kind}>
            {onSelect && group.kind === 'CATEGORY' ? (
              <button
                type="button"
                className={styles.selectable}
                aria-label={`${name}，${formatMoney(group.amount)}，${formatPercentageBps(group.percentageBps)}`}
                onClick={() => onSelect(group)}
              >
                {content}
              </button>
            ) : (
              <div className={styles.row}>{content}</div>
            )}
          </li>
        );
      })}
      {items.length === 0 && <li className={styles.empty}>沒有資料</li>}
    </ul>
  );
}
