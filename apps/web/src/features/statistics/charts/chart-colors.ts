import type { StatisticsGroup } from '@ledger/shared';

/** 統計圖固定使用依分類 id 決定的色盤；固定分組與缺少分類 id 時使用中性灰。 */
export type ChartTheme = 'light' | 'dark';

export const CATEGORY_CHART_COLORS: Record<ChartTheme, readonly string[]> = {
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'],
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6'],
};

export const NEUTRAL_CHART_COLORS: Record<ChartTheme, string> = {
  dark: '#9d9482',
  light: '#6a6252',
};

/** 相同 id 永遠落在同一個色盤位置，不受列表順序或排名影響。 */
export function getChartColorForId(id: string, theme: ChartTheme = 'dark'): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x01000193);
  }
  const color = CATEGORY_CHART_COLORS[theme][(hash >>> 0) % CATEGORY_CHART_COLORS[theme].length];
  return color ?? NEUTRAL_CHART_COLORS[theme];
}

/** 固定分組沒有分類 id，必須使用中性灰，避免看起來像一般分類。 */
export function getStatisticsGroupColor(
  group: StatisticsGroup,
  theme: ChartTheme = 'dark',
): string {
  if (group.kind !== 'CATEGORY' || group.category === null) {
    return NEUTRAL_CHART_COLORS[theme];
  }
  return getChartColorForId(group.category.id, theme);
}
