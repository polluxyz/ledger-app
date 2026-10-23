import { useState } from 'react';
import type { StatisticsTrendMonth } from '@ledger/shared';
import { formatMoney } from '../../../lib/format';
import styles from './TrendBarChart.module.css';

/** 趨勢長條圖以鍵盤可操作的月份按鈕呈現收入與支出，並顯示選定月份的 API 結果。 */
export interface TrendBarChartProps {
  months: readonly StatisticsTrendMonth[];
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
  title?: string;
}

export function TrendBarChart({
  months,
  selectedMonth,
  onSelectMonth,
  title = '趨勢長條圖',
}: TrendBarChartProps) {
  const [hoveredMonth, setHoveredMonth] = useState<string | null>(null);
  const [focusedMonth, setFocusedMonth] = useState<string | null>(null);
  const maximumAmount = Math.max(0, ...months.flatMap((month) => [month.income, month.expense]));
  const selected =
    months.find((month) => month.month === focusedMonth) ??
    months.find((month) => month.month === hoveredMonth) ??
    months.find((month) => month.month === selectedMonth);

  return (
    <section className={styles.wrapper} aria-label={title}>
      {selected && (
        <dl className={styles.summary} aria-live="polite">
          <div>
            <dt>收入</dt>
            <dd>{formatMoney(selected.income)}</dd>
          </div>
          <div>
            <dt>支出</dt>
            <dd>{formatMoney(selected.expense)}</dd>
          </div>
          <div>
            <dt>結餘</dt>
            <dd>{formatMoney(selected.net)}</dd>
          </div>
        </dl>
      )}
      {months.length > 0 ? (
        <ol className={styles.months} aria-label="每月收支">
          {months.map((month) => {
            const monthLabel = formatMonth(month.month);
            const ariaLabel = `${monthLabel}，收入 ${formatMoney(month.income)}，支出 ${formatMoney(month.expense)}，結餘 ${formatMoney(month.net)}`;
            const incomeHeight = maximumAmount > 0 ? (month.income / maximumAmount) * 100 : 0;
            const expenseHeight = maximumAmount > 0 ? (month.expense / maximumAmount) * 100 : 0;
            return (
              <li key={month.month} className={styles.month}>
                <button
                  type="button"
                  className={styles.monthButton}
                  aria-label={ariaLabel}
                  aria-pressed={month.month === selectedMonth}
                  onPointerEnter={() => setHoveredMonth(month.month)}
                  onPointerLeave={() => setHoveredMonth(null)}
                  onFocus={() => setFocusedMonth(month.month)}
                  onBlur={() => setFocusedMonth(null)}
                  onClick={() => onSelectMonth(month.month)}
                >
                  <span className={styles.bars} aria-hidden="true">
                    <span className={styles.incomeBar} style={{ height: `${incomeHeight}%` }} />
                    <span className={styles.expenseBar} style={{ height: `${expenseHeight}%` }} />
                  </span>
                  <span className={styles.monthLabel}>{monthLabel}</span>
                </button>
              </li>
            );
          })}
        </ol>
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
