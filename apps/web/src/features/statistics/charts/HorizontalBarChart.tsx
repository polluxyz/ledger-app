import type { CSSProperties } from 'react';
import type { Cents, StatisticsGroup, StatisticsPerson } from '@ledger/shared';
import { formatMoney } from '../../../lib/format';
import { getChartColorForId, getStatisticsGroupColor, type ChartTheme } from './chart-colors';
import { fixedGroupLabel } from './chart-format';
import styles from './HorizontalBarChart.module.css';

/** 橫條圖保留 API 傳入的順序與全部項目；長文字和金額可以換行閱讀。 */
export interface HorizontalBarChartProps {
  direction: 'expense' | 'income';
  title?: string;
  theme?: ChartTheme;
  data:
    | { kind: 'groups'; items: readonly StatisticsGroup[] }
    | { kind: 'people'; items: readonly StatisticsPerson[] };
}

interface BarRow {
  id: string;
  label: string;
  amount: Cents;
  color: string;
}

export function HorizontalBarChart({
  direction,
  title,
  theme = 'dark',
  data,
}: HorizontalBarChartProps) {
  const rows: BarRow[] =
    data.kind === 'groups'
      ? data.items.map((group) => ({
          id: group.category?.id ?? group.kind,
          label: group.category?.name ?? fixedGroupLabel(group.kind),
          amount: group.amount,
          color: getStatisticsGroupColor(group, theme),
        }))
      : data.items.map((person) => ({
          id: person.personId,
          label: person.name,
          amount: direction === 'expense' ? person.expense : person.income,
          color: getChartColorForId(person.personId, theme),
        }));
  const maximumAmount = Math.max(0, ...rows.map((row) => row.amount));

  return (
    <section className={styles.wrapper} aria-label={title ?? `${directionLabel(direction)}長條圖`}>
      <ul className={styles.list}>
        {rows.map((row) => {
          const width = maximumAmount > 0 ? (row.amount / maximumAmount) * 100 : 0;
          return (
            <li className={styles.row} key={row.id}>
              <span className={styles.name}>{row.label}</span>
              <span
                aria-hidden="true"
                className={styles.track}
                style={{ '--bar-color': row.color } as CSSProperties}
              >
                <span className={styles.bar} style={{ width: `${width}%` }} />
              </span>
              <span className={styles.amount}>{formatMoney(row.amount)}</span>
            </li>
          );
        })}
      </ul>
      {rows.length === 0 && <p className={styles.empty}>沒有資料</p>}
    </section>
  );
}

function directionLabel(direction: 'expense' | 'income'): string {
  return direction === 'expense' ? '支出' : '收入';
}
