import type { HomeCardId, HomeLayoutNode, HomeLayoutV1 } from '@ledger/shared';
import { parseHomeLayoutV1 } from '@ledger/shared';
import { minWidthOfCard } from './layout-math';

/**
 * 首頁版面的純運算：移卡、落點檢查、列內分隔線與根列高度調整。
 * 所有操作都建立新物件；上限檢查沿用 shared parser，讓拖動與鍵盤操作共用同一條格式界線。
 */

const LAYOUT_WEIGHT_TOTAL = 10_000;

export type HomeLayoutDropSide = 'left' | 'right' | 'top' | 'bottom';

export interface HomeLayoutCardSize {
  widthPx: number;
  heightPx: number;
}

/**
 * 專案目前沒有通用卡片最小高度；落點沿用 SC-Y4 規定的趨勢圖面 180px 下限，
 * 讓上下分割也有明確、可測試的門檻。
 */
export const HOME_LAYOUT_MIN_CARD_HEIGHT_PX = 180;

/** nodePath 是從該列 root 開始的子節點索引；空陣列代表調整 root 分割。 */
export interface HomeLayoutSplitPath {
  bandIndex: number;
  nodePath: readonly number[];
}

/** 最小尺寸陣列依分割節點的 children 索引排列。 */
export type HomeLayoutSplitMinimumsPx = readonly number[];

interface WeightedNode {
  node: HomeLayoutNode;
  weight: number;
}

/** 以最大餘數法正規化，並先替每個子節點保留 1，避免四捨五入產生零權重。 */
function normalizeWeights(rawWeights: readonly number[], total = LAYOUT_WEIGHT_TOTAL): number[] {
  if (rawWeights.length === 0) return [];

  const safeTotal = Math.max(rawWeights.length, Math.round(total));
  const currentSum = rawWeights.reduce((sum, weight) => sum + weight, 0);
  if (
    safeTotal === LAYOUT_WEIGHT_TOTAL &&
    rawWeights.every((weight) => Number.isInteger(weight) && weight > 0) &&
    currentSum === LAYOUT_WEIGHT_TOTAL
  ) {
    return [...rawWeights];
  }

  const positiveWeights = rawWeights.map((weight) =>
    Number.isFinite(weight) && weight > 0 ? weight : 1,
  );
  const weightSum = positiveWeights.reduce((sum, weight) => sum + weight, 0);
  const distributable = safeTotal - positiveWeights.length;
  const exactShares = positiveWeights.map((weight) => (weight / weightSum) * distributable);
  const roundedShares = exactShares.map(Math.floor);
  const remaining = distributable - roundedShares.reduce((sum, share) => sum + share, 0);
  const remainderOrder = exactShares
    .map((share, index) => ({ index, remainder: share - Math.floor(share) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);

  for (let index = 0; index < remaining; index += 1) {
    const selected = remainderOrder[index % remainderOrder.length];
    if (selected) roundedShares[selected.index] = (roundedShares[selected.index] ?? 0) + 1;
  }

  return roundedShares.map((share) => share + 1);
}

function cloneNode(node: HomeLayoutNode): HomeLayoutNode {
  if (node.type === 'card') return { type: 'card', cardId: node.cardId };
  return {
    type: 'split',
    axis: node.axis,
    children: node.children.map(cloneNode),
    weights: [...node.weights],
  };
}

/**
 * 收合空分割、單子分割，並把直接相連的同方向分割展開成同一層。
 * 展開時先依父子權重相乘算出相對比例，最後以最大餘數法回到 10000，避免空間因巢狀而流失。
 */
function canonicalizeNode(node: HomeLayoutNode): HomeLayoutNode | null {
  if (node.type === 'card') return { type: 'card', cardId: node.cardId };

  const flattened: WeightedNode[] = [];
  node.children.forEach((childNode, childIndex) => {
    const child = canonicalizeNode(childNode);
    if (!child) return;

    const parentWeight = node.weights[childIndex] ?? 1;
    if (child.type === 'split' && child.axis === node.axis) {
      child.children.forEach((grandchild, grandchildIndex) => {
        flattened.push({
          node: grandchild,
          weight: (parentWeight * (child.weights[grandchildIndex] ?? 1)) / LAYOUT_WEIGHT_TOTAL,
        });
      });
    } else {
      flattened.push({ node: child, weight: parentWeight });
    }
  });

  if (flattened.length === 0) return null;
  if (flattened.length === 1) return flattened[0]!.node;

  return {
    type: 'split',
    axis: node.axis,
    children: flattened.map(({ node: child }) => child),
    weights: normalizeWeights(flattened.map(({ weight }) => weight)),
  };
}

interface RemovalResult {
  node: HomeLayoutNode | null;
  removed: boolean;
}

function removeCardFromNode(node: HomeLayoutNode, cardId: HomeCardId): RemovalResult {
  if (node.type === 'card') {
    return node.cardId === cardId
      ? { node: null, removed: true }
      : { node: cloneNode(node), removed: false };
  }

  const children: HomeLayoutNode[] = [];
  const weights: number[] = [];
  let removed = false;

  node.children.forEach((child, index) => {
    const result = removeCardFromNode(child, cardId);
    removed ||= result.removed;
    if (result.node) {
      children.push(result.node);
      weights.push(node.weights[index] ?? 1);
    }
  });

  if (!removed) return { node: cloneNode(node), removed: false };
  if (children.length === 0) return { node: null, removed: true };
  if (children.length === 1) return { node: children[0]!, removed: true };

  return {
    node: {
      type: 'split',
      axis: node.axis,
      children,
      // 被移走的空間只在原分割的兄弟之間按原比例分配，不影響其他列。
      weights: normalizeWeights(weights),
    },
    removed: true,
  };
}

function axisForSide(side: HomeLayoutDropSide): 'x' | 'y' {
  return side === 'left' || side === 'right' ? 'x' : 'y';
}

interface InsertionResult {
  node: HomeLayoutNode;
  inserted: boolean;
}

function insertAdjacentToCard(
  node: HomeLayoutNode,
  cardId: HomeCardId,
  targetCardId: HomeCardId,
  side: HomeLayoutDropSide,
): InsertionResult {
  if (node.type === 'card') {
    if (node.cardId !== targetCardId) return { node: cloneNode(node), inserted: false };

    const movedCard: HomeLayoutNode = { type: 'card', cardId };
    const targetCard: HomeLayoutNode = { type: 'card', cardId: targetCardId };
    const insertBefore = side === 'left' || side === 'top';
    return {
      node: {
        type: 'split',
        axis: axisForSide(side),
        children: insertBefore ? [movedCard, targetCard] : [targetCard, movedCard],
        weights: [5000, 5000],
      },
      inserted: true,
    };
  }

  let inserted = false;
  const children = node.children.map((child) => {
    const result = insertAdjacentToCard(child, cardId, targetCardId, side);
    inserted ||= result.inserted;
    return result.node;
  });

  return {
    node: inserted
      ? { type: 'split', axis: node.axis, children, weights: [...node.weights] }
      : cloneNode(node),
    inserted,
  };
}

function nodesEqual(left: HomeLayoutNode, right: HomeLayoutNode): boolean {
  if (left.type !== right.type) return false;
  if (left.type === 'card' && right.type === 'card') return left.cardId === right.cardId;
  if (left.type !== 'split' || right.type !== 'split') return false;
  return (
    left.axis === right.axis &&
    left.weights.length === right.weights.length &&
    left.weights.every((weight, index) => weight === right.weights[index]) &&
    left.children.length === right.children.length &&
    left.children.every((child, index) => {
      const rightChild = right.children[index];
      return rightChild !== undefined && nodesEqual(child, rightChild);
    })
  );
}

function layoutsEqual(left: HomeLayoutV1, right: HomeLayoutV1): boolean {
  return (
    left.bands.length === right.bands.length &&
    left.bands.every((band, index) => {
      const rightBand = right.bands[index];
      return (
        rightBand !== undefined &&
        band.extraHeightPx === rightBand.extraHeightPx &&
        nodesEqual(band.root, rightBand.root)
      );
    })
  );
}

/** 將卡片移到目標卡的指定一側；輸入版面不會被改動。 */
export function moveCard(
  layout: HomeLayoutV1,
  cardId: HomeCardId,
  targetCardId: HomeCardId,
  side: HomeLayoutDropSide,
): HomeLayoutV1 {
  if (cardId === targetCardId) return layout;

  const remainingBands: HomeLayoutV1['bands'] = [];
  let removed = false;
  for (const band of layout.bands) {
    const result = removeCardFromNode(band.root, cardId);
    removed ||= result.removed;
    if (result.node) {
      const canonicalRoot = canonicalizeNode(result.node);
      if (canonicalRoot)
        remainingBands.push({ root: canonicalRoot, extraHeightPx: band.extraHeightPx });
    }
  }
  if (!removed) return layout;

  let inserted = false;
  const insertedBands = remainingBands.map((band) => {
    const result = insertAdjacentToCard(band.root, cardId, targetCardId, side);
    if (!result.inserted) return band;
    inserted = true;
    return { root: result.node, extraHeightPx: band.extraHeightPx };
  });
  if (!inserted) return layout;

  const bands = insertedBands.flatMap((band) => {
    const root = canonicalizeNode(band.root);
    return root ? [{ root, extraHeightPx: band.extraHeightPx }] : [];
  });
  const candidate: HomeLayoutV1 = { bands };
  return layoutsEqual(layout, candidate) ? layout : candidate;
}

/** 使用 shared parser 的完整規則檢查版面上限，供拖動與「移到…」共用。 */
export function isWithinLayoutLimits(input: unknown): input is HomeLayoutV1 {
  return parseHomeLayoutV1(input).ok;
}

/** 落點檢查只看 shared 格式上限與實際落點半邊尺寸，不限制整份版面的最小寬度。 */
export function canDrop(
  layout: HomeLayoutV1,
  cardId: HomeCardId,
  targetCardId: HomeCardId,
  side: HomeLayoutDropSide,
  sizes: HomeLayoutCardSize,
): boolean {
  if (cardId === targetCardId) return false;

  const candidate = moveCard(layout, cardId, targetCardId, side);
  if (!isWithinLayoutLimits(candidate)) return false;
  if (
    !Number.isFinite(sizes.widthPx) ||
    !Number.isFinite(sizes.heightPx) ||
    sizes.widthPx < 0 ||
    sizes.heightPx < 0
  ) {
    return false;
  }

  if (axisForSide(side) === 'x') {
    const halfWidth = sizes.widthPx / 2;
    return halfWidth >= minWidthOfCard(cardId) && halfWidth >= minWidthOfCard(targetCardId);
  }

  const halfHeight = sizes.heightPx / 2;
  return (
    halfHeight >= HOME_LAYOUT_MIN_CARD_HEIGHT_PX && halfHeight >= HOME_LAYOUT_MIN_CARD_HEIGHT_PX
  );
}

interface SplitUpdateResult {
  node: HomeLayoutNode;
  updated: boolean;
}

function updateSplitAtPath(
  node: HomeLayoutNode,
  nodePath: readonly number[],
  update: (split: Extract<HomeLayoutNode, { type: 'split' }>) => HomeLayoutNode,
): SplitUpdateResult {
  if (nodePath.length === 0) {
    if (node.type !== 'split') return { node, updated: false };
    const updatedNode = update(node);
    return { node: updatedNode, updated: updatedNode !== node };
  }

  if (node.type !== 'split') return { node, updated: false };
  const [childIndex, ...rest] = nodePath;
  if (childIndex === undefined || childIndex < 0 || childIndex >= node.children.length) {
    return { node, updated: false };
  }

  const childResult = updateSplitAtPath(node.children[childIndex]!, rest, update);
  if (!childResult.updated) return { node, updated: false };
  const children = [...node.children];
  children[childIndex] = childResult.node;
  return {
    node: { type: 'split', axis: node.axis, children, weights: [...node.weights] },
    updated: true,
  };
}

/** 調整同一分割中相鄰兩個子節點；空間只在這兩者間一增一減，其他權重不動。 */
export function resizeSplit(
  layout: HomeLayoutV1,
  path: HomeLayoutSplitPath,
  index: number,
  deltaPx: number,
  containerPx: number,
  minPx: HomeLayoutSplitMinimumsPx,
): HomeLayoutV1 {
  const band = layout.bands[path.bandIndex];
  if (
    !band ||
    !Number.isInteger(index) ||
    !Number.isFinite(deltaPx) ||
    !Number.isFinite(containerPx) ||
    containerPx <= 0
  ) {
    return layout;
  }

  const result = updateSplitAtPath(band.root, path.nodePath, (split) => {
    const nextIndex = index + 1;
    if (
      index < 0 ||
      nextIndex >= split.children.length ||
      minPx.length !== split.children.length ||
      !Number.isFinite(minPx[index]) ||
      !Number.isFinite(minPx[nextIndex]) ||
      minPx[index]! < 0 ||
      minPx[nextIndex]! < 0
    ) {
      return split;
    }

    const firstWeight = split.weights[index]!;
    const secondWeight = split.weights[nextIndex]!;
    const pairWeight = firstWeight + secondWeight;
    const firstMinimumWeight = Math.max(
      1,
      Math.ceil((minPx[index]! * LAYOUT_WEIGHT_TOTAL) / containerPx),
    );
    const secondMinimumWeight = Math.max(
      1,
      Math.ceil((minPx[nextIndex]! * LAYOUT_WEIGHT_TOTAL) / containerPx),
    );
    const maximumFirstWeight = pairWeight - secondMinimumWeight;
    if (firstMinimumWeight > maximumFirstWeight) return split;

    const currentFirstPx = (containerPx * firstWeight) / LAYOUT_WEIGHT_TOTAL;
    const currentSecondPx = (containerPx * secondWeight) / LAYOUT_WEIGHT_TOTAL;
    const boundedDelta = Math.min(
      currentSecondPx - minPx[nextIndex]!,
      Math.max(minPx[index]! - currentFirstPx, deltaPx),
    );
    const adjustedFirstWeight = Math.min(
      maximumFirstWeight,
      Math.max(
        firstMinimumWeight,
        Math.round(firstWeight + (boundedDelta * LAYOUT_WEIGHT_TOTAL) / containerPx),
      ),
    );
    const adjustedSecondWeight = pairWeight - adjustedFirstWeight;
    if (adjustedFirstWeight === firstWeight && adjustedSecondWeight === secondWeight) return split;

    const weights = [...split.weights];
    weights[index] = adjustedFirstWeight;
    weights[nextIndex] = adjustedSecondWeight;
    return { type: 'split', axis: split.axis, children: split.children.map(cloneNode), weights };
  });

  if (!result.updated) return layout;
  const bands = [...layout.bands];
  bands[path.bandIndex] = { root: result.node, extraHeightPx: band.extraHeightPx };
  return { bands };
}

/** 只改指定根列的額外高度；依決策 332，列高不向其他根列借還。 */
export function resizeBand(layout: HomeLayoutV1, bandIndex: number, deltaPx: number): HomeLayoutV1 {
  const band = layout.bands[bandIndex];
  if (!band || !Number.isFinite(deltaPx)) return layout;

  const extraHeightPx = Math.min(1600, Math.max(0, Math.round(band.extraHeightPx + deltaPx)));
  if (extraHeightPx === band.extraHeightPx) return layout;

  const bands = [...layout.bands];
  bands[bandIndex] = { root: cloneNode(band.root), extraHeightPx };
  return { bands };
}
