import type { HomeCardId, HomeLayoutNode } from '@ledger/shared';
import { HOME_CARD_REGISTRY } from './card-registry';

export const HOME_LAYOUT_GAP_PX = 16;

export interface WrappedSplitLine {
  /** 原分割節點裡的子節點索引，順序與版面資料相同。 */
  indices: number[];
  minWidthsPx: number[];
  weights: number[];
  columnWidthsPx: number[];
}

/** 依卡片需求計算未換行寬度；x 累加子節點與間距，y 取最寬的子節點。 */
export function minWidthOf(node: HomeLayoutNode): number {
  if (node.type === 'card') return minWidthOfCard(node.cardId);
  const childWidths = node.children.map(minWidthOf);
  if (node.axis === 'y') return Math.max(...childWidths);
  return (
    childWidths.reduce((sum, width) => sum + width, 0) +
    HOME_LAYOUT_GAP_PX * (childWidths.length - 1)
  );
}

export function minWidthOfCard(cardId: HomeCardId): number {
  return HOME_CARD_REGISTRY[cardId].minWidthPx;
}

/**
 * 把左右分割按原順序切成可容納的列，並以權重分配寬度；小於下限的欄先固定，再分配餘額。
 * 間距先從可用寬度扣除，回傳值不依賴 DOM，供渲染器和版面測試共用。
 */
export function wrapSplit(
  widthPx: number,
  minWidthsPx: readonly number[],
  weights: readonly number[],
  gapPx: number,
): WrappedSplitLine[] {
  if (minWidthsPx.length !== weights.length) {
    throw new Error('分割節點的最小寬度與權重數量必須相同。');
  }
  if (minWidthsPx.length === 0) return [];

  const availableWidth = Math.max(0, Number.isFinite(widthPx) ? widthPx : 0);
  const gap = Math.max(0, Number.isFinite(gapPx) ? gapPx : 0);
  const rows: number[][] = [];
  let current: number[] = [];
  let currentMinWidth = 0;

  minWidthsPx.forEach((rawMinWidth, index) => {
    const minWidth = Math.max(0, Number.isFinite(rawMinWidth) ? rawMinWidth : 0);
    const nextWidth = currentMinWidth + (current.length > 0 ? gap : 0) + minWidth;
    if (current.length > 0 && nextWidth > availableWidth) {
      rows.push(current);
      current = [];
      currentMinWidth = 0;
    }
    current.push(index);
    currentMinWidth += (current.length > 1 ? gap : 0) + minWidth;
  });
  if (current.length > 0) rows.push(current);

  return rows.map((indices) => {
    const rowMinWidths = indices.map((index) => Math.max(0, minWidthsPx[index] ?? 0));
    const rowWeights = indices.map((index) => Math.max(1, weights[index] ?? 1));
    const contentWidth = Math.max(0, availableWidth - gap * (indices.length - 1));
    return {
      indices,
      minWidthsPx: rowMinWidths,
      weights: rowWeights,
      columnWidthsPx: distributeWeightedWidths(contentWidth, rowMinWidths, rowWeights),
    };
  });
}

function distributeWeightedWidths(
  widthPx: number,
  minWidthsPx: readonly number[],
  weights: readonly number[],
): number[] {
  if (minWidthsPx.length === 1) return [widthPx];

  const result = Array.from({ length: minWidthsPx.length }, () => 0);
  const active = new Set(minWidthsPx.map((_, index) => index));
  let remainingWidth = widthPx;

  while (active.size > 0) {
    const totalWeight = [...active].reduce((sum, index) => sum + (weights[index] ?? 1), 0);
    const clamped = [...active].filter((index) => {
      const share = (remainingWidth * (weights[index] ?? 1)) / totalWeight;
      return share < (minWidthsPx[index] ?? 0);
    });

    if (clamped.length === 0) {
      let assigned = 0;
      const ordered = [...active];
      ordered.forEach((index, position) => {
        const share =
          position === ordered.length - 1
            ? remainingWidth - assigned
            : (remainingWidth * (weights[index] ?? 1)) / totalWeight;
        result[index] = share;
        assigned += share;
      });
      break;
    }

    for (const index of clamped) {
      const minWidth = minWidthsPx[index] ?? 0;
      result[index] = minWidth;
      remainingWidth -= minWidth;
      active.delete(index);
    }
  }

  return result;
}

export interface PlannedLayoutNode {
  node: HomeLayoutNode;
  widthPx: number;
  /** y 分割的子節點會各自填滿同一寬度。 */
  children?: PlannedLayoutNode[];
  /** x 分割的各列；每個子樹都以實際分到的寬度繼續規劃。 */
  rows?: Array<{ widthPx: number; children: PlannedLayoutNode[] }>;
}

/** 純函式遞迴預演巢狀換行，讓渲染規則能在不啟動瀏覽器時驗證。 */
export function planNodeAtWidth(
  node: HomeLayoutNode,
  widthPx: number,
  gapPx = HOME_LAYOUT_GAP_PX,
): PlannedLayoutNode {
  const width = Math.max(0, Number.isFinite(widthPx) ? widthPx : 0);
  if (node.type === 'card') return { node, widthPx: width };
  if (node.axis === 'y') {
    return {
      node,
      widthPx: width,
      children: node.children.map((child) => planNodeAtWidth(child, width, gapPx)),
    };
  }

  const lines = wrapSplit(width, node.children.map(minWidthOf), node.weights, gapPx);
  return {
    node,
    widthPx: width,
    rows: lines.map((line) => ({
      widthPx: width,
      children: line.indices.map((childIndex, columnIndex) =>
        planNodeAtWidth(node.children[childIndex]!, line.columnWidthsPx[columnIndex]!, gapPx),
      ),
    })),
  };
}
