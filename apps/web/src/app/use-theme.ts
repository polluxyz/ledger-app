import { useCallback, useState } from 'react';

/**
 * 深淺色偏好（phase-2h D19、SC-29）。
 *
 * - `system`：跟隨作業系統。這是預設，也是「沒選過」的狀態。
 * - `light` / `dark`：使用者用切換鈕選過。
 *
 * **畫面顏色的唯一來源是 `<html data-theme>`**，不是這個 hook 的 state。CSS 只看
 * 那個屬性與 `prefers-color-scheme`（見 `styles/global.css` 檔頭）。這個 hook 做的是
 * 「記住選擇並同步到屬性上」；頁面載入時的第一次同步由 `public/theme-init.js` 負責。
 */
export type ThemePreference = 'system' | 'light' | 'dark';

/** ⚠️ `public/theme-init.js` 裡寫死了同一個字串，由 `theme-init.test.ts` 比對。 */
export const THEME_STORAGE_KEY = 'ledger.theme';

/** 切換鈕按一下換下一個，依這個順序循環。 */
export const THEME_ORDER: readonly ThemePreference[] = ['system', 'light', 'dark'];

function isPreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** 讀不到或值不認得一律當 `system`，不拋錯（隱私模式下 localStorage 會拋）。 */
export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/**
 * 把偏好套到 `<html>` 上。`system` 時**移除**屬性而不是設成 system——
 * CSS 就只需要處理 light、dark、沒有屬性三種情況。
 */
function applyToDocument(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', preference);
  }
}

function persist(preference: ThemePreference): void {
  try {
    if (preference === 'system') {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // 存不了就只在這次瀏覽有效，畫面照樣切換。外觀偏好不值得為此報錯。
  }
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);

  const choose = useCallback((next: ThemePreference) => {
    setPreference(next);
    persist(next);
    applyToDocument(next);
  }, []);

  /** 換到 THEME_ORDER 的下一個。 */
  const cycle = useCallback(() => {
    const index = THEME_ORDER.indexOf(preference);
    choose(THEME_ORDER[(index + 1) % THEME_ORDER.length]!);
  }, [preference, choose]);

  return { preference, choose, cycle };
}
