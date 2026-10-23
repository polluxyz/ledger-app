import type { StatisticsTrendMonth } from '@ledger/shared';
import { formatMoney } from '../../../lib/format';
import styles from './TrendLineChart.module.css';

/** 趨勢折線圖只換算點位；SVG 的無障礙名稱列出每月收入、支出與結餘。 */
export interface TrendLineChartProps {
  months: readonly StatisticsTrendMonth[];
  title?: string;
}

const WIDTH = 720;
const HEIGHT = 220;
const PADDING = 20;

export function TrendLineChart({ months, title = '趨勢折線圖' }: TrendLineChartProps) {
  const maximumAmount = Math.max(0, ...months.flatMap((month) => [month.income, month.expense]));
  const availableHeight = HEIGHT - PADDING * 2;
  const yFor = (amount: number) =>
    maximumAmount > 0 ? PADDING + (1 - amount / maximumAmount) * availableHeight : HEIGHT - PADDING;
  const xFor = (index: number) =>
    months.length <= 1 ? WIDTH / 2 : (index / (months.length - 1)) * WIDTH;
  const incomePoints = months
    .map((month, index) => `${xFor(index)},${yFor(month.income)}`)
    .join(' ');
  const expensePoints = months
    .map((month, index) => `${xFor(index)},${yFor(month.expense)}`)
    .join(' ');
  const showZeroLine = months.some(
    (month) => month.net <= 0 || month.income < 0 || month.expense < 0,
  );
  const chartLabel = [
    title,
    ...months.map(
      (month) =>
        `${formatMonth(month.month)}：收入 ${formatMoney(month.income)}，支出 ${formatMoney(month.expense)}，結餘 ${formatMoney(month.net)}`,
    ),
  ].join('；');

  return (
    <section className={styles.wrapper} aria-label={title}>
      <div className={styles.legend}>
        <span className={styles.incomeKey}>收入</span>
        <span className={styles.expenseKey}>支出</span>
      </div>
      {months.length > 0 ? (
        <>
          <svg
            className={styles.svg}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={chartLabel}
          >
            {showZeroLine && (
              <line
                x1="0"
                x2={WIDTH}
                y1={HEIGHT - PADDING}
                y2={HEIGHT - PADDING}
                className={styles.zeroLine}
                data-zero-line="true"
              />
            )}
            {months.length > 1 && (
              <>
                <polyline points={incomePoints} className={styles.incomeLine} />
                <polyline points={expensePoints} className={styles.expenseLine} />
              </>
            )}
            {months.map((month, index) => (
              <g key={month.month}>
                <circle
                  cx={xFor(index)}
                  cy={yFor(month.income)}
                  r="4"
                  className={styles.incomePoint}
                />
                <circle
                  cx={xFor(index)}
                  cy={yFor(month.expense)}
                  r="4"
                  className={styles.expensePoint}
                />
              </g>
            ))}
          </svg>
          <ol className={styles.months} aria-hidden="true">
            {months.map((month) => (
              <li key={month.month}>{formatMonth(month.month)}</li>
            ))}
          </ol>
        </>
      ) : (
        <p className={styles.empty}>沒有資料</p>
      )}
    </section>
  );
}

function formatMonth(month: string): string {
  const [year, monthNumber] = month.split('-');
  return `${year}年${Number(monthNumber)}月`;
}
