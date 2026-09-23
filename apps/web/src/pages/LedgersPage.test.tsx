import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

/**
 * 帳本頁的版面（spec 2i SC-38.3、SC-38.5）。
 *
 * 建立帳本的流程由 `features/ledgers/ledgers.test.tsx` 負責，這一檔只驗
 * 「建立帳本」搬到橫條之後位置變了、行為沒變，以及第三輪的兩件事：按鈕前面有
 * 「＋」（SC-41），表單從右側欄滑出（SC-42）。管理頁沒有帳本切換器（SC-33.4），
 * 一併釘住。
 *
 * 右側欄的內容是 portal 進外殼的，第一次 render 可能晚一拍，所以用 `findBy*`。
 */
describe('Ledgers page toolbar', () => {
  const fetchMock = vi.fn();

  const personal = {
    id: 'led-1',
    name: '個人帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    tracksBalance: true,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    role: 'OWNER',
  };
  const shared = { ...personal, id: 'led-2', name: '家庭帳本', kind: 'SHARED' };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    window.history.pushState({}, '', '/ledgers');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        new Response(JSON.stringify(String(url).includes('/ledgers') ? [personal, shared] : []), {
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

  it('puts 建立帳本 in the toolbar instead of next to the title', async () => {
    render(<App />);

    const button = await screen.findByRole('button', { name: '建立帳本' }, WAIT);
    const heading = screen.getByRole('heading', { name: '帳本' });

    // 橫條在標題列之外、也在它前面（判準不依賴 CSS 類名）。
    expect(button.closest('header')).toBeNull();
    expect(button.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(heading.closest('header')?.firstElementChild).toBe(heading);
  });

  it('leaves the ledger switcher out of a management page', async () => {
    render(<App />);

    await screen.findByRole('button', { name: '建立帳本' }, WAIT);
    // SC-33.4：管理頁沒有帳本切換器，即使有兩本帳本可以切。
    expect(screen.queryByLabelText('作用中帳本')).not.toBeInTheDocument();
  });

  it('puts a plus icon before 建立帳本', async () => {
    render(<App />);

    // SC-41：與「＋ 新增帳戶」「＋ 新增交易」一致。圖示是裝飾，所以名稱不變，
    // 只能從 DOM 看它在文字前面。
    const button = await screen.findByRole('button', { name: '建立帳本' }, WAIT);
    const icon = button.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(button.firstElementChild).toBe(icon);
  });

  it('opens the create form in the right panel, not inside the page content', async () => {
    const user = userEvent.setup();
    render(<App />);

    const button = await screen.findByRole('button', { name: '建立帳本' }, WAIT);
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    const form = await screen.findByRole('dialog', { name: '建立帳本' }, WAIT);
    // SC-42：表單搬到右側欄，不再往下擠開清單。右側欄是 <main> 的兄弟，
    // 所以「不在 main 裡」就是「在右側欄」，這個判準不依賴 CSS 類名。
    expect(form.closest('main')).toBeNull();
  });

  it('closes the right panel and hands focus back on Escape', async () => {
    const user = userEvent.setup();
    render(<App />);

    const button = await screen.findByRole('button', { name: '建立帳本' }, WAIT);
    await user.click(button);
    await screen.findByRole('dialog', { name: '建立帳本' }, WAIT);

    await user.keyboard('{Escape}');

    // SC-42.4：收起之後焦點要回到按鈕——少了這一步，鍵盤使用者得從頁面最上面
    // 重新 Tab 一次。
    expect(screen.queryByRole('dialog', { name: '建立帳本' })).not.toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });
});
