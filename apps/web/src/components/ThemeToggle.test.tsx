import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { ThemeToggle } from './ThemeToggle';

/**
 * 深淺切換鈕（phase-2h SC-29.1）。
 *
 * 驗三件事：循環順序「跟隨系統 → 淺色 → 深色 → 跟隨系統」、`<html data-theme>`
 * 跟著狀態同步（畫面顏色的唯一來源是那個屬性，不是 React state）、以及任何
 * 狀態下整頁只有這一顆（訪客頂列與側欄各一顆，但兩者不會同時渲染）。
 * 顏色本身由 CSS token 決定，不在這裡驗。
 */
describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  function toggleButton() {
    return screen.getByRole('button', { name: /^外觀：/ });
  }

  it('cycles system → light → dark → system and syncs data-theme', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    expect(toggleButton()).toHaveAccessibleName('外觀：跟隨系統');

    await user.click(toggleButton());
    expect(toggleButton()).toHaveAccessibleName('外觀：淺色');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');

    await user.click(toggleButton());
    expect(toggleButton()).toHaveAccessibleName('外觀：深色');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');

    // 回到跟隨系統：屬性是「移除」而不是設成 system（D19），CSS 只認三種情況。
    await user.click(toggleButton());
    expect(toggleButton()).toHaveAccessibleName('外觀：跟隨系統');
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('keeps exactly one toggle on the page in any state', () => {
    // 訪客：切換鈕在頂列。
    const guest = render(<App />);
    expect(screen.getAllByRole('button', { name: /^外觀：/ })).toHaveLength(1);
    guest.unmount();

    // 登入後：切換鈕在側欄，頂列那顆不該跟著渲染出來。
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
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
    render(<App />);

    expect(screen.getAllByRole('button', { name: /^外觀：/ })).toHaveLength(1);
  });
});
