import type { StatisticsGroup } from '@ledger/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getStatisticsGroupColor,
  NEUTRAL_CHART_COLORS,
} from '../features/statistics/charts/chart-colors';
import {
  createHomeCategoryColorStore,
  HOME_CATEGORY_COLORS_STORAGE_KEY,
  homeCategoryColor,
  resetHomeCategoryColorsForTests,
} from './use-home-category-colors';

const category: StatisticsGroup = {
  kind: 'CATEGORY',
  category: { id: 'groceries', name: '日用品', icon: null },
  amount: 100,
  percentageBps: 10_000,
};

const fixedGroup: StatisticsGroup = {
  kind: 'BAD_DEBT',
  category: null,
  amount: 100,
  percentageBps: 10_000,
};

const uncategorized: StatisticsGroup = {
  kind: 'UNCATEGORIZED',
  category: null,
  amount: 100,
  percentageBps: 10_000,
};

/** 驗證首頁分類配色 store 的讀寫與通知，以及呈色函式在各模式和主題下的結果。 */
describe('home category colors', () => {
  beforeEach(() => {
    localStorage.clear();
    resetHomeCategoryColorsForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to color when the preference is missing', () => {
    const store = createHomeCategoryColorStore();

    expect(store.getSnapshot()).toBe('color');
  });

  it('defaults to color when the stored preference is invalid', () => {
    localStorage.setItem(HOME_CATEGORY_COLORS_STORAGE_KEY, 'purple');
    const store = createHomeCategoryColorStore();

    expect(store.getSnapshot()).toBe('color');
  });

  it('defaults to color when localStorage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    const store = createHomeCategoryColorStore();

    expect(store.getSnapshot()).toBe('color');
  });

  it('notifies subscribers and keeps the new value when localStorage cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    const store = createHomeCategoryColorStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setMode('gold');

    expect(store.getSnapshot()).toBe('gold');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('updates both subscribers and removes a cancelled listener', () => {
    const store = createHomeCategoryColorStore();
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const unsubscribeFirst = store.subscribe(firstListener);
    store.subscribe(secondListener);

    expect(store.getSnapshot()).toBe(store.getSnapshot());
    store.setMode('gold');
    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    store.setMode('gray');

    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(2);
  });

  it('does not notify a listener after its subscription is cancelled', () => {
    const store = createHomeCategoryColorStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.setMode('gray');

    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    { mode: 'color' as const, theme: 'light' as const },
    { mode: 'color' as const, theme: 'dark' as const },
    { mode: 'gold' as const, theme: 'light' as const },
    { mode: 'gold' as const, theme: 'dark' as const },
    { mode: 'gray' as const, theme: 'light' as const },
    { mode: 'gray' as const, theme: 'dark' as const },
  ])('uses $mode mode with the $theme chart theme', ({ mode, theme }) => {
    const neutral = NEUTRAL_CHART_COLORS[theme];
    const expectedCategory =
      mode === 'color'
        ? getStatisticsGroupColor(category, theme)
        : mode === 'gold'
          ? 'var(--color-accent)'
          : neutral;

    expect(homeCategoryColor(category, mode, theme, true)).toBe(expectedCategory);
    expect(homeCategoryColor(fixedGroup, mode, theme, true)).toBe(neutral);
    expect(homeCategoryColor(uncategorized, mode, theme, true)).toBe(neutral);
  });

  it.each(['light', 'dark'] as const)(
    'keeps fixed groups and unclassified gray in gold mode (%s)',
    (theme) => {
      const neutral = NEUTRAL_CHART_COLORS[theme];

      expect(homeCategoryColor(fixedGroup, 'gold', theme, true)).toBe(neutral);
      expect(homeCategoryColor(uncategorized, 'gold', theme, true)).toBe(neutral);
      expect(homeCategoryColor(category, 'gold', theme, false)).toBe(neutral);
    },
  );

  it.each([
    { first: category, later: fixedGroup, goldFirst: true },
    { first: uncategorized, later: category, goldFirst: false },
    { first: fixedGroup, later: category, goldFirst: false },
  ])(
    'gives gold only to the first row when it is a regular category',
    ({ first, later, goldFirst }) => {
      expect(homeCategoryColor(first, 'gold', 'light', true)).toBe(
        goldFirst ? 'var(--color-accent)' : NEUTRAL_CHART_COLORS.light,
      );
      expect(homeCategoryColor(later, 'gold', 'light', false)).toBe(NEUTRAL_CHART_COLORS.light);
    },
  );
});
