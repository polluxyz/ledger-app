import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

/**
 * 側欄底部的使用者選單（2i · SC-32、D24）。
 *
 * 驗的是**選單這個控制項**：兩層的開關與 `aria-expanded`、鍵盤能不能走完全程、
 * Esc 有沒有把焦點送回開啟它的項目、選了外觀會不會真的換主題。位置（fixed 的
 * 座標）是 CSS 與版面的事，jsdom 量不到，交給 e2e 的 SC-32.4。
 *
 * **這是揭露式面板，不是 ARIA menu**，所以每一項都用它原本的角色去找：
 * 「設定」是 button、「個人資料」是 link、「登出」是 button、外觀是三顆 radio。
 * 「登出」維持 button 這件事本身就是契約——既有 e2e 與單元測試都這樣定位它。
 *
 * 一律透過 `<App />` 渲染：選單同時要 AuthProvider、react-query 與 Router，
 * 單獨掛它得自己重建三層 Provider，測到的反而不是真正跑在畫面上的那一份。
 */
describe('UserMenu', () => {
  const user = { id: 'u1', email: 'alice@example.com', name: '王小明' };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    document.documentElement.removeAttribute('data-theme');
    window.history.pushState({}, '', '/');
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const body = String(url).includes('/users/me') ? user : [];
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }),
    );
  });

  /** 觸發鈕。名字取回來之前是「帳號選單」，取回來之後才變成「〈名字〉的選單」。 */
  function trigger() {
    return screen.getByRole('button', { name: '王小明的選單' });
  }

  /** 浮出的第一層。關著的時候是 null——`aria-controls` 指的元素不存在。 */
  function menuPanel(): HTMLElement | null {
    const id = trigger().getAttribute('aria-controls');
    return id ? document.getElementById(id) : null;
  }

  async function openMenu(actor: ReturnType<typeof userEvent.setup>) {
    await actor.click(await screen.findByRole('button', { name: '王小明的選單' }));
  }

  it('names the trigger after the signed-in user and toggles the panel', async () => {
    const actor = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole('button', { name: '王小明的選單' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    await openMenu(actor);
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(menuPanel()).toBeInTheDocument();

    await actor.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(menuPanel()).toBeNull();
  });

  it('offers settings, profile, and sign out', async () => {
    const actor = userEvent.setup();
    render(<App />);
    await openMenu(actor);

    const panel = within(menuPanel() as HTMLElement);
    expect(panel.getByRole('button', { name: '設定' })).toBeInTheDocument();
    expect(panel.getByRole('link', { name: '個人資料' })).toHaveAttribute('href', '/profile');
    // 登出必須維持原生 button 且名稱不變，既有測試與 e2e 都靠這一條定位它。
    expect(panel.getByRole('button', { name: '登出' })).toBeInTheDocument();
  });

  it('opens the appearance group with three radio options', async () => {
    const actor = userEvent.setup();
    render(<App />);
    await openMenu(actor);

    const settings = screen.getByRole('button', { name: '設定' });
    await actor.click(settings);

    expect(settings).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('radiogroup', { name: '外觀' });
    expect(within(group).getAllByRole('radio')).toHaveLength(3);

    // 預設是「跟隨系統」，其餘兩個沒被選。
    expect(screen.getByRole('radio', { name: '跟隨系統' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '淺色' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: '深色' })).not.toBeChecked();
  });

  it('applies and remembers the chosen appearance', async () => {
    const actor = userEvent.setup();
    render(<App />);
    await openMenu(actor);
    await actor.click(screen.getByRole('button', { name: '設定' }));

    await actor.click(screen.getByRole('radio', { name: '淺色' }));

    // 畫面顏色的唯一來源是 `<html data-theme>`，不是 React state（2h D19）。
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem('ledger.theme')).toBe('light');
    expect(screen.getByRole('radio', { name: '淺色' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '跟隨系統' })).not.toBeChecked();
  });

  it('moves focus with the arrow keys and opens the second layer with ArrowRight', async () => {
    const actor = userEvent.setup();
    render(<App />);
    await openMenu(actor);

    // 開啟時焦點就在第一項。
    expect(screen.getByRole('button', { name: '設定' })).toHaveFocus();

    await actor.keyboard('{ArrowDown}');
    expect(screen.getByRole('link', { name: '個人資料' })).toHaveFocus();

    await actor.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: '登出' })).toHaveFocus();

    await actor.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('button', { name: '設定' })).toHaveFocus();

    // → 打開第二層，焦點落在**目前選中**的那顆 radio。
    await actor.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: '跟隨系統' })).toHaveFocus();
  });

  it('closes one layer at a time with Escape and returns the focus each time', async () => {
    const actor = userEvent.setup();
    render(<App />);
    await openMenu(actor);
    await actor.keyboard('{ArrowRight}');

    // 第一次 Esc：只關第二層，焦點回到開啟它的「設定」。
    await actor.keyboard('{Escape}');
    expect(screen.queryByRole('radiogroup', { name: '外觀' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '設定' })).toHaveFocus();

    // 第二次 Esc：關掉整個選單，焦點回到觸發鈕，鍵盤使用者不會迷路。
    await actor.keyboard('{Escape}');
    expect(menuPanel()).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('closes the second layer with ArrowLeft', async () => {
    const actor = userEvent.setup();
    render(<App />);
    await openMenu(actor);
    await actor.keyboard('{ArrowRight}');

    await actor.keyboard('{ArrowLeft}');

    expect(screen.queryByRole('radiogroup', { name: '外觀' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '設定' })).toHaveFocus();
  });

  it('closes every layer when the user points outside', async () => {
    const actor = userEvent.setup();
    render(<App />);
    await openMenu(actor);
    await actor.click(screen.getByRole('button', { name: '設定' }));

    await actor.click(document.body);

    expect(screen.queryByRole('radiogroup', { name: '外觀' })).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  /**
   * `/users/me` 失敗時仍然要有這顆按鈕——登出在裡面，按鈕不見就等於登不出去。
   */
  it('still offers the menu when the user name cannot be loaded', async () => {
    const actor = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    render(<App />);

    await actor.click(await screen.findByRole('button', { name: '帳號選單' }));

    expect(screen.getByRole('button', { name: '登出' })).toBeInTheDocument();
  });
});
