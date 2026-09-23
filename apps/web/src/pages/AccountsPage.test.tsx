import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

/**
 * 帳戶頁的版面（spec 2i SC-38.3、SC-38.5）。
 *
 * 帳戶頁本身的流程（新增、改名、刪除、錯誤路徑）由
 * `features/accounts/accounts.test.tsx` 負責，這一檔只驗「＋ 新增帳戶」搬到橫條
 * 之後**位置變了、行為沒變**：無障礙名稱一樣、`aria-expanded` 一樣。第三輪起
 * 表單從右側欄滑出（SC-42），不再往下展開。
 *
 * 橫條的內容是 portal 進外殼的，第一次 render 可能晚一拍，所以用 `findBy*`。
 */
describe('Accounts page toolbar', () => {
  const fetchMock = vi.fn();

  const cash = { id: 'acc-1', name: '現金', initialBalance: 0, balance: 3800 };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    window.history.pushState({}, '', '/accounts');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        new Response(JSON.stringify(String(url).includes('/accounts') ? [cash] : []), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const WAIT = { timeout: 5000 };

  /**
   * 「在橫條裡」的判準，刻意不看 CSS 類名：橫條在中間區的最上方、頁面標題列之外，
   * 所以它裡面的東西一定不在 `<header>` 裡，而且在 DOM 順序上排在標題之前。
   */
  function expectInToolbar(element: HTMLElement, heading: HTMLElement) {
    expect(element.closest('header')).toBeNull();
    expect(element.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  }

  it('puts 新增帳戶 in the toolbar instead of next to the title', async () => {
    render(<App />);

    const button = await screen.findByRole('button', { name: '新增帳戶' }, WAIT);
    expectInToolbar(button, screen.getByRole('heading', { name: '帳戶' }));
  });

  it('keeps the description under the title and nothing above it', async () => {
    render(<App />);

    const heading = await screen.findByRole('heading', { name: '帳戶' }, WAIT);
    const header = heading.closest('header');
    // 標題上方沒有任何一行字（SC-38.5）；說明仍然留在標題下方。
    expect(header?.firstElementChild).toBe(heading);
    expect(header).toHaveTextContent('餘額由伺服器依交易即時計算');
  });

  it('opens the form in the right panel and still reports aria-expanded', async () => {
    const user = userEvent.setup();
    render(<App />);

    const button = await screen.findByRole('button', { name: '新增帳戶' }, WAIT);
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    const form = await screen.findByRole('dialog', { name: '新增帳戶' }, WAIT);
    // SC-42：表單搬到右側欄，不再展開在標題下方。右側欄是 <main> 的兄弟，
    // 所以「不在 main 裡」就是「在右側欄」，這個判準不依賴 CSS 類名。
    expect(form.closest('main')).toBeNull();
  });
});
