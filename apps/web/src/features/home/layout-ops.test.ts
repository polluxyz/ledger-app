import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOME_LAYOUT_V1,
  HOME_CARD_IDS,
  parseHomeLayoutV1,
  type HomeCardId,
  type HomeLayoutNode,
  type HomeLayoutV1,
} from '@ledger/shared';
import {
  canDrop,
  HOME_LAYOUT_MIN_CARD_HEIGHT_PX,
  isWithinLayoutLimits,
  moveCard,
  resizeBand,
  resizeSplit,
  type HomeLayoutDropSide,
} from './layout-ops';
import { HOME_LAYOUT_GAP_PX, minWidthOfCard } from './layout-math';

/**
 * 首頁版面運算測試以 parser 驗證每次產出，再檢查結構與權重；隨機移動使用固定 seed，
 * 不依賴瀏覽器尺寸或外部 property-testing 套件。
 */

function card(cardId: HomeCardId): HomeLayoutNode {
  return { type: 'card', cardId };
}

function split(axis: 'x' | 'y', children: HomeLayoutNode[], weights: number[]): HomeLayoutNode {
  return { type: 'split', axis, children, weights };
}

function weightsFor(count: number): number[] {
  const base = Math.floor(10_000 / count);
  return Array.from({ length: count }, (_, index) =>
    index === count - 1 ? 10_000 - base * (count - 1) : base,
  );
}

function oneRowLayout(cardIds: readonly HomeCardId[] = HOME_CARD_IDS): HomeLayoutV1 {
  return {
    bands: [
      {
        root: split('x', cardIds.map(card), weightsFor(cardIds.length)),
        extraHeightPx: 0,
      },
    ],
  };
}

function collectCards(node: HomeLayoutNode): HomeCardId[] {
  if (node.type === 'card') return [node.cardId];
  return node.children.flatMap(collectCards);
}

function assertValidLayout(layout: HomeLayoutV1): void {
  const result = parseHomeLayoutV1(layout);
  expect(result.ok, result.ok ? undefined : result.reason).toBe(true);
}

function assertNormalizedWeights(node: HomeLayoutNode): void {
  if (node.type === 'card') return;
  expect(node.weights).toHaveLength(node.children.length);
  expect(node.weights.every((weight) => Number.isInteger(weight) && weight > 0)).toBe(true);
  expect(node.weights.reduce((sum, weight) => sum + weight, 0)).toBe(10_000);
  node.children.forEach(assertNormalizedWeights);
}

function assertNoAdjacentSameAxis(node: HomeLayoutNode, parentAxis?: 'x' | 'y'): void {
  if (node.type === 'card') return;
  expect(node.axis).not.toBe(parentAxis);
  node.children.forEach((child) => assertNoAdjacentSameAxis(child, node.axis));
}

function createDeepLayout(): HomeLayoutV1 {
  let root: HomeLayoutNode = split('y', [card('activity'), card('accounts')], [5000, 5000]);
  root = split('x', [card('categories'), root], [1000, 9000]);
  root = split('y', [card('trend'), root], [1000, 9000]);
  root = split('x', [card('net'), root], [1000, 9000]);
  root = split('y', [card('income'), root], [1000, 9000]);
  root = split('x', [card('expense'), root], [1000, 9000]);

  return {
    bands: [
      { root, extraHeightPx: 0 },
      { root: card('debts'), extraHeightPx: 0 },
    ],
  };
}

describe('home layout operations', () => {
  it.each([
    { side: 'left' as const, expectedIds: ['trend', 'accounts', 'categories'] },
    { side: 'right' as const, expectedIds: ['trend', 'categories', 'accounts'] },
  ])(
    'moves accounts to the $side of categories and flattens the x split',
    ({ side, expectedIds }) => {
      const result = moveCard(DEFAULT_HOME_LAYOUT_V1, 'accounts', 'categories', side);
      const targetBand = result.bands[1]!;

      expect(targetBand.root.type).toBe('split');
      if (targetBand.root.type === 'split') {
        expect(targetBand.root.axis).toBe('x');
        expect(targetBand.root.children.map((child) => collectCards(child)[0])).toEqual(
          expectedIds,
        );
        expect(targetBand.root.children).toHaveLength(3);
      }
      expect(collectCards(result.bands[2]!.root)).toEqual(['activity', 'debts']);
      assertValidLayout(result);
      result.bands.forEach(({ root }) => assertNoAdjacentSameAxis(root));
    },
  );

  it.each([
    { side: 'top' as const, expectedIds: ['accounts', 'categories'] },
    { side: 'bottom' as const, expectedIds: ['categories', 'accounts'] },
  ])('moves accounts to the $side of categories in a nested y split', ({ side, expectedIds }) => {
    const result = moveCard(DEFAULT_HOME_LAYOUT_V1, 'accounts', 'categories', side);
    const targetBand = result.bands[1]!;

    expect(targetBand.root.type).toBe('split');
    if (targetBand.root.type === 'split') {
      const nested = targetBand.root.children[1];
      expect(nested?.type).toBe('split');
      if (nested?.type === 'split') {
        expect(nested.axis).toBe('y');
        expect(nested.children.map((child) => collectCards(child)[0])).toEqual(expectedIds);
      }
    }
    expect(collectCards(result.bands[2]!.root)).toEqual(['activity', 'debts']);
    assertValidLayout(result);
  });

  it.each([0, 3, 7])(
    'removes and reinserts a card originally at row position %i',
    (sourceIndex) => {
      const layout = oneRowLayout();
      const cardId = HOME_CARD_IDS[sourceIndex]!;
      const targetCardId = HOME_CARD_IDS[(sourceIndex + 1) % HOME_CARD_IDS.length]!;
      const result = moveCard(layout, cardId, targetCardId, 'right');

      expect(collectCards(result.bands[0]!.root)).toHaveLength(HOME_CARD_IDS.length);
      expect(new Set(collectCards(result.bands[0]!.root))).toEqual(new Set(HOME_CARD_IDS));
      assertValidLayout(result);
      assertNormalizedWeights(result.bands[0]!.root);
    },
  );

  it('deletes a row that contained only the moved card', () => {
    const layout: HomeLayoutV1 = {
      bands: [
        { root: card('expense'), extraHeightPx: 10 },
        {
          root: split(
            'x',
            (
              [
                'income',
                'net',
                'trend',
                'categories',
                'activity',
                'accounts',
                'debts',
              ] as HomeCardId[]
            ).map(card),
            weightsFor(7),
          ),
          extraHeightPx: 20,
        },
      ],
    };

    const result = moveCard(layout, 'expense', 'categories', 'left');

    expect(result.bands).toHaveLength(1);
    expect(result.bands[0]!.extraHeightPx).toBe(20);
    expect(collectCards(result.bands[0]!.root)).toHaveLength(8);
    assertValidLayout(result);
  });

  it('collapses a one-child nested split after moving its card away', () => {
    const layout: HomeLayoutV1 = {
      bands: [
        {
          root: split(
            'x',
            [split('y', [card('accounts'), card('debts')], [5000, 5000]), card('activity')],
            [6000, 4000],
          ),
          extraHeightPx: 0,
        },
        {
          root: split('x', [card('expense'), card('income'), card('net')], [3333, 3333, 3334]),
          extraHeightPx: 0,
        },
        { root: split('x', [card('trend'), card('categories')], [6667, 3333]), extraHeightPx: 0 },
      ],
    };

    const result = moveCard(layout, 'accounts', 'expense', 'left');

    expect(result.bands[0]!.root.type).toBe('split');
    if (result.bands[0]!.root.type === 'split') {
      expect(result.bands[0]!.root.children[0]).toEqual(card('debts'));
    }
    assertValidLayout(result);
    result.bands.forEach(({ root }) => assertNoAdjacentSameAxis(root));
  });

  it('redistributes removed space proportionally and normalizes every split to positive integers', () => {
    const result = moveCard(DEFAULT_HOME_LAYOUT_V1, 'accounts', 'categories', 'bottom');

    result.bands.forEach(({ root }) => assertNormalizedWeights(root));
    expect(collectCards(result.bands[2]!.root)).toEqual(['activity', 'debts']);
    assertValidLayout(result);
  });

  it('does not mutate the source layout and returns it for a self move', () => {
    const layout = JSON.parse(JSON.stringify(DEFAULT_HOME_LAYOUT_V1)) as HomeLayoutV1;
    const before = JSON.stringify(layout);
    const moved = moveCard(layout, 'accounts', 'categories', 'left');

    expect(JSON.stringify(layout)).toBe(before);
    expect(moved).not.toBe(layout);
    expect(moveCard(layout, 'accounts', 'accounts', 'left')).toBe(layout);
  });

  it('rejects moves that exceed split depth while allowing a very wide eight-card row', () => {
    const deepLayout = createDeepLayout();
    assertValidLayout(deepLayout);
    const overLimit = moveCard(deepLayout, 'debts', 'accounts', 'left');

    expect(isWithinLayoutLimits(overLimit)).toBe(false);
    expect(
      canDrop(deepLayout, 'debts', 'accounts', 'left', { widthPx: 10_000, heightPx: 10_000 }),
    ).toBe(false);

    const wideLayout = oneRowLayout();
    expect(
      canDrop(wideLayout, 'accounts', 'categories', 'left', { widthPx: 10_000, heightPx: 500 }),
    ).toBe(true);
    assertValidLayout(moveCard(wideLayout, 'accounts', 'categories', 'left'));
  });

  it('checks the split half against registered widths and the documented height fallback', () => {
    const horizontalBoundaryPx =
      2 * Math.max(minWidthOfCard('accounts'), minWidthOfCard('categories')) + HOME_LAYOUT_GAP_PX;
    const verticalBoundaryPx = HOME_LAYOUT_MIN_CARD_HEIGHT_PX * 2 + HOME_LAYOUT_GAP_PX;

    expect(
      canDrop(DEFAULT_HOME_LAYOUT_V1, 'accounts', 'categories', 'left', {
        widthPx: horizontalBoundaryPx - 1,
        heightPx: 500,
      }),
    ).toBe(false);
    expect(
      canDrop(DEFAULT_HOME_LAYOUT_V1, 'accounts', 'categories', 'left', {
        widthPx: horizontalBoundaryPx,
        heightPx: 500,
      }),
    ).toBe(true);
    expect(
      canDrop(DEFAULT_HOME_LAYOUT_V1, 'accounts', 'categories', 'top', {
        widthPx: horizontalBoundaryPx,
        heightPx: verticalBoundaryPx - 1,
      }),
    ).toBe(false);
    expect(
      canDrop(DEFAULT_HOME_LAYOUT_V1, 'accounts', 'categories', 'top', {
        widthPx: horizontalBoundaryPx,
        heightPx: verticalBoundaryPx,
      }),
    ).toBe(true);
    expect(
      canDrop(DEFAULT_HOME_LAYOUT_V1, 'accounts', 'accounts', 'top', {
        widthPx: 900,
        heightPx: 500,
      }),
    ).toBe(false);
  });

  it('resizes adjacent split children in opposite directions and preserves other weights', () => {
    const original = DEFAULT_HOME_LAYOUT_V1.bands[0]!.root;
    expect(original.type).toBe('split');
    if (original.type !== 'split') throw new Error('測試預設列必須是分割。');

    const result = resizeSplit(
      DEFAULT_HOME_LAYOUT_V1,
      { bandIndex: 0, nodePath: [] },
      0,
      100,
      1000,
      [200, 200, 200],
    );
    const resized = result.bands[0]!.root;
    expect(resized.type).toBe('split');
    if (resized.type === 'split') {
      expect(resized.weights[0]).toBeGreaterThan(original.weights[0]!);
      expect(resized.weights[1]).toBeLessThan(original.weights[1]!);
      expect(resized.weights[2]).toBe(original.weights[2]);
      expect(resized.weights.reduce((sum, weight) => sum + weight, 0)).toBe(10_000);
      expect(resized.weights.every((weight) => Number.isInteger(weight) && weight > 0)).toBe(true);
    }
    assertValidLayout(result);
  });

  it('clamps a divider at each adjacent child minimum', () => {
    const layout: HomeLayoutV1 = {
      bands: [
        { root: split('x', [card('expense'), card('income')], [5000, 5000]), extraHeightPx: 0 },
        {
          root: split(
            'x',
            [
              card('net'),
              card('trend'),
              card('categories'),
              card('activity'),
              card('accounts'),
              card('debts'),
            ],
            weightsFor(6),
          ),
          extraHeightPx: 0,
        },
      ],
    };
    const result = resizeSplit(layout, { bandIndex: 0, nodePath: [] }, 0, -1000, 1000, [200, 300]);
    const resized = result.bands[0]!.root;

    expect(resized.type).toBe('split');
    if (resized.type === 'split') {
      expect((1000 * resized.weights[0]!) / 10_000).toBeGreaterThanOrEqual(200);
      expect((1000 * resized.weights[1]!) / 10_000).toBeGreaterThanOrEqual(300);
      expect(resized.weights).toEqual([2000, 8000]);
    }
    expect(result.bands[1]).toEqual(layout.bands[1]);
    assertValidLayout(result);
  });

  it('leaves a split unchanged when the path, divider, or minimums are invalid', () => {
    expect(
      resizeSplit(
        DEFAULT_HOME_LAYOUT_V1,
        { bandIndex: 0, nodePath: [99] },
        0,
        100,
        1000,
        [100, 100, 100],
      ),
    ).toBe(DEFAULT_HOME_LAYOUT_V1);
    expect(
      resizeSplit(
        DEFAULT_HOME_LAYOUT_V1,
        { bandIndex: 0, nodePath: [] },
        2,
        100,
        1000,
        [100, 100, 100],
      ),
    ).toBe(DEFAULT_HOME_LAYOUT_V1);
  });

  it('changes only one band height and clamps the rounded value between 0 and 1600', () => {
    const raised = resizeBand(DEFAULT_HOME_LAYOUT_V1, 2, 200.4);
    expect(raised.bands[2]!.extraHeightPx).toBe(200);
    expect(raised.bands[0]).toEqual(DEFAULT_HOME_LAYOUT_V1.bands[0]);
    expect(raised.bands[1]).toEqual(DEFAULT_HOME_LAYOUT_V1.bands[1]);

    const capped = resizeBand(raised, 2, 5000);
    expect(capped.bands[2]!.extraHeightPx).toBe(1600);
    const floored = resizeBand(capped, 2, -5000);
    expect(floored.bands[2]!.extraHeightPx).toBe(0);
    expect(resizeBand(floored, 2, -1)).toBe(floored);
  });

  it('keeps 200 seeded limit-legal moves parseable after every step', () => {
    let seed = 0x2_1a_10;
    const randomIndex = (limit: number) => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed % limit;
    };

    let layout = DEFAULT_HOME_LAYOUT_V1;
    let movedCount = 0;
    let attempts = 0;
    while (movedCount < 200 && attempts < 10_000) {
      attempts += 1;
      const cardId = HOME_CARD_IDS[randomIndex(HOME_CARD_IDS.length)]!;
      let targetCardId = HOME_CARD_IDS[randomIndex(HOME_CARD_IDS.length)]!;
      if (targetCardId === cardId) {
        targetCardId =
          HOME_CARD_IDS[(HOME_CARD_IDS.indexOf(targetCardId) + 1) % HOME_CARD_IDS.length]!;
      }
      const side = (['left', 'right', 'top', 'bottom'] as const)[randomIndex(4)]!;
      const candidate = moveCard(layout, cardId, targetCardId, side satisfies HomeLayoutDropSide);
      if (!isWithinLayoutLimits(candidate) || candidate === layout) continue;

      layout = candidate;
      movedCount += 1;
      assertValidLayout(layout);
    }

    expect(movedCount).toBe(200);
  });
});
