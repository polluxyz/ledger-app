import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

/**
 * 側欄底部的使用者選單（2i · SC-32、D24）。
 *
 * 驗的是**選單這個控制項**：開關與 `aria-expanded`、鍵盤能不能走完全程、
 * Esc 有沒有把焦點送回觸發鈕、「設定」有沒有把選單換成設定彈窗。位置（fixed 的
 * 座標）是 CSS 與版面的事，jsdom 量不到，交給 e2e 的 SC-32.4。
 *
 * 第二輪修訂把「外觀」從往右浮出的第二層改成彈窗，所以彈窗**裡面**的行為
 * （三張預覽卡、方向鍵、Esc）搬到 `SettingsDialog.test.tsx`；這裡只留接線：
 * 點下去選單關了、彈窗開了、關掉之後焦點回得來。
 *
 * **這是揭露式面板，不是 ARIA menu**，所以每一項都用它原本的角色去找：
 * 「設定」是 button、「個人資料」是 link、「登出」是 button。
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

  /** 浮出的選單。關著的時候是 null——`aria-controls` 指的元素不存在。 */
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

  /**
   * 「設定」開的是彈窗不是第二層，所以標的是 `aria-haspopup="dialog"`，
   * 而不是 2i 第一輪的 `aria-expanded`——兩者對螢幕閱讀器的意思不一樣。
   */
  it('announces the settings item as opening a dialog', async () => {
    const actor = userEvent.setup();
    render(<App />);
    await openMenu(actor);

    const settings = screen.getByRole('button', { name: '設定' });
    expect(settings).toHaveAttribute('aria-haspopup', 'dialog');
    expect(settings).not.toHaveAttribute('aria-expanded');
  });

  it('swaps the menu for the settings dialog (SC-32.2)', async () => {
    const actor = userEvent.setup();
    render(<App />);
    await openMenu(actor);

    await actor.click(screen.getByRole('button', { name: '設定' }));

    // 彈窗開了，選單同時關了：使用者一次只看到一個浮動層。
    expect(screen.getByRole('dialog', { name: '設定' })).toBeInTheDocument();
    expect(menuPanel()).toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(
      within(screen.getByRole('radiogroup', { name: '外觀' })).getAllByRole('radio'),
    ).toHaveLength(3);
  });

  /**
   * 關掉彈窗後焦點回到**觸發鈕**（SC-32.3）。不是回到「設定」：那顆按鈕在彈窗
   * 打開的同時就隨選單一起消失了，原生 `<dialog>` 的焦點回歸救不了它。
   */
  it('returns the focus to the trigger after the dialog closes', async () => {
    const actor = userEvent.setup();
    render(<App />);
    await openMenu(actor);
    await actor.click(screen.getByRole('button', { name: '設定' }));

    const dialog = within(screen.getByRole('dialog', { name: '設定' }));
    await actor.click(dialog.getByRole('button', { name: '關閉' }));

    expect(screen.queryByRole('dialog', { name: '設定' })).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it('moves focus with the arrow keys', async () => {
    const actor = userEvent.setup();
    render(<App />);
    await openMenu(actor);

    // 開啟時焦點就在第一項。
    expect(screen.getByRole('button', { name: '設定' })).toHaveFocus();

    await actor.keyboard('{ArrowDown}');
    expect(screen.getByRole('link', { name: '個人資料' })).toHaveFocus();

    await actor.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: '登出' })).toHaveFocus();

    // 走到頭再按會回到另一端，不會卡住。
    await actor.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: '設定' })).toHaveFocus();

    await actor.keyboard('{ArrowUp}');
    expect(screen.getByRole('button', { name: '登出' })).toHaveFocus();
  });

  it('closes with Escape and returns the focus to the trigger', async () => {
    const actor = userEvent.setup();
    render(<App />);
    await openMenu(actor);

    await actor.keyboard('{Escape}');

    // 焦點回到觸發鈕，鍵盤使用者不會迷路。
    expect(menuPanel()).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('closes when the user points outside', async () => {
    const actor = userEvent.setup();
    render(<App />);
    await openMenu(actor);

    await actor.click(document.body);

    expect(menuPanel()).toBeNull();
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
