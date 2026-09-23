import { useCallback, useState } from 'react';

/**
 * 動畫開關（spec 2i SC-39，第三輪修訂）。
 *
 * **完全由使用者決定，不看作業系統的「減少動態效果」**——開發者的明確決定：
 * Windows 關了「動畫效果」的人不一定想讓這個網站也沒有動畫，而真的需要的人
 * 在設定彈窗裡就能關掉。
 *
 * 做法與深淺色相同：畫面的唯一來源是 `<html data-motion>`。關閉時設成 `off`，
 * `styles/global.css` 把所有動畫時間 token 變成 0；開啟時**移除**屬性。
 * 頁面載入時的第一次同步由 `public/theme-init.js` 負責。
 */

/** ⚠️ `public/theme-init.js` 裡寫死了同一個字串，由 `theme-init.test.ts` 比對。 */
export const MOTION_STORAGE_KEY = 'ledger.motion';

/** 讀不到（隱私模式下 localStorage 會拋錯）或沒存過一律當「開」。 */
export function readMotionEnabled(): boolean {
  try {
    return localStorage.getItem(MOTION_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/**
 * 目前畫面上的動畫是不是開著。給需要在 JS 裡判斷的元件用（例如等不等
 * `transitionend`），它們應該跟 CSS 看同一個來源，所以讀屬性而不是 localStorage。
 */
export function isMotionEnabled(): boolean {
  return document.documentElement.getAttribute('data-motion') !== 'off';
}

function applyToDocument(enabled: boolean): void {
  if (enabled) {
    document.documentElement.removeAttribute('data-motion');
  } else {
    document.documentElement.setAttribute('data-motion', 'off');
  }
}

export function useMotion() {
  const [enabled, setEnabledState] = useState(readMotionEnabled);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    applyToDocument(next);
    try {
      if (next) {
        // 預設狀態就是「沒有值」，與側欄收合、深淺色同一個慣例。
        localStorage.removeItem(MOTION_STORAGE_KEY);
      } else {
        localStorage.setItem(MOTION_STORAGE_KEY, 'off');
      }
    } catch {
      // 存不了就只在這次瀏覽有效，畫面照樣切換。
    }
  }, []);

  return { enabled, setEnabled };
}
