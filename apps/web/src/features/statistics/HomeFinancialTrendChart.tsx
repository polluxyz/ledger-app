import { useEffect, useMemo, useRef, useState } from 'react';
import type { BalanceTrend } from '@ledger/shared';
import { formatMoney } from '../../lib/format';
import { getFinancialTrendLayout } from './financial-trend-layout';
import type { HomeTrendMetric } from './HomeTrendHeader';
import { useTrendAnimation } from './use-trend-animation';
import styles from './HomeFinancialTrendChart.module.css';

interface HomeFinancialTrendChartProps {
  /** total 為 API 原值；結餘模式只將後端 net 映射成這個呈現欄位。 */
  months: BalanceTrend['months'] | undefined;
  isLoading: boolean;
  error: unknown;
  className?: string;
  metric?: HomeTrendMetric;
  shared?: boolean;
}

const FALLBACK_SIZE = { width: 640, height: 230 };

/** 財務柱圖呈現原始整數分，不推導帳務數值；負值、零值與月份互動共用零基準。 */
export function HomeFinancialTrendChart({
  months,
  isLoading,
  error,
  className,
  metric = 'assets',
  shared = false,
}: HomeFinancialTrendChartProps) {
  const chartRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState(FALLBACK_SIZE);
  const [selection, setSelection] = useState<{ metric: HomeTrendMetric; index: number } | null>(
    null,
  );
  const hasChart = !error && !isLoading && Boolean(months?.length);
  const layout = useMemo(
    () =>
      hasChart && months
        ? getFinancialTrendLayout(
            months.map((item) => item.total),
            size.width,
            size.height,
          )
        : null,
    [hasChart, months, size],
  );
  useTrendAnimation(chartRef, layout, metric);

  useEffect(() => {
    if (!hasChart || !chartRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0)
        setSize((current) =>
          Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
            ? current
            : { width, height },
        );
    });
    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, [hasChart]);

  const isNet = metric === 'net',
    label = isNet ? '本月結餘' : '本月月底總資產',
    chartLabel = isNet ? '每月結餘' : '每月資產';
  const lastIndex = (months?.length ?? 0) - 1,
    latest = months?.[lastIndex];
  const activeIndex =
      selection?.metric === metric ? Math.min(selection.index, lastIndex) : lastIndex,
    active = months?.[activeIndex];
  const status = error
    ? `${isNet ? '結餘' : '資產'}暫時無法載入`
    : isLoading
      ? '載入中…'
      : '目前沒有趨勢資料';
  const choose = (index: number) => setSelection({ metric, index });
  return (
    <section
      className={`${styles.panel} ${className ?? ''}`}
      aria-label={isNet ? '每月結餘趨勢圖' : '資產趨勢圖'}
    >
      <div className={styles.summary} key={metric}>
        <div
          className={styles.total}
          aria-label={
            latest && hasChart
              ? `${isNet ? '本月結餘' : shared ? '我的總資產' : '總資產'} ${formatMoney(latest.total)}`
              : undefined
          }
        >
          <span className={styles.totalLabel}>{label}</span>
          <strong>{latest && hasChart ? formatMoney(latest.total) : '—'}</strong>
        </div>
        {active && hasChart && (
          <div className={styles.detail} aria-live="polite">
            <span>{formatMonth(active.month)}</span>
            <strong>{formatMoney(active.total)}</strong>
          </div>
        )}
      </div>
      {layout && months ? (
        <svg
          ref={chartRef}
          className={styles.chart}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="group"
          aria-label={`${chartLabel}：${months.map((item) => `${formatMonth(item.month)}：${formatMoney(item.total)}`).join('；')}`}
        >
          <g className={styles.axis} key={metric}>
            {layout.ticks.map((tick, index) => (
              <g key={index}>
                {!tick.zero && (
                  <line
                    className={styles.grid}
                    x1={layout.left}
                    x2={layout.right}
                    y1={tick.y}
                    y2={tick.y}
                  />
                )}
                <text x={layout.left - 9} y={tick.y + 3} textAnchor="end">
                  {formatTick(tick.amount)}
                </text>
              </g>
            ))}
          </g>
          <line
            data-trend-zero=""
            className={styles.zero}
            x1={layout.left}
            x2={layout.right}
            y1={layout.baseline}
            y2={layout.baseline}
          />
          {months.map((point, index) => {
            const bar = layout.bars[index]!;
            return (
              <g
                key={point.month}
                data-month={point.month}
                role="button"
                tabIndex={0}
                aria-label={`${formatMonth(point.month)} ${formatMoney(point.total)}`}
                aria-pressed={index === activeIndex}
                onMouseEnter={() => choose(index)}
                onClick={() => choose(index)}
                onFocus={() => choose(index)}
                onKeyDown={(event) => {
                  let next = index;
                  if (event.key === 'ArrowRight') next = (index + 1) % months.length;
                  else if (event.key === 'ArrowLeft')
                    next = (index + months.length - 1) % months.length;
                  else if (event.key === 'Home') next = 0;
                  else if (event.key === 'End') next = lastIndex;
                  else if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  choose(next);
                  chartRef.current
                    ?.querySelectorAll<SVGGElement>('g[role="button"]')
                    [next]?.focus();
                }}
              >
                <rect
                  x={bar.x - layout.slotWidth / 2}
                  y={0}
                  width={layout.slotWidth}
                  height={layout.height}
                  fill="transparent"
                />
                <rect
                  data-trend-bar=""
                  className={
                    point.total < 0
                      ? styles.negativeBar
                      : index === activeIndex
                        ? styles.currentBar
                        : styles.bar
                  }
                  x={bar.x - layout.barWidth / 2}
                  y={bar.y}
                  width={layout.barWidth}
                  height={bar.height}
                  rx={3}
                />
                {point.total === 0 && (
                  <line
                    data-zero-marker=""
                    className={styles.zeroMarker}
                    x1={bar.x - layout.barWidth / 2}
                    x2={bar.x + layout.barWidth / 2}
                    y1={layout.baseline}
                    y2={layout.baseline}
                  />
                )}
                {(size.width > 440 ||
                  (index % 2 === 0 && index < lastIndex - 1) ||
                  index === lastIndex) && (
                  <text x={bar.x} y={layout.height - 9} textAnchor="middle">
                    {Number(point.month.slice(5))}月
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      ) : (
        <p className={styles.status} role="status">
          {status}
        </p>
      )}
      <div className={styles.caption} key={`${metric}-caption`}>
        <span>{isNet ? '每月收入 − 支出；負值表示支出較多' : '每月月底的總資產快照'}</span>
        <span>
          {months?.length
            ? `${months[0]!.month.replace('-', '.')} — ${latest!.month.replace('-', '.')}`
            : '最近 12 個月'}
        </span>
      </div>
    </section>
  );
}

function formatMonth(month: string) {
  const [year, value] = month.split('-');
  return `${year}年${Number(value)}月`;
}
function formatTick(cents: number) {
  const amount = cents / 100,
    divisor =
      Math.abs(amount) >= 100_000_000 ? 100_000_000 : Math.abs(amount) >= 10_000 ? 10_000 : 1;
  return `${new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 }).format(amount / divisor)}${divisor === 1 ? '' : divisor === 10_000 ? '萬' : '億'}`;
}
