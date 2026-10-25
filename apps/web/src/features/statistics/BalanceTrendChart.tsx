import { useEffect, useRef, useState } from 'react';
import type { BalanceTrend } from '@ledger/shared';
import { formatMoney } from '../../lib/format';
import { getFinalLabelYPositions } from './balance-trend-chart-layout';
import styles from './BalanceTrendChart.module.css';

/** 首頁資產區只畫後端回傳的月末總額，座標換算不會改變或推導金額。 */
interface BalanceTrendChartProps {
  months: BalanceTrend['months'] | undefined;
  isLoading: boolean;
  error: unknown;
  /** 外層版面可調整圖表高度，不需選取元件內部的 SVG。 */
  className?: string;
  /** 首頁由共用 HomeCard 提供標題；統計頁或獨立使用時保留自己的標題。 */
  showHeading?: boolean;
}

const WIDTH = 640;
const HEIGHT = 230;
const FALLBACK_SIZE = { width: WIDTH, height: HEIGHT };
const HORIZONTAL_INSET = 32;
const TOP_INSET = 44;
const BOTTOM_INSET = 44;

export function BalanceTrendChart({
  months,
  isLoading,
  error,
  className,
  showHeading = true,
}: BalanceTrendChartProps) {
  const chartRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState(FALLBACK_SIZE);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);

  const values = months ?? [];
  const hasChart = !error && !isLoading && values.length > 0;
  const lastIndex = values.length - 1;
  const activeIndex = hoveredIndex ?? focusedIndex ?? pinnedIndex ?? lastIndex;

  useEffect(() => {
    if (!hasChart || !chartRef.current || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      // jsdom、隱藏中的卡片或尚未完成版面配置時可能量到 0；用舊畫布尺寸維持可測與可畫。
      setSize(width > 0 && height > 0 ? { width, height } : FALLBACK_SIZE);
    });
    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, [hasChart]);

  if (error || (!isLoading && values.length === 0)) {
    return (
      <section
        className={cardClassName(className)}
        aria-labelledby={showHeading ? 'balance-trend-heading' : undefined}
        aria-label={showHeading ? undefined : '資產趨勢圖'}
      >
        {showHeading && (
          <h2 className={styles.heading} id="balance-trend-heading">
            資產趨勢
          </h2>
        )}
        <p className={styles.status} role="status">
          資產暫時無法載入
        </p>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section
        className={cardClassName(className)}
        aria-labelledby={showHeading ? 'balance-trend-heading' : undefined}
        aria-label={showHeading ? undefined : '資產趨勢圖'}
      >
        {showHeading && (
          <h2 className={styles.heading} id="balance-trend-heading">
            資產趨勢
          </h2>
        )}
        <p className={styles.status} role="status">
          載入中…
        </p>
      </section>
    );
  }

  const totals = values.map((item) => item.total);
  const { width, height } = size;
  const left = HORIZONTAL_INSET;
  const right = width - HORIZONTAL_INSET;
  const top = TOP_INSET;
  const bottom = height - BOTTOM_INSET;
  const minimum = Math.min(...totals);
  const maximum = Math.max(...totals);
  const coordinateScale = Math.max(Math.abs(minimum), Math.abs(maximum)) || 1;
  const scaledMinimum = minimum / coordinateScale;
  const scaledMaximum = maximum / coordinateScale;
  // 常數序列（包括全 0）使用圖面中線，避免除以 0。
  const valueRange = scaledMaximum - scaledMinimum || 1;
  const x = (index: number) =>
    values.length === 1 ? width / 2 : left + (index / (values.length - 1)) * (right - left);
  const y = (total: number) =>
    top + ((scaledMaximum - total / coordinateScale) / valueRange) * (bottom - top);
  const points = values.map((item, index) => ({ ...item, x: x(index), y: y(item.total) }));
  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
  const fillBaseline = minimum < 0 && maximum > 0 ? y(0) : minimum >= 0 ? bottom : top;
  const areaPath = `${linePath} L ${points[lastIndex]!.x} ${fillBaseline} L ${points[0]!.x} ${fillBaseline} Z`;
  const crossesZero = minimum < 0 && maximum > 0;
  const finalPoint = points[lastIndex]!;
  const previousPoint = points[lastIndex - 1];
  const finalLabelPositions = getFinalLabelYPositions(previousPoint, finalPoint, {
    top: 0,
    bottom: height,
  });
  const activePoint = points[activeIndex] ?? finalPoint;
  const accessibleValues = values
    .map((item) => `${formatMonth(item.month)}：${formatMoney(item.total)}`)
    .join('；');

  return (
    <section
      className={cardClassName(className)}
      aria-labelledby={showHeading ? 'balance-trend-heading' : undefined}
      aria-label={showHeading ? undefined : '資產趨勢圖'}
    >
      {showHeading && (
        <h2 className={styles.heading} id="balance-trend-heading">
          資產趨勢
        </h2>
      )}
      <svg
        ref={chartRef}
        className={styles.chart}
        viewBox={`0 0 ${width} ${height}`}
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
          <line className={styles.zeroLine} x1={left} x2={right} y1={y(0)} y2={y(0)} />
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
        <text className={styles.valueLabel} x={right - 4} y={finalLabelPositions.valueY}>
          {formatMoney(finalPoint.total)}
        </text>
        <text className={styles.monthLabel} x={right - 4} y={finalLabelPositions.monthY}>
          {formatMonth(finalPoint.month)}
        </text>
        {activeIndex !== lastIndex && (
          <text
            className={styles.activeLabel}
            x={Math.min(width - left, Math.max(left, activePoint.x))}
            y={Math.max(top - 6, activePoint.y - 12)}
            textAnchor={activePoint.x > width / 2 ? 'end' : 'start'}
          >
            {formatMoney(activePoint.total)} · {formatMonth(activePoint.month)}
          </text>
        )}
      </svg>
    </section>
  );
}

function cardClassName(className: string | undefined): string | undefined {
  return className ? `${styles.panel} ${className}` : styles.panel;
}

function formatMonth(month: string): string {
  const [year, monthNumber] = month.split('-');
  return `${year}年${Number(monthNumber)}月`;
}
