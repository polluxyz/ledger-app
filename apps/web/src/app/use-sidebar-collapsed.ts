import { useCallback, useEffect, useState } from 'react';

/**
 * 側欄收合偏好（phase-2h D11、SC-24.2）。
 *
 * 純外觀偏好，不是機敏資訊，放 `localStorage` 沒有安全疑慮（對照 token 的
 * 處理見 `lib/token-storage.ts` 的安全取捨說明）。讀寫都包 `try`——
 * 隱私模式或被套件封鎖時 localStorage 會直接拋錯，收合狀態不值得為此打斷任何人，
 * 失敗一律當成「未收合」。
 *
 * 與斷點的關係：這個 hook 只記「使用者想不想收合」，**只在 ≥ 1200px 生效**；
 * 901–1199px 的展開是暫時的、不記憶（2i D27，見本檔的 `useSidebarFloatingRange`），
 * ≤ 900px 是 ☰ 浮動選單，收合沒有意義。
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

/**
 * 「現在是不是 901–1199px」（2i D27、SC-31.6）。
 *
 * 斷點原則上只寫在 CSS（2h D10），這裡是**唯一的例外**：那個區間的展開是
 * 「浮在內容上、不推擠中間區、不寫進 localStorage」，行為與 ≥ 1200px 不同，
 * 元件得知道自己在哪一段才知道按鈕該做哪件事。CSS 判斷不了「該存不該存」。
 *
 * jsdom 沒有 `matchMedia`，一律回 false（＝當成 ≥ 1200px），所以單元測試
 * 拿到的是「推擠 ＋ 記憶」那一套；要測浮動展開就自己 stub 一個 `matchMedia`。
 */
const FLOATING_RANGE_QUERY = '(min-width: 901px) and (max-width: 1199px)';

function matchFloatingRange(): boolean {
  try {
    return (
      typeof window.matchMedia === 'function' && window.matchMedia(FLOATING_RANGE_QUERY).matches
    );
  } catch {
    return false;
  }
}

export function useSidebarFloatingRange(): boolean {
  const [inRange, setInRange] = useState(matchFloatingRange);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const query = window.matchMedia(FLOATING_RANGE_QUERY);
    const sync = () => setInRange(query.matches);
    // 掛上監聽之前先同步一次：第一次 render 到 effect 之間視窗可能已經被拉過。
    sync();
    // 舊版 Safari 只有 addListener；沒有任何一種就只當成單次量測。
    if (typeof query.addEventListener !== 'function') {
      return;
    }
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return inRange;
}
