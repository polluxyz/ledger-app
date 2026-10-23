import { useState } from 'react';
import type { StatisticsTrendMonth } from '@ledger/shared';
import { formatMoney } from '../../../lib/format';
import styles from './TrendLineChart.module.css';

/** 趨勢折線圖只換算點位；SVG 的無障礙名稱列出每月收入、支出與結餘。 */
export interface TrendLineChartProps {
  months: readonly StatisticsTrendMonth[];
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
  title?: string;
}

const WIDTH = 720;
const HEIGHT = 220;
const PADDING = 20;

export function TrendLineChart({
  months,
  selectedMonth,
  onSelectMonth,
  title = '趨勢折線圖',
}: TrendLineChartProps) {
  const [hoveredMonth, setHoveredMonth] = useState<string | null>(null);
  const [focusedMonth, setFocusedMonth] = useState<string | null>(null);
  const values = months.flatMap((month) => [month.income, month.expense]);
  const minimumAmount = Math.min(0, ...values);
  const maximumAmount = Math.max(0, ...values);
  const amountRange = maximumAmount - minimumAmount;
  const availableHeight = HEIGHT - PADDING * 2;
  const yFor = (amount: number) =>
    amountRange > 0
      ? PADDING + ((maximumAmount - amount) / amountRange) * availableHeight
      : HEIGHT - PADDING;
  const xFor = (index: number) =>
    months.length <= 1 ? WIDTH / 2 : (index / (months.length - 1)) * WIDTH;
  const activeMonth =
    months.find((month) => month.month === focusedMonth) ??
    months.find((month) => month.month === hoveredMonth) ??
    months.find((month) => month.month === selectedMonth);
  const incomePoints = months
    .map((month, index) => `${xFor(index)},${yFor(month.income)}`)
    .join(' ');
  const expensePoints = months
    .map((month, index) => `${xFor(index)},${yFor(month.expense)}`)
    .join(' ');
  const showZeroLine = values.some((value) => value <= 0) || months.some((month) => month.net <= 0);
  const chartLabel = [
    title,
    ...months.map(
      (month) =>
        `${formatMonth(month.month)}：收入 ${formatMoney(month.income)}，支出 ${formatMoney(month.expense)}，結餘 ${formatMoney(month.net)}`,
    ),
  ].join('；');

  return (
    <section className={styles.wrapper} aria-label={title}>
      {activeMonth && (
        <dl className={styles.summary} aria-live="polite">
          <div>
            <dt>收入</dt>
            <dd>{formatMoney(activeMonth.income)}</dd>
          </div>
          <div>
            <dt>支出</dt>
            <dd>{formatMoney(activeMonth.expense)}</dd>
          </div>
          <div>
            <dt>結餘</dt>
            <dd>{formatMoney(activeMonth.net)}</dd>
          </div>
        </dl>
      )}
      <div className={styles.legend}>
        <span className={styles.incomeKey}>收入</span>
        <span className={styles.expenseKey}>支出</span>
      </div>
      {months.length > 0 ? (
        <>
          <div className={styles.plot}>
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
                  y1={yFor(0)}
                  y2={yFor(0)}
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
            <div className={styles.targets}>
              {months.map((month, index) => {
                const left = index === 0 ? 0 : ((index - 0.5) / (months.length - 1)) * 100;
                const right =
                  index === months.length - 1 ? 100 : ((index + 0.5) / (months.length - 1)) * 100;
                const monthLabel = formatMonth(month.month);
                const ariaLabel = `${monthLabel}：收入 ${formatMoney(month.income)}，支出 ${formatMoney(month.expense)}，結餘 ${formatMoney(month.net)}`;
                return (
                  <button
                    key={month.month}
                    type="button"
                    className={styles.monthTarget}
                    style={{ left: `${left}%`, width: `${right - left}%` }}
                    aria-label={ariaLabel}
                    aria-pressed={month.month === selectedMonth}
                    onPointerEnter={() => setHoveredMonth(month.month)}
                    onPointerLeave={() => setHoveredMonth(null)}
                    onFocus={() => setFocusedMonth(month.month)}
                    onBlur={() => setFocusedMonth(null)}
                    onClick={() => onSelectMonth(month.month)}
                  />
                );
              })}
            </div>
          </div>
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
