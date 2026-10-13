import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

/**
 * 帳戶頁的版面（spec 2i SC-38.5、開發者 2026-10-07 修訂）。
 *
 * 帳戶頁本身的流程（新增、改名、刪除、錯誤路徑）由
 * `features/accounts/accounts.test.tsx` 負責，這一檔只驗「＋ 新增帳戶」從最上排
 * 橫條回到頁面內容之後**位置變了、行為沒變**：無障礙名稱一樣、`aria-expanded`
 * 一樣。表單從右側欄滑出（SC-42），不往下展開。
 */
describe('Accounts page header actions', () => {
  const fetchMock = vi.fn();

  const cash = { id: 'acc-1', name: '現金', initialBalance: 0, balance: 380000 };

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
   * 「在標題那一排」的判準，刻意不看 CSS 類名：按鈕在頁首的 `<header>` 裡、
   * 標題後面，就是「標題同一排右邊」。
   */
  function expectBesideTitle(element: HTMLElement, heading: HTMLElement) {
    const header = heading.closest('header');
    expect(element.closest('header')).toBe(header);
    expect(heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  }

  it('puts 新增帳戶 on the title row of the page content', async () => {
    render(<App />);

    const button = await screen.findByRole('button', { name: '新增帳戶' }, WAIT);
    expectBesideTitle(button, screen.getByRole('heading', { name: '帳戶' }));
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
