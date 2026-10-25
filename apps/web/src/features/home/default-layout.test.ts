import { describe, expect, it } from 'vitest';
import { DEFAULT_HOME_LAYOUT_V1, HOME_CARD_IDS, type HomeLayoutNode } from '@ledger/shared';
import { HOME_CARD_REGISTRY } from './card-registry';
import { HOME_LAYOUT_GAP_PX, minWidthOf, planNodeAtWidth } from './layout-math';

/** 首頁預設版面與登記表一起驗證，避免漏卡、重複卡或權重錯誤進入畫面。 */
describe('home default layout', () => {
  it('shows each registered card exactly once and keeps every split weight total at 10000', () => {
    const cardIds: string[] = [];

    function visit(node: HomeLayoutNode) {
      if (node.type === 'card') {
        cardIds.push(node.cardId);
        return;
      }
      expect(node.weights).toHaveLength(node.children.length);
      expect(node.weights.reduce((sum, weight) => sum + weight, 0)).toBe(10_000);
      node.children.forEach(visit);
    }

    DEFAULT_HOME_LAYOUT_V1.bands.forEach(({ root }) => visit(root));
    expect([...cardIds].sort()).toEqual([...HOME_CARD_IDS].sort());
    expect(new Set(cardIds).size).toBe(HOME_CARD_IDS.length);
    expect(Object.keys(HOME_CARD_REGISTRY).sort()).toEqual([...HOME_CARD_IDS].sort());
    expect(
      Object.values(HOME_CARD_REGISTRY).every(({ minWidthPx, render }) => minWidthPx > 0 && render),
    ).toBe(true);
  });

  it('keeps the default three-card rows unwrapped at the 976px content width', () => {
    const defaultContentWidth = 976;
    const firstBand = DEFAULT_HOME_LAYOUT_V1.bands[0]!;
    const lastBand = DEFAULT_HOME_LAYOUT_V1.bands[2]!;

    expect(firstBand.root.type).toBe('split');
    expect(minWidthOf(firstBand.root)).toBeLessThanOrEqual(defaultContentWidth);
    if (firstBand.root.type === 'split') {
      expect(
        firstBand.root.children.map(minWidthOf).every((width) => width <= (976 - 32) / 3),
      ).toBe(true);
    }

    // 976px − 2 × 16px 間距 − 3 × 314px 卡片＝2px 餘裕。
    expect(976 - 2 * HOME_LAYOUT_GAP_PX - 3 * HOME_CARD_REGISTRY.expense.minWidthPx).toBe(2);
    // 最近活動、帳戶與借還的最小寬度各 314px，共 974px。
    expect(minWidthOf(lastBand.root)).toBe(974);
  });

  it.each([1152, 976])(
    'wraps every layer of the nested SC-Y29 layout within %i pixels',
    (widthPx) => {
      const nested: HomeLayoutNode = {
        type: 'split',
        axis: 'x',
        children: [
          { type: 'card', cardId: 'expense' },
          {
            type: 'split',
            axis: 'y',
            children: [
              {
                type: 'split',
                axis: 'x',
                children: [
                  { type: 'card', cardId: 'income' },
                  { type: 'card', cardId: 'net' },
                  { type: 'card', cardId: 'trend' },
                  { type: 'card', cardId: 'categories' },
                ],
                weights: [2500, 2500, 2500, 2500],
              },
              {
                type: 'split',
                axis: 'x',
                children: [
                  { type: 'card', cardId: 'activity' },
                  { type: 'card', cardId: 'accounts' },
                  { type: 'card', cardId: 'debts' },
                ],
                weights: [3333, 3333, 3334],
              },
            ],
            weights: [5000, 5000],
          },
        ],
        weights: [2500, 7500],
      };

      const plan = planNodeAtWidth(nested, widthPx);
      function assertWithin(node: ReturnType<typeof planNodeAtWidth>, availableWidth: number) {
        expect(node.widthPx).toBeLessThanOrEqual(availableWidth);
        if (node.node.type === 'split' && node.node.axis === 'x') {
          for (const row of node.rows ?? []) {
            const rowUsedWidth =
              row.children.reduce((sum, child) => sum + child.widthPx, 0) +
              HOME_LAYOUT_GAP_PX * Math.max(0, row.children.length - 1);
            expect(rowUsedWidth).toBeLessThanOrEqual(row.widthPx + 0.01);
            row.children.forEach((child) => assertWithin(child, row.widthPx));
          }
        } else {
          node.children?.forEach((child) => assertWithin(child, node.widthPx));
        }
      }

      assertWithin(plan, widthPx);
    },
  );
});
