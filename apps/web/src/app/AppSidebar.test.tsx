import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
   *
   * 2i 把「個人資料」從導覽移進使用者選單（SC-31.4、SC-32.1），所以這一條的
   * **選取步驟**多了「先打開選單」，去向仍然是 `/profile`。
   */
  it('links to the categories and profile pages', async () => {
    const user = userEvent.setup();
    render(<App />);

    // 分類連結刻意不帶 `?ledgerId=`——從導覽進去就是看作用中帳本那一本。
    expect(screen.getByRole('link', { name: '分類' })).toHaveAttribute('href', '/categories');

    await user.click(screen.getByRole('button', { name: '帳號選單' }));
    expect(screen.getByRole('link', { name: '個人資料' })).toHaveAttribute('href', '/profile');
  });

  it('hides the menu button from signed-out visitors', () => {
    localStorage.clear();

    render(<App />);

    expect(screen.queryByRole('button', { name: '主選單' })).not.toBeInTheDocument();
  });
});

/**
 * 側欄的收合（2h · D11、SC-24.2；2i · SC-31.3、SC-31.4、SC-31.5）。
 *
 * 這裡驗三件事：**按鈕記得住選擇**、**收合之後每一個無障礙名稱都還在**、
 * 以及 2i 搬走的東西真的不在側欄裡了。第二件才是真正的風險：用 `display: none`
 * 藏文字的話畫面看起來對，但 e2e 的選取器會整批找不到元素。
 *
 * 「收合後 icon 不位移」是 CSS 的事，jsdom 不套 CSS，交給 e2e 的 SC-31.1 量座標。
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
    // 兩本帳本，切換器才會畫成可切換的那一版（只有一本時是純文字，驗不到重複）。
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

    await user.click(screen.getByRole('button', { name: '收合側欄' }));

    for (const name of ['首頁', '交易', '帳本', '帳戶', '分類']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }

    // 登出在使用者選單裡（2i SC-32）；收合後那顆按鈕與選單內容都還讀得到。
    await user.click(screen.getByRole('button', { name: '帳號選單' }));
    expect(screen.getByRole('button', { name: '登出' })).toBeInTheDocument();
  });

  /**
   * 2i 把帳本切換器搬到記帳頁的頁首、「個人資料」搬進使用者選單（SC-31.4）。
   * 側欄裡不能再留一份——留著就是兩個同名控制項，`getByLabelText` 會對到兩個。
   */
  it('no longer carries the ledger card or the profile link', () => {
    render(<App />);

    expect(within(sidebar()).queryByLabelText('作用中帳本')).not.toBeInTheDocument();
    expect(within(sidebar()).queryByText('目前帳本')).not.toBeInTheDocument();
    expect(within(sidebar()).queryByRole('link', { name: '個人資料' })).not.toBeInTheDocument();
  });

  it('navigates to the new transactions page', () => {
    render(<App />);

    expect(screen.getByRole('link', { name: '交易' })).toHaveAttribute('href', '/transactions');
  });
});

/**
 * 會滑動的選中底色（2i · SC-43.1，第三輪）。
 *
 * jsdom 不排版，量不到它滑到哪裡——那要在 e2e 量。這裡釘住的是**前提**：
 * 整個導覽只有一塊底色（不是每個連結各一塊，那樣滑不起來），而且它跟著
 * `aria-current="page"` 走：不在導覽裡的頁面（個人資料）就藏起來。
 */
describe('AppSidebar 的選中底色', () => {
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function marker(): HTMLElement {
    const nav = screen.getByRole('navigation', { name: '主要導覽' });
    const found = nav.querySelectorAll('[data-nav-marker]');
    expect(found).toHaveLength(1);
    return found[0] as HTMLElement;
  }

  it('keeps one highlight for the whole nav and follows the current link', async () => {
    const user = userEvent.setup();
    render(<App />);

    // 起點是首頁：首頁那一項選中，底色顯示。
    expect(screen.getByRole('link', { name: '首頁' })).toHaveAttribute('aria-current', 'page');
    expect(marker()).not.toHaveAttribute('hidden');

    await user.click(screen.getByRole('link', { name: '帳戶' }));

    expect(screen.getByRole('link', { name: '帳戶' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '首頁' })).not.toHaveAttribute('aria-current');
    expect(marker()).not.toHaveAttribute('hidden');
  });

  it('hides the highlight on pages that are not in the nav', async () => {
    const user = userEvent.setup();
    render(<App />);

    // 個人資料在使用者選單裡，不是導覽的一項（SC-31.4）。
    await user.click(screen.getByRole('button', { name: '帳號選單' }));
    await user.click(screen.getByRole('link', { name: '個人資料' }));

    expect(marker()).toHaveAttribute('hidden');
  });
});

/**
 * 901–1199px 的浮動展開（2i · SC-31.6、D27）。
 *
 * 那個區間側欄預設收合，但收合鈕**仍然顯示**（2h 在這裡把它藏起來）。按下去是
 * 「暫時浮出來看一眼」：側欄浮在內容上、中間區不動、**不寫 localStorage**，
 * 點連結就收回。斷點本身只存在 CSS，所以這裡 stub 一個 `matchMedia` 來模擬。
 */
describe('AppSidebar 在 901–1199px 的浮動展開', () => {
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
    // 只讓「901–1199px」那一條成立，其他查詢（例如右側欄的 ≤ 900px）一律 false。
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('901px'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts collapsed but still offers the expand button', () => {
    render(<App />);

    // 2h 在這個區間把按鈕藏起來，使用者看不到其他頁面的名稱（假設 4）。
    expect(screen.getByRole('button', { name: '展開側欄' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('floats open without remembering the choice, and retracts after a link', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '展開側欄' }));

    const collapseButton = screen.getByRole('button', { name: '收合側欄' });
    expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
    // 浮起來的是側欄自己，外殼第一欄不動——靠 `.floating` 那組 CSS 規則。
    expect(sidebar().className).toContain('floating');
    // 這個區間的展開是暫時的，不進 localStorage（D27）。
    expect(localStorage.getItem('ledger.sidebarCollapsed')).toBeNull();

    await user.click(screen.getByRole('link', { name: '帳戶' }));

    expect(screen.getByRole('button', { name: '展開側欄' })).toBeInTheDocument();
    expect(sidebar().className).not.toContain('floating');
  });

  it('retracts when the user presses Escape', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '展開側欄' }));
    await user.keyboard('{Escape}');

    expect(screen.getByRole('button', { name: '展開側欄' })).toBeInTheDocument();
  });
});

/** 側欄本體。用 ☰ 的 `aria-controls` 取，不必另外掛 test id。 */
function sidebar(): HTMLElement {
  const id = screen.getByRole('button', { name: '主選單' }).getAttribute('aria-controls');
  const element = document.getElementById(id as string);
  if (!element) {
    throw new Error('找不到側欄。');
  }
  return element;
}
