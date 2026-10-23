import { useState } from 'react';
import type { BalanceTrend } from '@ledger/shared';
import { formatMoney } from '../../lib/format';
import styles from './BalanceTrendChart.module.css';

/** 首頁資產區只畫後端回傳的月末總額，座標換算不會改變或推導金額。 */
interface BalanceTrendChartProps {
  months: BalanceTrend['months'] | undefined;
  isLoading: boolean;
  error: unknown;
}

const WIDTH = 640;
const HEIGHT = 230;
const LEFT = 32;
const RIGHT = WIDTH - LEFT;
const TOP = 34;
const BOTTOM = HEIGHT - 38;

export function BalanceTrendChart({ months, isLoading, error }: BalanceTrendChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);

  const values = months ?? [];
  const lastIndex = values.length - 1;
  const activeIndex = hoveredIndex ?? focusedIndex ?? pinnedIndex ?? lastIndex;

  if (error || (!isLoading && values.length === 0)) {
    return (
      <section className={styles.card} aria-labelledby="balance-trend-heading">
        <h2 className={styles.heading} id="balance-trend-heading">
          資產
        </h2>
        <p className={styles.status} role="status">
          資產暫時無法載入
        </p>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className={styles.card} aria-labelledby="balance-trend-heading">
        <h2 className={styles.heading} id="balance-trend-heading">
          資產
        </h2>
        <p className={styles.status} role="status">
          載入中…
        </p>
      </section>
    );
  }

  const totals = values.map((item) => item.total);
  const minimum = Math.min(...totals);
  const maximum = Math.max(...totals);
  const coordinateScale = Math.max(Math.abs(minimum), Math.abs(maximum)) || 1;
  const scaledMinimum = minimum / coordinateScale;
  const scaledMaximum = maximum / coordinateScale;
  // 常數序列（包括全 0）使用圖面中線，避免除以 0。
  const valueRange = scaledMaximum - scaledMinimum || 1;
  const x = (index: number) =>
    values.length === 1 ? WIDTH / 2 : LEFT + (index / (values.length - 1)) * (RIGHT - LEFT);
  const y = (total: number) =>
    TOP + ((scaledMaximum - total / coordinateScale) / valueRange) * (BOTTOM - TOP);
  const points = values.map((item, index) => ({ ...item, x: x(index), y: y(item.total) }));
  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
  const fillBaseline = minimum < 0 && maximum > 0 ? y(0) : minimum >= 0 ? BOTTOM : TOP;
  const areaPath = `${linePath} L ${points[lastIndex]!.x} ${fillBaseline} L ${points[0]!.x} ${fillBaseline} Z`;
  const crossesZero = minimum < 0 && maximum > 0;
  const finalPoint = points[lastIndex]!;
  const activePoint = points[activeIndex] ?? finalPoint;
  const accessibleValues = values
    .map((item) => `${formatMonth(item.month)}：${formatMoney(item.total)}`)
    .join('；');

  return (
    <section className={styles.card} aria-labelledby="balance-trend-heading">
      <h2 className={styles.heading} id="balance-trend-heading">
        資產
      </h2>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="group"
        aria-label={`每月資產：${accessibleValues}`}
      >
        <defs>
          <linearGradient id="balance-trend-area" x1="0" x2="0" y1="0" y2="1">
            <stop className={styles.gradientTop} offset="0%" />
            <stop className={styles.gradientBottom} offset="100%" />
          </linearGradient>
        </defs>
        {crossesZero && (
          <line className={styles.zeroLine} x1={LEFT} x2={RIGHT} y1={y(0)} y2={y(0)} />
        )}
        <path className={styles.area} d={areaPath} />
        <path className={styles.line} d={linePath} />
        {points.map((point, index) => (
          <circle
            className={index === activeIndex ? styles.activePoint : styles.point}
            cx={point.x}
            cy={point.y}
            key={point.month}
            r={index === activeIndex ? 5 : 3}
            role="button"
            tabIndex={0}
            aria-label={`${formatMonth(point.month)} ${formatMoney(point.total)}`}
            aria-pressed={index === pinnedIndex}
            onFocus={() => setFocusedIndex(index)}
            onBlur={() => setFocusedIndex(null)}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
            onClick={() => setPinnedIndex(index)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setPinnedIndex(index);
              }
            }}
          />
        ))}
        <text className={styles.valueLabel} x={RIGHT - 4} y={Math.max(TOP - 10, finalPoint.y - 13)}>
          {formatMoney(finalPoint.total)}
        </text>
        <text className={styles.monthLabel} x={RIGHT - 4} y={Math.max(TOP + 4, finalPoint.y + 3)}>
          {formatMonth(finalPoint.month)}
        </text>
        {activeIndex !== lastIndex && (
          <text
            className={styles.activeLabel}
            x={Math.min(WIDTH - LEFT, Math.max(LEFT, activePoint.x))}
            y={Math.max(TOP - 6, activePoint.y - 12)}
            textAnchor={activePoint.x > WIDTH / 2 ? 'end' : 'start'}
          >
            {formatMoney(activePoint.total)} · {formatMonth(activePoint.month)}
          </text>
        )}
      </svg>
    </section>
  );
}

function formatMonth(month: string): string {
  const [year, monthNumber] = month.split('-');
  return `${year}年${Number(monthNumber)}月`;
}
