import { render, screen, within } from '@testing-library/react';
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

  /**
   * 「全站同一時間只有一組外觀控制項」——意圖不變，控制項的長相在 2i 變了：
   * 登入後這顆循環鈕收進使用者選單，改成**設定彈窗**裡的三張預覽卡（SC-32.2，
   * 第二輪修訂；第一輪是往右浮出的第二層）。所以選取步驟是「帳號選單 → 設定」，
   * 開出來的是 `dialog`，radio 在它裡面。訪客沒有側欄，頂列那顆循環鈕照舊。
   */
  it('keeps exactly one appearance control on the page in any state', async () => {
    // 訪客：切換鈕在頂列。
    const guest = render(<App />);
    expect(screen.getAllByRole('button', { name: /^外觀：/ })).toHaveLength(1);
    guest.unmount();

    // 登入後：頂列那顆不該渲染，外觀改由使用者選單裡的 radio 群組控制。
    const user = userEvent.setup();
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

    expect(screen.queryByRole('button', { name: /^外觀：/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '帳號選單' }));
    await user.click(screen.getByRole('button', { name: '設定' }));
    const settings = within(screen.getByRole('dialog', { name: '設定' }));
    expect(
      within(settings.getByRole('radiogroup', { name: '外觀' })).getAllByRole('radio'),
    ).toEqual([
      screen.getByRole('radio', { name: '跟隨系統' }),
      screen.getByRole('radio', { name: '淺色' }),
      screen.getByRole('radio', { name: '深色' }),
    ]);
  });
});
