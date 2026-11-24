import { useEffect, useRef, useState } from 'react';
import type { StatisticsTrendMonth } from '@ledger/shared';
import { formatMoney } from '../../../lib/format';
import { getFinancialTrendLayout } from '../financial-trend-layout';
import { currentTaiwanMonthRange } from '../stats-url';
import styles from './StatisticsTrendChart.module.css';

interface StatisticsTrendChartProps {
  months: readonly StatisticsTrendMonth[];
  averageIncome: number | null;
  averageExpense: number | null;
  selectedMonth: string;
  showSelectedDetails: boolean;
  onSelectMonth: (month: string) => void;
}

const TITLE = '每月收支圖';
const HEIGHT = 240;
const SERIES = [
  { field: 'income', label: '收入', className: styles.income },
  { field: 'expense', label: '支出', className: styles.expense },
] as const;
const DETAILS = [...SERIES, { field: 'net', label: '結餘' }] as const;

/** 每月收入與支出以零線為界，與後端月平均共用刻度。 */
export function StatisticsTrendChart({
  months,
  averageIncome,
  averageExpense,
  selectedMonth,
  showSelectedDetails,
  onSelectMonth,
}: StatisticsTrendChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(640);
  const [hoveredMonth, setHoveredMonth] = useState<string | null>(null);
  const [focusedMonth, setFocusedMonth] = useState<string | null>(null);
  const hasMonths = months.length > 0;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, [hasMonths]);

  if (!hasMonths) return <p role="status">沒有每月收支資料</p>;

  const activeMonth = hoveredMonth ?? focusedMonth ?? selectedMonth;
  const detail =
    showSelectedDetails || activeMonth !== selectedMonth
      ? months.find((month) => month.month === activeMonth)
      : undefined;
  const averages = SERIES.flatMap((series) => {
    const amount = series.field === 'income' ? averageIncome : averageExpense;
    return amount === null
      ? []
      : [{ ...series, amount, plottedAmount: series.field === 'expense' ? -amount : amount }];
  });
  const monthlyAmounts = months.flatMap((month) => [month.income, -month.expense]);
  const layout = getFinancialTrendLayout(
    [...monthlyAmounts, ...averages.map(({ plottedAmount }) => plottedAmount)],
    width,
    HEIGHT,
  );
  // 共用刻度，月份欄寬獨立計算，避免平均值占用月份欄位。
  const slotWidth = (layout.right - layout.left) / months.length;
  const barWidth = Math.min(30, slotWidth * 0.28);
  const lastIndex = months.length - 1;
  const currentMonth = currentTaiwanMonthRange().from.slice(0, 7);
  const endsThisMonth = months[lastIndex]?.month === currentMonth;

  return (
    <section className={styles.wrapper} aria-label={TITLE}>
      <ul className={styles.legend} aria-label="圖例">
        {SERIES.map(({ field, label, className }) => (
          <li key={field}>
            <span className={className} aria-hidden="true" />
            {label}
          </li>
        ))}
        {averages.map(({ field, label, className, amount }) => (
          <li key={`average-${field}`}>
            <span className={`${className} ${styles.averageKey}`} aria-hidden="true" />
            {`${label}月均 ${formatMoney(amount)}`}
          </li>
        ))}
      </ul>
      <div className={styles.detail} aria-live="polite">
        {detail && (
          <dl aria-label={formatMonth(detail.month)}>
            {DETAILS.map(({ field, label }) => (
              <div key={field}>
                <dt>{label}</dt>
                <dd>{formatMoney(detail[field])}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <svg
        ref={svgRef}
        className={styles.chart}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="group"
        aria-label={TITLE}
        onMouseLeave={() => setHoveredMonth(null)}
      >
        {layout.ticks.map(({ amount, y, zero }) => (
          <g key={y} aria-hidden="true">
            {!zero && (
              <line className={styles.grid} x1={layout.left} x2={layout.right} y1={y} y2={y} />
            )}
            <text x={layout.left - 8} y={y + 3} textAnchor="end">
              {formatTick(amount)}
            </text>
          </g>
        ))}
        <line
          data-trend-zero=""
          className={styles.zero}
          x1={layout.left}
          x2={layout.right}
          y1={layout.baseline}
          y2={layout.baseline}
        />
        {months.map((month, index) => {
          const x = layout.left + slotWidth * (index + 0.5);
          const firstBar = index * SERIES.length;
          const isCurrentMonth = endsThisMonth && index === lastIndex;
          return (
            <g
              key={month.month}
              role="button"
              tabIndex={0}
              data-month={month.month}
              aria-pressed={month.month === selectedMonth}
              aria-label={`${formatMonth(month.month)}：${DETAILS.map(({ field, label }) => `${label} ${formatMoney(month[field])}`).join('，')}${isCurrentMonth ? '，截至今天' : ''}`}
              onMouseEnter={() => setHoveredMonth(month.month)}
              onFocus={() => {
                setFocusedMonth(month.month);
                setHoveredMonth(null);
              }}
              onBlur={() => setFocusedMonth(null)}
              onClick={() => onSelectMonth(month.month)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectMonth(month.month);
                } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  const offset = event.key === 'ArrowRight' ? 1 : -1;
                  const next = (index + offset + months.length) % months.length;
                  svgRef.current
                    ?.querySelectorAll<SVGGElement>('[data-month]')
                    [next]?.focus({ preventScroll: true });
                }
              }}
            >
              <rect
                className={styles.target}
                x={x - slotWidth / 2}
                y={0}
                height={HEIGHT}
                width={slotWidth}
              />
              {SERIES.map(({ field, className }, offset) => {
                const bar = layout.bars[firstBar + offset]!;
                // 非零小額至少顯示 1px，仍從零線向各自的方向延伸。
                const height = month[field] === 0 ? 0 : Math.max(1, bar.height);
                return (
                  <rect
                    key={field}
                    data-series={field}
                    className={className}
                    x={x - barWidth / 2}
                    y={field === 'income' ? layout.baseline - height : layout.baseline}
                    width={barWidth}
                    height={height}
                    rx={2}
                  />
                );
              })}
              {(width > 440 ||
                (index % 2 === 0 && index < lastIndex - 1) ||
                index === lastIndex) && (
                <text data-month-label="" x={x} y={HEIGHT - 18} textAnchor="middle">
                  {Number(month.month.slice(5))}月
                </text>
              )}
            </g>
          );
        })}
        {endsThisMonth && (
          <text x={layout.right} y={HEIGHT - 3} textAnchor="end" aria-hidden="true">
            截至今天
          </text>
        )}
        {averages.map(({ field, className }, index) => {
          const y = layout.bars[monthlyAmounts.length + index]!.end;
          return (
            <line
              key={field}
              data-average={field}
              className={`${className} ${styles.averageLine}`}
              x1={layout.left}
              x2={layout.right}
              y1={y}
              y2={y}
              aria-hidden="true"
            />
          );
        })}
      </svg>
    </section>
  );
}

function formatMonth(month: string): string {
  const [year, number] = month.split('-');
  return `${year}年${Number(number)}月`;
}

function formatTick(cents: number): string {
  const amount = cents / 100;
  const divisor =
    Math.abs(amount) >= 100_000_000 ? 100_000_000 : Math.abs(amount) >= 10_000 ? 10_000 : 1;
  return `${new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 }).format(amount / divisor)}${divisor === 1 ? '' : divisor === 10_000 ? '萬' : '億'}`;
}
