import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

/**
 * 窄螢幕的浮動選單，接起來之後的行為（2f · D3）。
 *
 * 開闔的規則本身已經在 `use-disclosure.test.tsx` 測過，這裡測的是**接線**：
 * 頂列的 ☰ 真的控制得到側邊欄，以及點了導覽連結之後選單會收起來。
 *
 * 為什麼不模擬視窗寬度：側邊欄在寬窄螢幕是同一份 DOM，差別只在 CSS（D6），
 * 而 jsdom 不套用 CSS。這裡測的是「按鈕與面板的關聯」，那件事與寬度無關。
 */
describe('AppSidebar 的浮動選單', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    window.history.pushState({}, '', '/');
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );
  });

  function menuButton() {
    return screen.getByRole('button', { name: '主選單' });
  }

  it('points the trigger at the sidebar it controls', () => {
    render(<App />);

    // aria-controls 要指到真的存在的元素，否則螢幕閱讀器跟不過去。
    const controlledId = menuButton().getAttribute('aria-controls');
    expect(controlledId).toBeTruthy();
    expect(document.getElementById(controlledId as string)).toBeInTheDocument();
  });

  it('toggles open and closed from the top bar button', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');

    await user.click(menuButton());
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true');

    await user.click(menuButton());
    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes itself after the user follows a navigation link', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(menuButton());
    expect(menuButton()).toHaveAttribute('aria-expanded', 'true');

    // 頁面已經換了，選單還蓋在上面就是擋路的東西。
    await user.click(screen.getByRole('link', { name: '帳戶' }));

    expect(menuButton()).toHaveAttribute('aria-expanded', 'false');
    expect(await screen.findByRole('heading', { name: '帳戶' })).toBeInTheDocument();
  });

  it('hides the menu button from signed-out visitors', () => {
    localStorage.clear();

    render(<App />);

    expect(screen.queryByRole('button', { name: '主選單' })).not.toBeInTheDocument();
  });
});
