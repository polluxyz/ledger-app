import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

/**
 * 帳本明細與改名（Slice 2 Step 5）。
 *
 * 最要緊的一條是「找不到 vs 沒有權限」。後端對無權存取的帳本回 404 而不是 403，
 * 前端也必須跟著只說「找不到」——說「你沒有權限看這本帳本」等於承認它存在。
 */
describe('Ledger detail page', () => {
  const fetchMock = vi.fn();

  const alice = { id: 'u1', email: 'alice@example.com', name: 'Alice' };
  const archivedOn = '2026-06-01T00:00:00.000Z';
  const detail = {
    id: 'led-2',
    name: '家庭帳本',
    currency: 'TWD',
    kind: 'SHARED',
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    members: [
      { userId: 'u1', email: 'alice@example.com', name: 'Alice', role: 'OWNER' },
      { userId: 'u2', email: 'bob@example.com', name: 'Bob', role: 'EDITOR' },
    ],
  };
  const virtualMember = {
    id: 'person-1',
    name: '阿美',
    userId: null,
    status: 'GUEST',
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    window.history.pushState({}, '', '/ledgers/led-2');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function routeFetch(
    overrides: {
      detail?: () => Promise<Response>;
      me?: Record<string, unknown>;
      remove?: () => Promise<Response>;
      preview?: unknown;
      unarchive?: () => Promise<Response>;
      people?: unknown[];
      groups?: unknown[];
      counterparties?: unknown[];
    } = {},
  ) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.includes('/users/me')) {
        return Promise.resolve(jsonResponse(200, overrides.me ?? alice));
      }
      if (target.endsWith('/ledgers/led-2/people')) {
        return Promise.resolve(jsonResponse(200, overrides.people ?? []));
      }
      if (target.includes('/ledger-groups')) {
        return Promise.resolve(jsonResponse(200, overrides.groups ?? []));
      }
      if (target.includes('/counterparties')) {
        const items = overrides.counterparties ?? [];
        return Promise.resolve(
          jsonResponse(200, { items, page: 1, limit: 100, total: items.length }),
        );
      }
      if (target.includes('/ledgers/led-2/archive')) {
        return Promise.resolve(jsonResponse(200, { ...detail, archivedAt: archivedOn }));
      }
      if (target.endsWith('/ledgers/led-2/unarchive') && init?.method === 'POST') {
        return (
          overrides.unarchive?.() ??
          Promise.resolve(jsonResponse(200, { ...detail, archivedAt: null }))
        );
      }
      if (target.endsWith('/ledgers/led-2/removal-preview')) {
        return Promise.resolve(
          jsonResponse(
            200,
            overrides.preview ?? {
              accounts: [],
              counterparties: [],
              withdrawsDebts: false,
              delete: { allowed: true, blockedBy: null },
            },
          ),
        );
      }
      // 刪除的網址帶著 ?confirm=，接不到下面那個 endsWith 的分支。
      if (init?.method === 'DELETE' && target.includes('/ledgers/led-2')) {
        return overrides.remove?.() ?? Promise.resolve(new Response(null, { status: 204 }));
      }
      if (target.endsWith('/ledgers/led-2')) {
        if (init?.method === 'PATCH') {
          return Promise.resolve(jsonResponse(200, { ...detail, name: '我們家' }));
        }
        return overrides.detail?.() ?? Promise.resolve(jsonResponse(200, detail));
      }
      if (target.includes('/ledgers')) {
        return Promise.resolve(jsonResponse(200, []));
      }
      return Promise.resolve(jsonResponse(200, []));
    });
  }

  it('shows the ledger facts and its members', async () => {
    routeFetch();

    render(<App />);

    expect(await screen.findByRole('heading', { name: '家庭帳本' })).toBeInTheDocument();
    expect(screen.getByText('共享')).toBeInTheDocument();
    expect(screen.queryByText('連動')).not.toBeInTheDocument();
    expect(screen.getAllByText('建立後不可更改')).toHaveLength(1);
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText('bob@example.com')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '成員（2）' })).toBeInTheDocument();
  });

  it('shows virtual members in the same counted list and lets an editor manage them', async () => {
    routeFetch({
      me: { id: 'u2', email: 'bob@example.com', name: 'Bob' },
      people: [virtualMember],
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: '成員（3）' })).toBeInTheDocument();
    expect(screen.getByText('阿美')).toBeInTheDocument();
    expect(screen.getByText('虛擬成員')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '非成員' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '改名阿美' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刪除阿美' })).toBeInTheDocument();
  });

  it('keeps an archived shared ledger readable while hiding guest management', async () => {
    routeFetch({
      detail: () => Promise.resolve(jsonResponse(200, { ...detail, archivedAt: archivedOn })),
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: '成員（2）' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新增成員' })).not.toBeInTheDocument();
  });

  it('does not request or show a guest list for a personal ledger', async () => {
    routeFetch({
      detail: () => Promise.resolve(jsonResponse(200, { ...detail, kind: 'PERSONAL' })),
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: '家庭帳本' })).toBeInTheDocument();
    expect(screen.queryByText('虛擬成員')).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith('/ledgers/led-2/people')),
    ).toBe(false);
  });

  it('says only that the ledger was not found, never that access was denied', async () => {
    routeFetch({
      detail: () =>
        Promise.resolve(
          jsonResponse(404, { statusCode: 404, errorCode: 'NOT_FOUND', message: 'Not found' }),
        ),
    });

    render(<App />);

    expect(await screen.findByText('找不到這本帳本。')).toBeInTheDocument();
    // 任何暗示「它存在，只是你看不到」的字眼都是洩漏。
    expect(screen.queryByText(/權限/)).not.toBeInTheDocument();
    expect(screen.queryByText(/家庭帳本/)).not.toBeInTheDocument();
  });

  it('puts the back link above the title and the rename button beside it', async () => {
    // 開發者 2026-10-07：最上排橫條清空留給 AI 功能，返回連結回到標題左上、
    // 「改名」回到標題同一排右邊。判準刻意不看 CSS 類名，只看相對位置。
    routeFetch();

    render(<App />);

    const heading = await screen.findByRole('heading', { name: '家庭帳本' });

    // 返回連結在標題之前（標題左上），而且只指向列表。
    const back = screen.getByRole('link', { name: '回到帳本列表' });
    expect(back).toHaveAttribute('href', '/ledgers');
    expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    // 「改名」在頁首的 <header> 裡、標題後面（標題同一排右邊）。
    const rename = screen.getByRole('button', { name: '改名' });
    expect(rename.closest('header')).toBe(heading.closest('header'));
    expect(heading.compareDocumentPosition(rename) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    // 標題仍是頁首裡的第一個東西。
    expect(heading.closest('header')?.firstElementChild).toBe(heading);
  });

  it('keeps the way back to the list when the ledger cannot be loaded', async () => {
    // 讀不到帳本時最需要那條返回的路。它只出現一次——同一個無障礙名稱在頁面上
    // 出現兩遍的話，螢幕閱讀器與 e2e 都分不出該用哪一個。
    routeFetch({
      detail: () =>
        Promise.resolve(
          jsonResponse(404, { statusCode: 404, errorCode: 'NOT_FOUND', message: 'Not found' }),
        ),
    });

    render(<App />);

    expect(await screen.findByText('找不到這本帳本。')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '回到帳本列表' })).toHaveLength(1);
  });

  it('hides the rename button from someone who is not the owner', async () => {
    // 以 Bob（EDITOR）的身分看同一本帳本。
    routeFetch({ me: { id: 'u2', email: 'bob@example.com', name: 'Bob' } });

    render(<App />);

    expect(await screen.findByRole('heading', { name: '家庭帳本' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '改名' })).not.toBeInTheDocument();
    // 「可編輯」在畫面上會出現兩次：「我的角色」與 Bob 那一列的角色標籤。原本整頁
    // getByText 只對到一個，是因為「我的角色」要等 /users/me 回來，斷言時多半還是「—」
    // ——測試靠的是這個 race。2h 的側欄也讀目前使用者，身分提早載入，race 就消失了。
    // 改成限定在「我的角色」這一格、等它載入完成，驗的是同一件事，而且不再靠運氣。
    const myRole = screen.getByText('我的角色').closest('div');
    await waitFor(() => expect(myRole).toHaveTextContent('可編輯'));
  });

  it('renames the ledger and sends only the name', async () => {
    routeFetch();
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '改名' }));
    await user.clear(screen.getByLabelText('名稱'));
    await user.type(screen.getByLabelText('名稱'), '我們家');
    await user.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
      const body = (patch?.[1] as RequestInit | undefined)?.body;
      // 只送名稱；帳本類型建立後不可更改。
      expect(JSON.parse(typeof body === 'string' ? body : '{}')).toEqual({ name: '我們家' });
    });
  });

  it('offers unarchive but not rename on an archived ledger', async () => {
    routeFetch({
      detail: () => Promise.resolve(jsonResponse(200, { ...detail, archivedAt: archivedOn })),
    });

    render(<App />);

    expect(await screen.findByText('封存後僅可讀取')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '改名' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '危險操作' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消封存' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刪除帳本' })).not.toBeInTheDocument();
  });

  it('hides the danger zone from someone who is not the owner', async () => {
    routeFetch({ me: { id: 'u2', email: 'bob@example.com', name: 'Bob' } });

    render(<App />);

    expect(await screen.findByRole('heading', { name: '家庭帳本' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '危險操作' })).not.toBeInTheDocument();
  });

  it('archives the ledger without typing a name or showing a description', async () => {
    routeFetch();
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '封存帳本' }));
    expect(screen.getByRole('heading', { name: '封存「家庭帳本」' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/輸入/)).not.toBeInTheDocument();
    expect(screen.queryByText(/無法解除封存/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '封存' }));

    await waitFor(() => {
      const archive = fetchMock.mock.calls.find((call) =>
        String(call[0]).includes('/ledgers/led-2/archive'),
      );
      expect(archive).toBeDefined();
      expect((archive?.[1] as RequestInit | undefined)?.method).toBe('POST');
    });
  });

  /**
   * 危險操作區裡兩顆按鈕的後果差很多：封存可以只是收起來，刪除是連資料一起消失。
   * 2h 之後只有刪除帶危險樣式，靠 class 驗——顏色本身在單元測試裡讀不到。
   */
  it('marks only 刪除帳本 with the dangerous styling', async () => {
    routeFetch();

    render(<App />);

    const remove = await screen.findByRole('button', { name: '刪除帳本' });
    expect(remove.className).toMatch(/deleteButton/);
    expect(screen.getByRole('button', { name: '封存帳本' }).className).not.toMatch(/deleteButton/);
  });

  it('loads the removal preview, deletes with the typed name, and returns to the list', async () => {
    routeFetch();
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '刪除帳本' }));
    expect(await screen.findByRole('heading', { name: '刪除「家庭帳本」' })).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith('/ledgers/led-2/removal-preview')),
    ).toBe(true);
    await user.type(screen.getByLabelText('輸入帳本名稱'), '家庭帳本');
    await user.click(screen.getByRole('button', { name: '刪除' }));

    await waitFor(() => {
      const remove = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'DELETE',
      );
      expect(remove).toBeDefined();
      const deleteUrl = new URL(String(remove?.[0]));
      expect(deleteUrl.searchParams.get('confirm')).toBe('家庭帳本');
      expect(deleteUrl.searchParams.has('withdrawDebts')).toBe(false);
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe('/ledgers');
    });
  });

  it('shows unarchive only to the owner and refreshes the ledger list after success', async () => {
    let archived = true;
    routeFetch({
      detail: () =>
        Promise.resolve(jsonResponse(200, { ...detail, archivedAt: archived ? archivedOn : null })),
      unarchive: () => {
        archived = false;
        return Promise.resolve(jsonResponse(200, { ...detail, archivedAt: null }));
      },
    });
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '取消封存' }));
    const confirmation = screen.getByRole('dialog', { name: '取消封存「家庭帳本」' });
    expect(confirmation).toBeInTheDocument();
    await user.click(within(confirmation).getByRole('button', { name: '取消封存' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith('/ledgers/led-2/unarchive') &&
            (init as RequestInit)?.method === 'POST',
        ),
      ).toBe(true);
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith('/ledgers') && (init as RequestInit)?.method !== 'POST',
        ),
      ).toBe(true);
      expect(window.location.pathname).toBe('/ledgers/led-2');
    });
    expect(await screen.findByRole('button', { name: '封存帳本' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消封存' })).not.toBeInTheDocument();
  });

  it('hides unarchive from an archived ledger to a non-owner', async () => {
    routeFetch({
      detail: () => Promise.resolve(jsonResponse(200, { ...detail, archivedAt: archivedOn })),
      me: { id: 'u2', email: 'bob@example.com', name: 'Bob' },
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: '家庭帳本' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消封存' })).not.toBeInTheDocument();
  });
});
