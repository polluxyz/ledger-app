import { useEffect, useRef, useState } from 'react';
import type { StatisticsTrendMonth } from '@ledger/shared';
import { formatMoney } from '../../../lib/format';
import { getFinancialTrendLayout } from '../financial-trend-layout';
import styles from './StatisticsTrendChart.module.css';

interface StatisticsTrendChartProps {
  months: readonly StatisticsTrendMonth[];
  selectedMonth: string;
  showSelectedDetails: boolean;
  onSelectMonth: (month: string) => void;
}

const TITLE = '收支趨勢圖';
const HEIGHT = 240;
const SERIES = [
  { field: 'income', label: '收入', className: styles.income },
  { field: 'expense', label: '支出', className: styles.expense },
  { field: 'net', label: '結餘', className: styles.net },
] as const;

/** 收入、支出和後端結餘共用一組刻度。換算只用於圖表座標。 */
export function StatisticsTrendChart({
  months,
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

  if (!hasMonths) return <p role="status">沒有趨勢資料</p>;

  const activeMonth = hoveredMonth ?? focusedMonth ?? selectedMonth;
  const detail =
    showSelectedDetails || activeMonth !== selectedMonth
      ? months.find((month) => month.month === activeMonth)
      : undefined;
  const layout = getFinancialTrendLayout(
    months.flatMap((month) => [month.income, month.expense, month.net]),
    width,
    HEIGHT,
  );
  const slotWidth = layout.slotWidth * SERIES.length;
  const barWidth = Math.min(30, slotWidth * 0.28);
  const lastIndex = months.length - 1;
  const netPoints = months.map((_, index) => ({
    x: layout.bars[index * SERIES.length + 1]!.x,
    y: layout.bars[index * SERIES.length + 2]!.end,
  }));

  return (
    <section className={styles.wrapper} aria-label={TITLE}>
      <ul className={styles.legend} aria-label="圖例">
        {SERIES.map(({ field, label, className }) => (
          <li key={field}>
            <span className={className} aria-hidden="true" />
            {label}
          </li>
        ))}
      </ul>
      <div className={styles.detail} aria-live="polite">
        {detail && (
          <dl aria-label={formatMonth(detail.month)}>
            {SERIES.map(({ field, label }) => (
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
          const { x, y } = netPoints[index]!;
          const firstBar = index * SERIES.length;
          return (
            <g
              key={month.month}
              role="button"
              tabIndex={0}
              data-month={month.month}
              aria-pressed={month.month === selectedMonth}
              aria-label={`${formatMonth(month.month)}：${SERIES.map(({ field, label }) => `${label} ${formatMoney(month[field])}`).join('，')}`}
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
              {SERIES.slice(0, 2).map(({ field, className }, offset) => {
                const bar = layout.bars[firstBar + offset]!;
                return (
                  <rect
                    key={field}
                    data-series={field}
                    className={className}
                    x={x + (offset === 0 ? -barWidth - 1 : 1)}
                    y={bar.y}
                    width={barWidth}
                    height={bar.height}
                    rx={2}
                  />
                );
              })}
              <circle data-series="net" className={styles.net} cx={x} cy={y} r={3} />
              {(width > 440 ||
                (index % 2 === 0 && index < lastIndex - 1) ||
                index === lastIndex) && (
                <text data-month-label="" x={x} y={HEIGHT - 9} textAnchor="middle">
                  {Number(month.month.slice(5))}月
                </text>
              )}
            </g>
          );
        })}
        <polyline
          className={styles.netLine}
          points={netPoints.map(({ x, y }) => `${x},${y}`).join(' ')}
          aria-hidden="true"
        />
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
