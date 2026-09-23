import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import source from '../../public/theme-init.js?raw';
import { THEME_STORAGE_KEY } from './use-theme';

/**
 * `public/theme-init.js`：在 React 執行之前套好深淺色，防止載入時閃一下（SC-29.3）。
 *
 * 它是放在 public/ 的純 JS（CSP 禁止 inline script，只能是外部檔），不能被
 * import，所以這裡讀它的原始文字直接執行，驗四種 localStorage 狀態的結果。
 *
 * 另外比對它寫死的 key 與 `use-theme.ts` 的 THEME_STORAGE_KEY——兩邊不一致的話，
 * 切換鈕存得進去、重新整理卻讀不出來，症狀是「每次重新整理都變回預設」。
 */
function runInitScript(): void {
  // 這段就是要照原樣執行一個檔案的內容，跟瀏覽器載入它時一樣。來源是 repo 內的
  // 固定檔案，不是使用者輸入。
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function(source) as () => void;
  run();
}

describe('theme-init.js', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the same storage key as the React hook', () => {
    expect(source).toContain(`'${THEME_STORAGE_KEY}'`);
  });

  it.each(['light', 'dark'])('applies a saved "%s" choice before the app runs', (theme) => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);

    runInitScript();

    expect(document.documentElement).toHaveAttribute('data-theme', theme);
  });

  it('leaves the attribute off when nothing was chosen, so the system setting applies', () => {
    runInitScript();

    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('ignores values it does not recognize', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'purple');

    runInitScript();

    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('does not throw when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(runInitScript).not.toThrow();
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });
});
