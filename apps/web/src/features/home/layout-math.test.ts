import { describe, expect, it } from 'vitest';
import type { HomeLayoutNode } from '@ledger/shared';
import { HOME_LAYOUT_GAP_PX, minWidthOf, wrapSplit } from './layout-math';

/** 純函式測試覆蓋卡片最小寬度、權重分配和逐層換行，不需要 DOM 尺寸。 */
describe('home layout math', () => {
  it('uses a card minimum width directly', () => {
    const card: HomeLayoutNode = { type: 'card', cardId: 'expense' };

    expect(minWidthOf(card)).toBe(314);
  });

  it('adds child minima and gaps for horizontal splits', () => {
    const split: HomeLayoutNode = {
      type: 'split',
      axis: 'x',
      children: [
        { type: 'card', cardId: 'expense' },
        { type: 'card', cardId: 'income' },
      ],
      weights: [5000, 5000],
    };

    expect(minWidthOf(split)).toBe(314 + 314 + HOME_LAYOUT_GAP_PX);
  });

  it('uses the widest child minimum for vertical splits', () => {
    const split: HomeLayoutNode = {
      type: 'split',
      axis: 'y',
      children: [
        { type: 'card', cardId: 'expense' },
        { type: 'card', cardId: 'trend' },
      ],
      weights: [5000, 5000],
    };

    expect(minWidthOf(split)).toBe(352);
  });

  it('keeps two columns together when their minima and gap fit exactly', () => {
    const [line] = wrapSplit(656, [320, 320], [1, 1], 16);

    expect(line?.indices).toEqual([0, 1]);
    expect(line?.columnWidthsPx[0]).toBe(320);
    expect(line?.columnWidthsPx[1]).toBe(320);
    expect(line!.columnWidthsPx.reduce((sum, width) => sum + width, 16)).toBe(656);
  });

  it('wraps when the available width is one pixel below the exact fit', () => {
    const lines = wrapSplit(655, [320, 320], [1, 1], 16);

    expect(lines.map(({ indices }) => indices)).toEqual([[0], [1]]);
  });

  it('puts every child on its own row when none of the minima fit', () => {
    const lines = wrapSplit(200, [320, 280, 240], [1, 1, 1], 16);

    expect(lines.map(({ indices }) => indices)).toEqual([[0], [1], [2]]);
    expect(lines.every(({ columnWidthsPx }) => columnWidthsPx[0] === 200)).toBe(true);
  });

  it('clamps a narrow weighted column to its minimum and redistributes the remainder', () => {
    const [line] = wrapSplit(700, [320, 320], [6667, 3333], 16);

    expect(line?.columnWidthsPx[1]).toBe(320);
    expect(line?.columnWidthsPx[0]).toBe(364);
    expect(line!.columnWidthsPx.reduce((sum, width) => sum + width, 16)).toBe(700);
  });

  it('subtracts gaps before distributing weighted width', () => {
    const [line] = wrapSplit(700, [200, 200], [1, 1], 20);

    expect(line?.columnWidthsPx).toEqual([340, 340]);
    expect(line!.columnWidthsPx.reduce((sum, width) => sum + width, 20)).toBe(700);
  });
});
