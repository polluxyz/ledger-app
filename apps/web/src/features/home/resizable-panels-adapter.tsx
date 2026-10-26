import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  Group,
  Panel,
  Separator,
  type Layout,
  type LayoutChangedMeta,
} from 'react-resizable-panels';
import type { HomeLayoutNode, HomeLayoutV1 } from '@ledger/shared';
import { HOME_LAYOUT_GAP_PX, minWidthOf } from './layout-math';
import {
  HOME_LAYOUT_MIN_CARD_HEIGHT_PX,
  resizeSplit,
  type HomeLayoutSplitPath,
} from './layout-ops';
import { splitResizeDeltaForKey } from './home-layout-resize-keys';
import styles from './HomeLayoutRenderer.module.css';

/** `react-resizable-panels` 僅在此轉接層使用；回寫時轉成專案的整數權重格式。 */

export function ResizableSplitView({
  node,
  path,
  layout,
  disabled,
  cardNames,
  onLayoutChange,
  renderChild,
}: {
  node: Extract<HomeLayoutNode, { type: 'split' }>;
  path: HomeLayoutSplitPath;
  layout: HomeLayoutV1;
  disabled: boolean;
  cardNames: readonly string[];
  onLayoutChange: (layout: HomeLayoutV1) => void;
  renderChild: (child: HomeLayoutNode, childIndex: number) => ReactNode;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const groupId = `home-layout-${path.bandIndex}-${path.nodePath.join('-') || 'root'}`;
  const panelIds = node.children.map((_, index) => `${groupId}-panel-${index}`);
  const minimums = node.children.map((child) => minimumSizeOf(child, node.axis));
  const [measuredGroupSize, setMeasuredGroupSize] = useState(0);

  useEffect(() => {
    const element = groupRef.current;
    if (!element) return;
    const measure = () =>
      setMeasuredGroupSize(node.axis === 'x' ? element.clientWidth : element.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [node.axis]);

  const measuredAvailableSize = Math.max(
    0,
    measuredGroupSize - HOME_LAYOUT_GAP_PX * (node.children.length - 1),
  );
  const defaultLayout = Object.fromEntries(
    node.weights.map((weight, index) => [panelIds[index]!, (weight / 10_000) * 100]),
  );
  const onLayoutChanged = useCallback(
    (nextLayout: Layout, meta: LayoutChangedMeta) => {
      if (disabled || !meta.isUserInteraction) return;
      const requestedLayout = meta.requestedLayout ?? nextLayout;
      const element = groupRef.current;
      if (!element) return;
      const groupSize = node.axis === 'x' ? element.clientWidth : element.clientHeight;
      const availableSize = Math.max(
        0,
        groupSize - HOME_LAYOUT_GAP_PX * (node.children.length - 1),
      );
      const changedIndex = firstChangedPair(node.weights, requestedLayout, panelIds);
      if (changedIndex < 0 || availableSize <= 0) return;
      const nextFirstPercent = requestedLayout[panelIds[changedIndex]!];
      if (nextFirstPercent === undefined) return;
      const oldFirstSize = (node.weights[changedIndex]! / 10_000) * availableSize;
      const nextFirstSize = (nextFirstPercent / 100) * availableSize;
      onLayoutChange(
        resizeSplit(
          layout,
          path,
          changedIndex,
          nextFirstSize - oldFirstSize,
          availableSize,
          minimums,
        ),
      );
    },
    [disabled, layout, minimums, node, onLayoutChange, panelIds, path],
  );

  return (
    <Group
      className={styles.resizableGroup}
      defaultLayout={defaultLayout}
      disabled={disabled}
      elementRef={groupRef}
      id={groupId}
      orientation={node.axis === 'x' ? 'horizontal' : 'vertical'}
      onLayoutChanged={onLayoutChanged}
      resizeTargetMinimumSize={{ coarse: 24, fine: 16 }}
    >
      {node.children.map((child, index) => (
        <Fragment key={`panel-${index}`}>
          <Panel
            className={styles.resizablePanel}
            defaultSize={`${node.weights[index]! / 100}%`}
            disabled={disabled}
            id={panelIds[index]}
            minSize={minimums[index]}
          >
            {renderChild(child, index)}
          </Panel>
          {index < node.children.length - 1 ? (
            <Separator
              aria-label={`${cardNames[index] ?? `第 ${index + 1} 張卡`}與${cardNames[index + 1] ?? `第 ${index + 2} 張卡`}分隔線`}
              aria-orientation={node.axis === 'x' ? 'vertical' : 'horizontal'}
              aria-valuemax={separatorMaximumPercent(
                node.weights,
                minimums,
                index,
                measuredAvailableSize,
              )}
              aria-valuemin={separatorMinimumPercent(
                node.weights,
                minimums,
                index,
                measuredAvailableSize,
              )}
              aria-valuenow={Math.round(pairPercentage(node.weights, index))}
              aria-valuetext={`${cardNames[index] ?? `第 ${index + 1} 張卡`} ${Math.round(pairPercentage(node.weights, index))}%`}
              className={`${styles.resizableSeparator} ${node.axis === 'x' ? styles.verticalSeparator : styles.horizontalSeparator}`}
              disabled={disabled}
              id={`home-layout-separator-${path.bandIndex}-${path.nodePath.join('-')}-${index}`}
              onKeyDownCapture={(event) =>
                handleSeparatorKeyDown({
                  event,
                  node,
                  index,
                  path,
                  layout,
                  minimums,
                  groupRef,
                  disabled,
                  onLayoutChange,
                })
              }
            />
          ) : null}
        </Fragment>
      ))}
    </Group>
  );
}

function handleSeparatorKeyDown({
  event,
  node,
  index,
  path,
  layout,
  minimums,
  groupRef,
  disabled,
  onLayoutChange,
}: {
  event: KeyboardEvent<HTMLDivElement>;
  node: Extract<HomeLayoutNode, { type: 'split' }>;
  index: number;
  path: HomeLayoutSplitPath;
  layout: HomeLayoutV1;
  minimums: number[];
  groupRef: RefObject<HTMLDivElement | null>;
  disabled: boolean;
  onLayoutChange: (layout: HomeLayoutV1) => void;
}) {
  if (disabled) return;
  const element = groupRef.current;
  if (!element) return;
  const groupSize = node.axis === 'x' ? element.clientWidth : element.clientHeight;
  const availableSize = Math.max(0, groupSize - HOME_LAYOUT_GAP_PX * (node.children.length - 1));
  if (availableSize <= 0) return;
  const pairWeight = node.weights[index]! + node.weights[index + 1]!;
  const pairSize = (pairWeight / 10_000) * availableSize;
  const currentFirstSize = (node.weights[index]! / 10_000) * availableSize;
  const delta = splitResizeDeltaForKey({
    key: event.key,
    shiftKey: event.shiftKey,
    currentFirstSize,
    pairSize,
    firstMinimum: minimums[index]!,
    secondMinimum: minimums[index + 1]!,
  });
  if (delta === null) return;
  const isRelevantArrow =
    node.axis === 'x'
      ? event.key === 'ArrowLeft' || event.key === 'ArrowRight'
      : event.key === 'ArrowUp' || event.key === 'ArrowDown';
  if (!isRelevantArrow && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  // 套件會在 document 層也處理 Separator 鍵盤事件；此處已用專案格式計算，不能再讓它改內部版面。
  event.stopPropagation();
  onLayoutChange(resizeSplit(layout, path, index, delta, availableSize, minimums));
}

function firstChangedPair(
  weights: readonly number[],
  layout: Layout,
  panelIds: readonly string[],
): number {
  const changes = weights.map((weight, index) => {
    const next = layout[panelIds[index]!];
    return next === undefined ? 0 : next - (weight / 10_000) * 100;
  });
  return changes.findIndex(
    (change, index) =>
      index < changes.length - 1 &&
      Math.abs(change) > 0.01 &&
      Math.abs(change + (changes[index + 1] ?? 0)) < 0.05,
  );
}

function pairPercentage(weights: readonly number[], index: number) {
  const total = weights[index]! + weights[index + 1]!;
  return (weights[index]! / total) * 100;
}

function separatorMinimumPercent(
  weights: readonly number[],
  minimums: readonly number[],
  index: number,
  availableSize: number,
) {
  const pair = weights[index]! + weights[index + 1]!;
  const pairSize = (pair / 10_000) * availableSize;
  return pairSize > 0 ? Math.min(100, Math.ceil((minimums[index]! / pairSize) * 100)) : 0;
}

function separatorMaximumPercent(
  weights: readonly number[],
  minimums: readonly number[],
  index: number,
  availableSize: number,
) {
  const pair = weights[index]! + weights[index + 1]!;
  const pairSize = (pair / 10_000) * availableSize;
  return pairSize > 0
    ? Math.max(
        separatorMinimumPercent(weights, minimums, index, availableSize),
        Math.floor(100 - (minimums[index + 1]! / pairSize) * 100),
      )
    : 100;
}

function minimumSizeOf(node: HomeLayoutNode, axis: 'x' | 'y'): number {
  if (node.type === 'card') return axis === 'x' ? minWidthOf(node) : HOME_LAYOUT_MIN_CARD_HEIGHT_PX;
  if (axis === 'x') {
    return node.axis === 'x'
      ? node.children.reduce(
          (sum, child) => sum + minimumSizeOf(child, axis),
          HOME_LAYOUT_GAP_PX * (node.children.length - 1),
        )
      : Math.max(...node.children.map((child) => minimumSizeOf(child, axis)));
  }
  return node.axis === 'y'
    ? node.children.reduce(
        (sum, child) => sum + minimumSizeOf(child, axis),
        HOME_LAYOUT_GAP_PX * (node.children.length - 1),
      )
    : Math.max(...node.children.map((child) => minimumSizeOf(child, axis)));
}
