import type { Cents, StatisticsGroup, StatisticsPerson } from '@ledger/shared';
import { formatMoney } from '../../../lib/format';
import { getChartColorForId, getStatisticsGroupColor, type ChartTheme } from './chart-colors';
import { fixedGroupLabel } from './chart-format';
import styles from './DonutChart.module.css';

/** 甜甜圈只把已計算的統計資料轉成弧度，並以無障礙名稱提供每個精確金額。 */
export interface DonutChartProps {
  direction: 'expense' | 'income';
  totalAmount: Cents;
  title?: string;
  theme?: ChartTheme;
  data:
    | {
        kind: 'groups';
        items: readonly StatisticsGroup[];
        onSelect?: (group: StatisticsGroup) => void;
      }
    | { kind: 'people'; items: readonly StatisticsPerson[]; denominator: Cents };
}

interface DonutSlice {
  id: string;
  label: string;
  amount: Cents;
  color: string;
  percentageBps: number;
  group?: StatisticsGroup;
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
          group,
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
      <div
        className={styles.chart}
        role={data.kind === 'groups' && data.onSelect ? 'group' : 'img'}
        aria-label={chartLabel}
      >
        {hasVisibleData && (
          <svg
            className={styles.svg}
            viewBox="0 0 220 220"
            aria-hidden={!(data.kind === 'groups' && data.onSelect)}
            focusable={data.kind === 'groups' && data.onSelect ? undefined : 'false'}
          >
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              className={styles.track}
              strokeWidth={STROKE_WIDTH}
            />
            {arcPaths.map((slice) => {
              const selectable =
                data.kind === 'groups' &&
                data.onSelect !== undefined &&
                slice.group?.kind === 'CATEGORY';
              const activate = () => {
                if (selectable && slice.group) {
                  data.onSelect?.(slice.group);
                }
              };
              return (
                <path
                  key={slice.id}
                  d={slice.path}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={STROKE_WIDTH}
                  className={selectable ? `${styles.slice} ${styles.selectable}` : styles.slice}
                  role={selectable ? 'button' : undefined}
                  tabIndex={selectable ? 0 : undefined}
                  aria-label={
                    selectable ? `${slice.label} ${formatMoney(slice.amount)}` : undefined
                  }
                  onClick={selectable ? activate : undefined}
                  onKeyDown={
                    selectable
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            activate();
                          }
                        }
                      : undefined
                  }
                />
              );
            })}
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
