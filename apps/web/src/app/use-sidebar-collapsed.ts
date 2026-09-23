import { useCallback, useState } from 'react';

/**
 * 側欄收合偏好（phase-2h D11、SC-24.2）。
 *
 * 純外觀偏好，不是機敏資訊，放 `localStorage` 沒有安全疑慮（對照 token 的
 * 處理見 `lib/token-storage.ts` 的安全取捨說明）。讀寫都包 `try`——
 * 隱私模式或被套件封鎖時 localStorage 會直接拋錯，收合狀態不值得為此打斷任何人，
 * 失敗一律當成「未收合」。
 *
 * 與斷點的關係：這個 hook 只記「使用者想不想收合」，只在 ≥ 1200px 生效；
 * 900–1199px 一律收合、< 900px 一律展開，那兩條由 CSS 決定（D10：斷點只存在 CSS）。
 */
const SIDEBAR_COLLAPSED_KEY = 'ledger.sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  const setCollapsedAndPersist = useCallback((next: boolean) => {
    setCollapsed(next);
    try {
      if (next) {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true');
      } else {
        // 展開時把鍵清掉，而不是存 'false'——「沒有值」就是預設狀態，
        // 之後若想改預設行為不必遷移舊資料。
        localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
      }
    } catch {
      // 存不了就只在這次瀏覽有效，畫面照樣收合。
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsedAndPersist(!collapsed);
  }, [collapsed, setCollapsedAndPersist]);

  return { collapsed, toggle };
}
