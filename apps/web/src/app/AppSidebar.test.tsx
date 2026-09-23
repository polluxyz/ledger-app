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

  /**
   * Slice 4 新增了「分類」與「個人資料」兩個連結。釘住它們的存在與去向：
   * 導覽連結的文字同時是 e2e 的選取器，改字就是改契約。
   */
  it('links to the categories and profile pages', () => {
    render(<App />);

    // 分類連結刻意不帶 `?ledgerId=`——從導覽進去就是看作用中帳本那一本。
    expect(screen.getByRole('link', { name: '分類' })).toHaveAttribute('href', '/categories');
    expect(screen.getByRole('link', { name: '個人資料' })).toHaveAttribute('href', '/profile');
  });

  it('hides the menu button from signed-out visitors', () => {
    localStorage.clear();

    render(<App />);

    expect(screen.queryByRole('button', { name: '主選單' })).not.toBeInTheDocument();
  });
});

/**
 * 側欄的收合（2h · D11、D13、D18、SC-24.2）。
 *
 * 收合的「觸發條件」有兩個，其中一個是 901–1199px 的媒體查詢——jsdom 不套 CSS，
 * 那一條只能交給 e2e。這裡驗的是另一半：**按鈕記得住選擇**，以及**收合之後
 * 每一個無障礙名稱都還在**。後者才是真正的風險：用 `display: none` 藏文字的話
 * 畫面看起來對，但 e2e 的 74 個選取器會整批找不到元素。
 */
describe('AppSidebar 的收合', () => {
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
  const family = { ...personal, id: 'led-2', name: '家庭帳本', kind: 'SHARED' };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    window.history.pushState({}, '', '/');
    fetchMock.mockReset();
    // 兩本帳本，切換器才會畫成 `<select>`（只有一本時是純文字，驗不到重複）。
    fetchMock.mockImplementation((url: string) => {
      const body = String(url).endsWith('/ledgers') ? [personal, family] : [];
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('remembers the collapse choice across a remount', async () => {
    const user = userEvent.setup();
    const first = render(<App />);

    await user.click(screen.getByRole('button', { name: '收合側欄' }));
    expect(localStorage.getItem('ledger.sidebarCollapsed')).toBe('true');
    first.unmount();

    // 「重新整理後仍是收合」在 jsdom 裡的等價說法：重新掛載後讀回同一個選擇。
    render(<App />);
    expect(screen.getByRole('button', { name: '展開側欄' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('keeps every accessible name while collapsed', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByLabelText('作用中帳本')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '收合側欄' }));

    // 收合狀態不能另外渲染一份切換器（D18）。
    expect(screen.getAllByLabelText('作用中帳本')).toHaveLength(1);

    for (const name of ['首頁', '帳本', '帳戶', '分類', '個人資料']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }

    // 登出永遠看得見，不能收進選單（spec §4.2）。
    expect(screen.getByRole('button', { name: '登出' })).toBeInTheDocument();
  });
});
