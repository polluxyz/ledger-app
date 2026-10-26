import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  useGroupRef,
} from 'react-resizable-panels';
import type { HomeLayoutNode, HomeLayoutV1 } from '@ledger/shared';
import { HOME_LAYOUT_GAP_PX, minWidthOf } from './layout-math';
import { resizeSplit, type HomeLayoutSplitPath } from './layout-ops';
import { splitResizeDeltaForKey } from './home-layout-resize-keys';
import type { PlannedHomeLayoutNode } from './home-layout-size';
import styles from './HomeLayoutRenderer.module.css';

/** `react-resizable-panels` 僅在此轉接層使用；回寫時轉成專案的整數權重格式。 */

export function ResizableSplitView({
  node,
  path,
  layout,
  disabled,
  heightPlan,
  cardNames,
  onLayoutChange,
  renderChild,
}: {
  node: Extract<HomeLayoutNode, { type: 'split' }>;
  path: HomeLayoutSplitPath;
  layout: HomeLayoutV1;
  disabled: boolean;
  heightPlan: PlannedHomeLayoutNode | null;
  cardNames: readonly string[];
  onLayoutChange: (layout: HomeLayoutV1) => void;
  renderChild: (child: HomeLayoutNode, childIndex: number) => ReactNode;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const imperativeGroupRef = useGroupRef();
  const groupId = `home-layout-${path.bandIndex}-${path.nodePath.join('-') || 'root'}`;
  const panelCount = node.children.length;
  const panelIds = useMemo(
    () => Array.from({ length: panelCount }, (_, index) => `${groupId}-panel-${index}`),
    [groupId, panelCount],
  );
  const minimums = node.children.map((child, index) =>
    node.axis === 'x' ? minWidthOf(child) : (heightPlanChild(heightPlan, index)?.minHeightPx ?? 0),
  );
  const defaultLayout = useMemo(
    () =>
      Object.fromEntries(
        node.weights.map((weight, index) => [panelIds[index]!, (weight / 10_000) * 100]),
      ),
    [node.weights, panelIds],
  );

  // Group 是非受控元件；權重、取消、重設與載入最新都要同步回套件版面。
  useEffect(() => {
    const group = imperativeGroupRef.current;
    if (!group) return;
    const currentLayout = group.getLayout();
    const layoutMatchesWeights = node.weights.every((weight, index) => {
      const currentSize = currentLayout[panelIds[index]!];
      return currentSize !== undefined && Math.abs(currentSize - (weight / 10_000) * 100) < 0.01;
    });
    if (!layoutMatchesWeights) group.setLayout(defaultLayout);
  }, [defaultLayout, imperativeGroupRef, node.weights, panelIds]);
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
      groupRef={imperativeGroupRef}
      id={groupId}
      orientation={node.axis === 'x' ? 'horizontal' : 'vertical'}
      onLayoutChanged={onLayoutChanged}
      resizeTargetMinimumSize={{ coarse: 24, fine: 16 }}
      style={heightPlan ? { height: `${heightPlan.heightPx}px` } : undefined}
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
              aria-valuemin={
                node.axis === 'y'
                  ? verticalSeparatorValue(heightPlan, index, minimums).min
                  : undefined
              }
              aria-valuemax={
                node.axis === 'y'
                  ? verticalSeparatorValue(heightPlan, index, minimums).max
                  : undefined
              }
              aria-valuenow={
                node.axis === 'y'
                  ? verticalSeparatorValue(heightPlan, index, minimums).now
                  : undefined
              }
              aria-valuetext={`${cardNames[index] ?? `第 ${index + 1} 張卡`} ${Math.round(node.axis === 'y' ? verticalSeparatorValue(heightPlan, index, minimums).now : pairPercentage(node.weights, index))}%`}
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
                  heightPlan,
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
  heightPlan,
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
  heightPlan: PlannedHomeLayoutNode | null;
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
  const isRelevantArrow =
    node.axis === 'x'
      ? event.key === 'ArrowLeft' || event.key === 'ArrowRight'
      : event.key === 'ArrowUp' || event.key === 'ArrowDown';
  if (!isRelevantArrow && event.key !== 'Home' && event.key !== 'End') return;

  if (
    node.axis === 'y' &&
    availableSize <= minimums.reduce((sum, minimum) => sum + minimum, 0) + 0.5
  ) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  const pairWeight = node.weights[index]! + node.weights[index + 1]!;
  const storedFirstSize = (node.weights[index]! / 10_000) * availableSize;
  const firstChildHeight = heightPlanChild(heightPlan, index)?.heightPx;
  const secondChildHeight = heightPlanChild(heightPlan, index + 1)?.heightPx;
  const currentFirstSize =
    node.axis === 'y' && firstChildHeight !== undefined ? firstChildHeight : storedFirstSize;
  const pairSize =
    node.axis === 'y' && firstChildHeight !== undefined && secondChildHeight !== undefined
      ? firstChildHeight + secondChildHeight
      : (pairWeight / 10_000) * availableSize;
  const delta = splitResizeDeltaForKey({
    key: event.key,
    shiftKey: event.shiftKey,
    currentFirstSize,
    pairSize,
    firstMinimum: minimums[index]!,
    secondMinimum: minimums[index + 1]!,
  });
  if (delta === null) return;
  event.preventDefault();
  // 套件會在 document 層也處理 Separator 鍵盤事件；此處已用專案格式計算，不能再讓它改內部版面。
  event.stopPropagation();
  const resizeDelta = currentFirstSize + delta - storedFirstSize;
  onLayoutChange(resizeSplit(layout, path, index, resizeDelta, availableSize, minimums));
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

function heightPlanChild(
  heightPlan: PlannedHomeLayoutNode | null,
  childIndex: number,
): PlannedHomeLayoutNode | undefined {
  if (heightPlan?.children) return heightPlan.children[childIndex];
  return heightPlan?.rows?.flatMap((row) => row.children).find(({ index }) => index === childIndex)
    ?.plan;
}

function verticalSeparatorValue(
  heightPlan: PlannedHomeLayoutNode | null,
  index: number,
  minimums: readonly number[],
) {
  const firstMinimum = minimums[index] ?? 0;
  const secondMinimum = minimums[index + 1] ?? 0;
  const firstHeight = heightPlan?.children?.[index]?.heightPx ?? firstMinimum;
  const secondHeight = heightPlan?.children?.[index + 1]?.heightPx ?? secondMinimum;
  const pairHeight = firstHeight + secondHeight;
  if (pairHeight <= 0) return { min: 0, max: 100, now: 50 };
  return {
    min: (firstMinimum / pairHeight) * 100,
    max: ((pairHeight - secondMinimum) / pairHeight) * 100,
    now: (firstHeight / pairHeight) * 100,
  };
}
