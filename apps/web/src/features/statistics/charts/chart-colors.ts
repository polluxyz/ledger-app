import type { Category, CategoryType, StatisticsGroup } from '@ledger/shared';

/** 分類配色依帳本分類順序決定，固定分組使用中性灰。 */
export type ChartTheme = 'light' | 'dark';

export const CATEGORY_CHART_COLORS: Record<ChartTheme, readonly string[]> = {
  dark: [
    '#3987e5',
    '#d95926',
    '#199e70',
    '#c98500',
    '#d55181',
    '#9085e9',
    '#35c8de',
    '#f77d72',
    '#b2c54c',
    '#c26cde',
    '#b58365',
    '#779bb1',
  ],
  light: [
    '#2a78d6',
    '#eb6834',
    '#189f6f',
    '#be8200',
    '#d97299',
    '#6250d6',
    '#00869c',
    '#c92d3f',
    '#697d00',
    '#872d9e',
    '#815332',
    '#425975',
  ],
};

export const NEUTRAL_CHART_COLORS: Record<ChartTheme, string> = {
  dark: '#9d9482',
  light: '#6a6252',
};

const ID_CHART_COLORS: Record<ChartTheme, readonly string[]> = {
  dark: CATEGORY_CHART_COLORS.dark.slice(0, 6),
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6'],
};

/** 成員圖表與設定示意色沿用原本的色盤與雜湊。 */
export function getChartColorForId(id: string, theme: ChartTheme = 'dark'): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x01000193);
  }
  const palette = ID_CHART_COLORS[theme];
  return palette[(hash >>> 0) % palette.length] ?? NEUTRAL_CHART_COLORS[theme];
}

type ColorCategory = Pick<Category, 'id' | 'type' | 'sortOrder'>;

function groupCategoryId(group: StatisticsGroup): string | undefined {
  return group.kind === 'CATEGORY' ? group.category?.id : undefined;
}

/** 依完整分類清單分配色槽，再依畫面順序處理撞色。清單未載入時使用中性灰。 */
export function createCategoryGroupColor(
  categories: readonly ColorCategory[] | undefined,
  type: CategoryType,
  groups: readonly StatisticsGroup[],
  theme: ChartTheme,
): (group: StatisticsGroup) => string {
  const palette = CATEGORY_CHART_COLORS[theme];
  const ordered = (categories ?? [])
    .filter((category) => category.type === type)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const baseColors = new Map(
    ordered.map((category, index) => [category.id, palette[index % palette.length]!]),
  );
  const assignedColors = new Map<string, string>();
  const usedColors = new Set<string>();

  for (const group of groups) {
    const id = groupCategoryId(group);
    if (id === undefined || assignedColors.has(id)) continue;
    const baseColor = baseColors.get(id);
    if (baseColor === undefined) continue;
    // 撞色時用色盤第一個空槽。色盤用完後，回到分類原本的色槽。
    const color = usedColors.has(baseColor)
      ? (palette.find((candidate) => !usedColors.has(candidate)) ?? baseColor)
      : baseColor;
    assignedColors.set(id, color);
    usedColors.add(color);
  }

  return (group) => {
    const id = groupCategoryId(group);
    return (id === undefined ? undefined : assignedColors.get(id)) ?? NEUTRAL_CHART_COLORS[theme];
  };
}
