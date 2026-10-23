import { describe, expect, it } from 'vitest';
import {
  CATEGORY_CHART_COLORS,
  getChartColorForId,
  getStatisticsGroupColor,
  NEUTRAL_CHART_COLORS,
} from './chart-colors';

/** 驗證分類色彩固定跟著 id，固定分組使用符合主題的中性灰。 */
describe('statistics chart colors', () => {
  it('assigns the same category color regardless of ordering or theme lookup order', () => {
    const ids = ['category-food', 'category-drink', 'category-rent'];
    const forwardColors = new Map(ids.map((id) => [id, getChartColorForId(id, 'dark')]));
    const reverseColors = new Map(
      [...ids].reverse().map((id) => [id, getChartColorForId(id, 'dark')]),
    );

    expect(reverseColors).toEqual(forwardColors);
    expect(forwardColors.get('category-food')).toBe(getChartColorForId('category-food', 'dark'));
    expect(CATEGORY_CHART_COLORS.dark).toContain(forwardColors.get('category-food'));
    expect(CATEGORY_CHART_COLORS.light).toContain(getChartColorForId('category-food', 'light'));
  });

  it('uses neutral gray for fixed groups', () => {
    const group = {
      kind: 'UNCATEGORIZED' as const,
      category: null,
      amount: 100,
      percentageBps: 10000,
    };
    expect(getStatisticsGroupColor(group, 'dark')).toBe(NEUTRAL_CHART_COLORS.dark);
    expect(getStatisticsGroupColor(group, 'light')).toBe(NEUTRAL_CHART_COLORS.light);
  });
});
