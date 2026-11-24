import type { StatisticsGroup } from '@ledger/shared';
import { describe, expect, it } from 'vitest';
import css from '../../../styles/global.css?raw';
import {
  CATEGORY_CHART_COLORS,
  createCategoryGroupColor,
  NEUTRAL_CHART_COLORS,
} from './chart-colors';

function expenseCategories(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `category-${index}`,
    type: 'EXPENSE' as const,
    sortOrder: index,
  }));
}

function categoryGroup(id: string): StatisticsGroup {
  return {
    kind: 'CATEGORY',
    category: { id, name: id, icon: null },
    amount: 100,
    percentageBps: 100,
  };
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** 用完整帳本分類與不同畫面子集驗證固定色槽和撞色規則。 */
describe('statistics category colors', () => {
  it.each([6, 8, 12])('uses distinct colors for %i visible expense categories', (count) => {
    const categories = expenseCategories(count);
    const groups = categories.map(({ id }) => categoryGroup(id)).reverse();
    const colorOf = createCategoryGroupColor(categories, 'EXPENSE', groups, 'dark');

    expect(groups.map(colorOf)).toEqual(CATEGORY_CHART_COLORS.dark.slice(0, count).reverse());
    expect(new Set(groups.map(colorOf)).size).toBe(count);
  });

  it('uses an unused color for a later category with the same base slot', () => {
    const categories = expenseCategories(14);
    const groups = [categoryGroup('category-1'), categoryGroup('category-13')];
    const colorOf = createCategoryGroupColor(categories, 'EXPENSE', groups, 'dark');

    expect(groups.map(colorOf)).toEqual([
      CATEGORY_CHART_COLORS.dark[1],
      CATEGORY_CHART_COLORS.dark[0],
    ]);
  });

  it('reuses the original slot after all 12 colors are used', () => {
    const categories = expenseCategories(13);
    const groups = categories.map(({ id }) => categoryGroup(id));
    const colors = groups.map(createCategoryGroupColor(categories, 'EXPENSE', groups, 'dark'));

    expect(colors).toEqual([...CATEGORY_CHART_COLORS.dark, CATEGORY_CHART_COLORS.dark[0]]);
  });

  it('uses sort order, then id, within the selected direction regardless of the visible subset', () => {
    const categories = [
      { id: 'b', type: 'EXPENSE', sortOrder: 1 },
      { id: 'c', type: 'EXPENSE', sortOrder: 2 },
      { id: 'first', type: 'EXPENSE', sortOrder: 0 },
      { id: 'income', type: 'INCOME', sortOrder: 0 },
      { id: 'a', type: 'EXPENSE', sortOrder: 1 },
    ] as const;
    const b = categoryGroup('b');
    const a = categoryGroup('a');
    const c = categoryGroup('c');
    const october = createCategoryGroupColor(categories, 'EXPENSE', [b, c], 'dark');
    const november = createCategoryGroupColor(categories, 'EXPENSE', [a, b], 'dark');
    const income = categoryGroup('income');

    expect(october(b)).toBe(CATEGORY_CHART_COLORS.dark[2]);
    expect(november(b)).toBe(october(b));
    expect(november(a)).toBe(CATEGORY_CHART_COLORS.dark[1]);
    expect(october(c)).toBe(CATEGORY_CHART_COLORS.dark[3]);
    expect(createCategoryGroupColor(categories, 'INCOME', [income], 'dark')(income)).toBe(
      CATEGORY_CHART_COLORS.dark[0],
    );
  });

  it.each(['dark', 'light'] as const)(
    'uses neutral gray for fixed groups and unresolved categories in %s',
    (theme) => {
      const categories = expenseCategories(1);
      const category = categoryGroup(categories[0]!.id);
      const groups: StatisticsGroup[] = [
        { ...category, kind: 'UNCATEGORIZED', category: null },
        { ...category, kind: 'BAD_DEBT', category: null },
        { ...category, kind: 'DEBT_FORGIVEN', category: null },
        { ...category, kind: 'DIFFERENCE', category: null },
        { ...category, category: null },
        categoryGroup('missing'),
      ];

      expect(groups.map(createCategoryGroupColor(categories, 'EXPENSE', groups, theme))).toEqual(
        groups.map(() => NEUTRAL_CHART_COLORS[theme]),
      );
      expect(createCategoryGroupColor(undefined, 'EXPENSE', [category], theme)(category)).toBe(
        NEUTRAL_CHART_COLORS[theme],
      );
    },
  );

  it.each(['dark', 'light'] as const)(
    'meets 3:1 contrast for all 12 %s colors against the card token',
    (theme) => {
      const selector =
        theme === 'dark' ? /:root\s*\{([^}]+)\}/ : /:root\[data-theme='light'\]\s*\{([^}]+)\}/;
      const surface = css.match(selector)?.[1]?.match(/--color-surface:\s*(#[0-9a-f]{6});/i)?.[1];
      expect(surface).toBeDefined();
      const background = luminance(surface!);
      const colors = CATEGORY_CHART_COLORS[theme];

      expect(new Set(colors).size).toBe(12);
      for (const color of colors) {
        const foreground = luminance(color);
        const ratio =
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        expect(ratio, color).toBeGreaterThanOrEqual(3);
      }
    },
  );
});
