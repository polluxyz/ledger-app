import { useSyncExternalStore } from 'react';
import type { StatisticsGroup } from '@ledger/shared';
import {
  getStatisticsGroupColor,
  NEUTRAL_CHART_COLORS,
  type ChartTheme,
} from '../features/statistics/charts/chart-colors';

/**
 * 首頁分類條配色只儲存在目前瀏覽器；模組層級的 store 讓設定彈窗與首頁即時共用偏好。
 * localStorage 無法讀寫時，這次瀏覽仍能使用記憶體中的選擇。
 */
export type HomeCategoryColorMode = 'color' | 'gold' | 'gray';

export const HOME_CATEGORY_COLORS_STORAGE_KEY = 'ledger.homeCategoryColors';

type HomeCategoryColorStorage = Pick<Storage, 'getItem' | 'setItem'>;

function isHomeCategoryColorMode(value: string | null): value is HomeCategoryColorMode {
  return value === 'color' || value === 'gold' || value === 'gray';
}

/** 建立可獨立測試的 store；沒有提供儲存介面時使用瀏覽器的 localStorage。 */
export function createHomeCategoryColorStore(storage?: HomeCategoryColorStorage) {
  const read = (): HomeCategoryColorMode => {
    try {
      const value = (storage ?? localStorage).getItem(HOME_CATEGORY_COLORS_STORAGE_KEY);
      return isHomeCategoryColorMode(value) ? value : 'color';
    } catch {
      return 'color';
    }
  };

  let snapshot = read();
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setMode: (mode: HomeCategoryColorMode) => {
      snapshot = mode;
      try {
        (storage ?? localStorage).setItem(HOME_CATEGORY_COLORS_STORAGE_KEY, mode);
      } catch {
        // 偏好存不了時仍保留本次瀏覽的選擇，並通知畫面更新。
      }
      listeners.forEach((listener) => listener());
    },
    resetForTests: () => {
      snapshot = read();
      listeners.clear();
    },
  };
}

const homeCategoryColorStore = createHomeCategoryColorStore();

/** 測試前清除舊訂閱並依目前 localStorage 重設模組 store。 */
export function resetHomeCategoryColorsForTests(): void {
  homeCategoryColorStore.resetForTests();
}

/** 設定彈窗與首頁都訂閱這份狀態，不用 provider 或跨分頁 storage 事件。 */
export function useHomeCategoryColors() {
  const mode = useSyncExternalStore(
    homeCategoryColorStore.subscribe,
    homeCategoryColorStore.getSnapshot,
    () => 'color',
  );
  return { mode, choose: homeCategoryColorStore.setMode };
}

/** 首頁分類段依偏好呈色；固定分組與未分類仍沿用統計圖的中性灰。 */
export function homeCategoryColor(
  group: StatisticsGroup,
  mode: HomeCategoryColorMode,
  chartTheme: ChartTheme,
): string {
  if (mode === 'color') {
    return getStatisticsGroupColor(group, chartTheme);
  }
  if (mode === 'gold' && group.kind === 'CATEGORY' && group.category !== null) {
    return 'var(--color-accent)';
  }
  return NEUTRAL_CHART_COLORS[chartTheme];
}
