import type { HomeLayoutNode } from '@ledger/shared';
import { HOME_LAYOUT_GAP_PX, minWidthOf, wrapSplit } from './layout-math';

export interface PlannedHomeLayoutNode {
  node: HomeLayoutNode;
  minHeightPx: number;
  heightPx: number;
  children?: PlannedHomeLayoutNode[];
  rows?: Array<{
    minHeightPx: number;
    heightPx: number;
    weight: number;
    children: Array<{ index: number; plan: PlannedHomeLayoutNode }>;
  }>;
}

type MinimumHomeLayoutNode = Omit<PlannedHomeLayoutNode, 'heightPx' | 'children' | 'rows'> & {
  children?: MinimumHomeLayoutNode[];
  rows?: Array<{
    minHeightPx: number;
    weight: number;
    children: Array<{ index: number; plan: MinimumHomeLayoutNode }>;
  }>;
};

/** 以自然卡片高度推導列內每個節點的最低高度，並把額外高度依權重向下分配。 */
export function planHomeLayoutHeight(
  node: HomeLayoutNode,
  widthPx: number,
  naturalCardHeightsPx: Partial<Record<HomeLayoutNodeCardId, number>>,
  extraHeightPx: number,
  wrapMode: 'responsive' | 'none',
  gapPx = HOME_LAYOUT_GAP_PX,
): PlannedHomeLayoutNode | null {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return null;
  const minimum = minimumNodeAtWidth(node, widthPx, naturalCardHeightsPx, wrapMode, gapPx);
  if (!minimum) return null;
  return allocateNodeHeight(minimum, minimum.minHeightPx + Math.max(0, extraHeightPx), gapPx);
}

/** y 子節點扣除分隔間距後，先夾住不足最低高度的子節點，再按權重重分剩餘高度。 */
export function distributeWeightedHeights(
  availableHeightPx: number,
  minimumHeightsPx: readonly number[],
  weights: readonly number[],
): number[] {
  if (minimumHeightsPx.length !== weights.length) {
    throw new Error('分割節點的最低高度與權重數量必須相同。');
  }
  if (minimumHeightsPx.length === 0) return [];

  const available = Math.max(0, Number.isFinite(availableHeightPx) ? availableHeightPx : 0);
  const result = Array.from({ length: minimumHeightsPx.length }, () => 0);
  const active = new Set(minimumHeightsPx.map((_, index) => index));
  let remaining = available;

  while (active.size > 0) {
    const totalWeight = [...active].reduce(
      (sum, index) => sum + Math.max(1, weights[index] ?? 1),
      0,
    );
    const clamped = [...active].filter((index) => {
      const weight = Math.max(1, weights[index] ?? 1);
      const share = (remaining * weight) / totalWeight;
      return share + 0.0001 < Math.max(0, minimumHeightsPx[index] ?? 0);
    });

    if (clamped.length === 0) {
      let assigned = 0;
      const ordered = [...active];
      ordered.forEach((index, position) => {
        const share =
          position === ordered.length - 1
            ? remaining - assigned
            : (remaining * Math.max(1, weights[index] ?? 1)) / totalWeight;
        result[index] = share;
        assigned += share;
      });
      break;
    }

    for (const index of clamped) {
      const minimum = Math.max(0, minimumHeightsPx[index] ?? 0);
      result[index] = minimum;
      remaining -= minimum;
      active.delete(index);
    }
  }

  return result;
}

type HomeLayoutNodeCardId = Extract<HomeLayoutNode, { type: 'card' }>['cardId'];

function minimumNodeAtWidth(
  node: HomeLayoutNode,
  widthPx: number,
  naturalCardHeightsPx: Partial<Record<HomeLayoutNodeCardId, number>>,
  wrapMode: 'responsive' | 'none',
  gapPx: number,
): MinimumHomeLayoutNode | null {
  if (node.type === 'card') {
    const height = naturalCardHeightsPx[node.cardId];
    if (!Number.isFinite(height) || height === undefined || height <= 0) return null;
    return { node, minHeightPx: height };
  }

  if (node.axis === 'y') {
    const children = node.children.map((child) =>
      minimumNodeAtWidth(child, widthPx, naturalCardHeightsPx, wrapMode, gapPx),
    );
    if (children.some((child) => child === null)) return null;
    const readyChildren = children as MinimumHomeLayoutNode[];
    return {
      node,
      minHeightPx:
        readyChildren.reduce((sum, child) => sum + child.minHeightPx, 0) +
        gapPx * (readyChildren.length - 1),
      children: readyChildren,
    };
  }

  const minimumWidths = node.children.map(minWidthOf);
  const rowPlan =
    wrapMode === 'none'
      ? wrapSplit(Math.max(widthPx, minWidthOf(node)), minimumWidths, node.weights, gapPx)
      : wrapSplit(widthPx, minimumWidths, node.weights, gapPx);
  const rows: NonNullable<MinimumHomeLayoutNode['rows']> = [];
  for (const row of rowPlan) {
    const rowChildren = row.indices.map((index, columnIndex) => ({
      index,
      plan: minimumNodeAtWidth(
        node.children[index]!,
        row.columnWidthsPx[columnIndex]!,
        naturalCardHeightsPx,
        wrapMode,
        gapPx,
      ),
    }));
    if (rowChildren.some(({ plan }) => plan === null)) return null;
    const readyChildren = rowChildren.map(({ index, plan }) => ({
      index,
      plan: plan as MinimumHomeLayoutNode,
    }));
    rows.push({
      minHeightPx: Math.max(...readyChildren.map(({ plan }) => plan.minHeightPx)),
      weight: row.weights.reduce((sum, weight) => sum + weight, 0),
      children: readyChildren,
    });
  }
  return {
    node,
    minHeightPx: rows.reduce((sum, row) => sum + row.minHeightPx, 0) + gapPx * (rows.length - 1),
    rows,
  };
}

function allocateNodeHeight(
  minimum: MinimumHomeLayoutNode,
  heightPx: number,
  gapPx: number,
): PlannedHomeLayoutNode {
  const height = Math.max(minimum.minHeightPx, heightPx);
  if (minimum.node.type === 'card') {
    return { node: minimum.node, minHeightPx: minimum.minHeightPx, heightPx: height };
  }

  if (minimum.node.axis === 'y') {
    const minimumChildren = minimum.children ?? [];
    const childHeights = distributeWeightedHeights(
      Math.max(0, height - gapPx * (minimumChildren.length - 1)),
      minimumChildren.map((child) => child.minHeightPx),
      minimum.node.weights,
    );
    return {
      node: minimum.node,
      minHeightPx: minimum.minHeightPx,
      heightPx: height,
      children: minimumChildren.map((child, index) =>
        allocateNodeHeight(child, childHeights[index] ?? child.minHeightPx, gapPx),
      ),
    };
  }

  const minimumRows = minimum.rows ?? [];
  const rowHeights = distributeWeightedHeights(
    Math.max(0, height - gapPx * (minimumRows.length - 1)),
    minimumRows.map((row) => row.minHeightPx),
    minimumRows.map((row) => row.weight),
  );
  return {
    node: minimum.node,
    minHeightPx: minimum.minHeightPx,
    heightPx: height,
    rows: minimumRows.map((row, rowIndex) => {
      const rowHeight = rowHeights[rowIndex] ?? row.minHeightPx;
      return {
        minHeightPx: row.minHeightPx,
        heightPx: rowHeight,
        weight: row.weight,
        children: row.children.map(({ index, plan }) => ({
          index,
          plan: allocateNodeHeight(plan, rowHeight, gapPx),
        })),
      };
    }),
  };
}
