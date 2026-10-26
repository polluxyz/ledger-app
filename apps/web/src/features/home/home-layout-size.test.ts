import type { HomeCardId, HomeLayoutNode } from '@ledger/shared';
import { describe, expect, it } from 'vitest';
import { distributeWeightedHeights, planHomeLayoutHeight } from './home-layout-size';

const card = (cardId: HomeCardId): HomeLayoutNode => ({ type: 'card', cardId });
const split = (axis: 'x' | 'y', children: HomeLayoutNode[], weights: number[]): HomeLayoutNode => ({
  type: 'split',
  axis,
  children,
  weights,
});

/** 這組純函式測試驗證卡片自然高度、上下分割最低高度與額外空間的權重夾限。 */
describe('home-layout-size', () => {
  it('clamps a child at its natural minimum and redistributes the remaining height', () => {
    expect(distributeWeightedHeights(500, [300, 100], [2500, 7500])).toEqual([300, 200]);
  });

  it('uses max height for x splits and summed height plus gaps for y splits', () => {
    const layout = split(
      'x',
      [card('expense'), split('y', [card('income'), card('net')], [1, 1])],
      [1, 1],
    );
    const plan = planHomeLayoutHeight(
      layout,
      1200,
      { expense: 260, income: 120, net: 180 },
      0,
      'none',
    );

    expect(plan?.minHeightPx).toBe(316);
    expect(plan?.heightPx).toBe(316);
    expect(plan?.rows?.[0]?.children[0]?.plan.heightPx).toBe(316);
    expect(plan?.rows?.[0]?.children[1]?.plan.minHeightPx).toBe(316);
  });

  it('shares root extra height through shorter x columns into their y children', () => {
    const layout = split(
      'x',
      [card('expense'), split('y', [card('income'), card('net')], [2500, 7500])],
      [1, 1],
    );
    const plan = planHomeLayoutHeight(
      layout,
      1200,
      { expense: 200, income: 100, net: 100 },
      200,
      'none',
    );
    const rowChildren = plan?.rows?.[0]?.children;
    const vertical = rowChildren?.[1]?.plan;

    expect(plan?.minHeightPx).toBe(216);
    expect(plan?.heightPx).toBe(416);
    expect(rowChildren?.[0]?.plan.heightPx).toBe(416);
    expect(vertical?.heightPx).toBe(416);
    expect(vertical?.children?.map((child) => child.heightPx)).toEqual([100, 300]);
  });

  it('keeps y siblings at their minimums when a weighted share would be too small', () => {
    const layout = split('y', [card('expense'), card('income')], [2500, 7500]);
    const plan = planHomeLayoutHeight(layout, 500, { expense: 300, income: 100 }, 100, 'none');

    expect(plan?.children?.map((child) => child.heightPx)).toEqual([300, 200]);
    expect(plan?.children?.reduce((sum, child) => sum + child.heightPx, 16)).toBe(516);
  });
});
