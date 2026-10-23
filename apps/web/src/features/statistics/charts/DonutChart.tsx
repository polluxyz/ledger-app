import type { Cents, StatisticsGroup, StatisticsPerson } from '@ledger/shared';
import { formatMoney } from '../../../lib/format';
import { getChartColorForId, getStatisticsGroupColor, type ChartTheme } from './chart-colors';
import styles from './DonutChart.module.css';

/** 甜甜圈只把已計算的統計資料轉成弧度，並以無障礙名稱提供每個精確金額。 */
export interface DonutChartProps {
  direction: 'expense' | 'income';
  totalAmount: Cents;
  title?: string;
  theme?: ChartTheme;
  data:
    | { kind: 'groups'; items: readonly StatisticsGroup[] }
    | { kind: 'people'; items: readonly StatisticsPerson[]; denominator: Cents };
}

interface DonutSlice {
  id: string;
  label: string;
  amount: Cents;
  color: string;
  percentageBps: number;
}

const RADIUS = 84;
const CENTER = 110;
const STROKE_WIDTH = 22;

export function DonutChart({
  direction,
  totalAmount,
  title,
  theme = 'dark',
  data,
}: DonutChartProps) {
  const slices: DonutSlice[] =
    data.kind === 'groups'
      ? data.items.map((group) => ({
          id: group.category?.id ?? group.kind,
          label: group.category?.name ?? fixedGroupLabel(group.kind),
          amount: group.amount,
          color: getStatisticsGroupColor(group, theme),
          percentageBps: group.percentageBps,
        }))
      : data.items.map((person) => ({
          id: person.personId,
          label: person.name,
          amount: direction === 'expense' ? person.expense : person.income,
          color: getChartColorForId(person.personId, theme),
          percentageBps: 0,
        }));

  const angleBasis = data.kind === 'groups' ? 10_000 : data.denominator > 0 ? data.denominator : 0;
  const visibleSlices = slices.filter(
    (slice) =>
      slice.amount > 0 && (data.kind === 'groups' ? slice.percentageBps > 0 : angleBasis > 0),
  );
  const arcPaths = visibleSlices.reduce<{
    angle: number;
    paths: Array<DonutSlice & { path: string }>;
  }>(
    (result, slice) => {
      const fraction =
        data.kind === 'groups' ? slice.percentageBps / angleBasis : slice.amount / angleBasis;
      const sweep = Math.min(fraction, 1) * 360;
      const start = polarPoint(result.angle);
      const endAngle = result.angle + sweep;
      const end = polarPoint(endAngle);
      const path =
        sweep >= 360
          ? `M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 0 1 ${CENTER} ${CENTER + RADIUS} A ${RADIUS} ${RADIUS} 0 0 1 ${start.x} ${start.y}`
          : `M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${sweep > 180 ? 1 : 0} 1 ${end.x} ${end.y}`;
      return { angle: endAngle, paths: [...result.paths, { ...slice, path }] };
    },
    { angle: -90, paths: [] },
  ).paths;

  const hasVisibleData = arcPaths.length > 0;
  const chartLabel = [
    title,
    `${direction === 'expense' ? '支出' : '收入'}圓餅圖`,
    `總額 ${formatMoney(totalAmount)}`,
    ...slices.map((slice) => `${slice.label} ${formatMoney(slice.amount)}`),
  ].join('；');

  return (
    <section className={styles.wrapper} aria-label={title}>
      <div className={styles.chart} role="img" aria-label={chartLabel}>
        {hasVisibleData && (
          <svg className={styles.svg} viewBox="0 0 220 220" aria-hidden="true" focusable="false">
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              className={styles.track}
              strokeWidth={STROKE_WIDTH}
            />
            {arcPaths.map((slice) => (
              <path
                key={slice.id}
                d={slice.path}
                fill="none"
                stroke={slice.color}
                strokeWidth={STROKE_WIDTH}
                className={styles.slice}
              />
            ))}
          </svg>
        )}
        <div className={styles.center}>
          <span className={styles.direction}>{direction === 'expense' ? '支出' : '收入'}</span>
          <strong className={styles.total}>{formatMoney(totalAmount)}</strong>
          {!hasVisibleData && <span className={styles.empty}>沒有資料</span>}
        </div>
      </div>
    </section>
  );
}

function polarPoint(degrees: number): { x: string; y: string } {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: (CENTER + RADIUS * Math.cos(radians)).toFixed(3),
    y: (CENTER + RADIUS * Math.sin(radians)).toFixed(3),
  };
}

function fixedGroupLabel(kind: StatisticsGroup['kind']): string {
  switch (kind) {
    case 'DIFFERENCE':
      return '結清差額';
    case 'BAD_DEBT':
      return '呆帳';
    case 'DEBT_FORGIVEN':
      return '債務免除';
    case 'UNCATEGORIZED':
      return '未分類';
    case 'CATEGORY':
      return '分類';
  }
}
