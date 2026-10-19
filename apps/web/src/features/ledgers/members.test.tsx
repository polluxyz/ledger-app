import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

/**
 * 帳本成員管理（Slice 2 Step 6，對應 SC-8）。
 *
 * 決議見 `tasks/phase-2b-slice-2-todo.md` 的 S6-D1～S6-D4。重心放在三件事：
 * 誰看得到哪些按鈕、五種失敗各自說了什麼、以及退出之後畫面往哪裡去。
 */
describe('Ledger members', () => {
  const fetchMock = vi.fn();

  const alice = { id: 'u1', email: 'alice@example.com', name: 'Alice' };
  const bob = { id: 'u2', email: 'bob@example.com', name: 'Bob' };

  const shared = {
    id: 'led-2',
    name: '家庭帳本',
    currency: 'TWD',
    kind: 'SHARED',
    archivedAt: null as string | null,
    createdAt: '2026-01-01T00:00:00.000Z',
    members: [
      { userId: 'u1', email: 'alice@example.com', name: 'Alice', role: 'OWNER' },
      { userId: 'u2', email: 'bob@example.com', name: 'Bob', role: 'EDITOR' },
    ],
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

  function apiError(status: number, errorCode: string, message: string): Response {
    return jsonResponse(status, { statusCode: status, errorCode, message });
  }

  interface Options {
    /** 目前登入者，預設 Alice（owner）。 */
    me?: typeof alice;
    /** 帳本明細，預設共享、未封存。 */
    detail?: Record<string, unknown>;
    /** `POST .../members` 的回應。 */
    onAdd?: () => Response;
    /** `PATCH .../members/:id` 的回應。 */
    onPatchRole?: () => Response;
    /** `DELETE .../members/:id` 的回應。 */
    onRemove?: () => Response;
    /** `POST .../leave-preview` 的回應。 */
    leavePreview?: Record<string, unknown>;
    /** `POST .../leave` 的回應。 */
    onLeave?: () => Response;
  }

  function routeFetch(options: Options = {}) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const target = String(url);
      const method = init?.method ?? 'GET';

      if (target.includes('/users/me')) {
        return Promise.resolve(jsonResponse(200, options.me ?? alice));
      }
      if (target.endsWith('/ledgers/led-2/leave-preview')) {
        return Promise.resolve(
          jsonResponse(
            200,
            options.leavePreview ?? {
              items: [],
              accounts: [],
              carryOvers: [],
              withdrawals: [],
              leave: { allowed: true, blockedBy: null },
            },
          ),
        );
      }
      if (target.endsWith('/ledgers/led-2/leave') && method === 'POST') {
        return Promise.resolve(options.onLeave?.() ?? new Response(null, { status: 204 }));
      }
      if (target.includes('/members')) {
        if (method === 'POST') {
          return Promise.resolve(
            options.onAdd?.() ?? jsonResponse(201, { ...bob, userId: 'u3', role: 'EDITOR' }),
          );
        }
        if (method === 'PATCH') {
          return Promise.resolve(
            options.onPatchRole?.() ?? jsonResponse(200, { ...bob, userId: 'u2', role: 'VIEWER' }),
          );
        }
        if (method === 'DELETE') {
          return Promise.resolve(options.onRemove?.() ?? new Response(null, { status: 204 }));
        }
      }
      if (target.endsWith('/ledgers/led-2')) {
        return Promise.resolve(jsonResponse(200, options.detail ?? shared));
      }
      return Promise.resolve(jsonResponse(200, []));
    });
  }

  /** 成員 email 不再出現在清單，改用名字定位該列。 */
  const rowOf = (name: string) =>
    within(
      within(screen.getByRole('list', { name: '帳本成員' }))
        .getByText(
          (_, element) => element?.tagName === 'SPAN' && element.textContent?.startsWith(name),
        )
        .closest('li') as HTMLElement,
    );

  /**
   * 等 `/users/me` 回來、「我的角色」那張卡填上值為止。
   *
   * 沒有這道等待的話，「某個按鈕不存在」的斷言會在還不知道自己是誰的時候就通過——
   * 那種測試永遠是綠的，卻什麼也沒測到。「擁有者」會同時出現在那張卡與成員列的
   * 角色標籤上，所以數量到 2 就代表身分已經確定。
   */
  async function waitForMyRole() {
    await waitFor(() => {
      expect(screen.getAllByText('擁有者').length).toBeGreaterThan(1);
    });
  }

  const requests = (): Array<{ url: string; method: string; body: string }> => {
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    return calls.map((call) => ({
      url:
        typeof call[0] === 'string' ? call[0] : call[0] instanceof URL ? call[0].href : call[0].url,
      method: call[1]?.method ?? 'GET',
      body: typeof call[1]?.body === 'string' ? call[1].body : '',
    }));
  };

  // ── 誰看得到什麼 ──────────────────────────────────────────────────────────

  it('lets an owner manage others but not themselves', async () => {
    routeFetch();

    render(<App />);

    // 等「Bob的角色」出現，而不是等標題——標題不依賴 /users/me，等它會在還不知道
    // 自己是誰的時候就往下斷言。
    expect(await screen.findByLabelText('Bob的角色')).toBeInTheDocument();
    // Bob 那列可以改角色與移除。
    expect(rowOf('Bob').getByLabelText('Bob的角色')).toBeInTheDocument();
    expect(rowOf('Bob').getByRole('option', { name: '移除' })).toBeInTheDocument();
    // 自己那列沒有改角色；退出入口在成員清單底部。
    expect(rowOf('Alice').queryByLabelText('Alice的角色')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退出帳本' })).toBeInTheDocument();
    expect(screen.queryByText('bob@example.com')).not.toBeInTheDocument();
  });

  it('hides management from a member who is not the owner', async () => {
    // 以 Bob（EDITOR）的身分看同一本帳本。
    routeFetch({ me: bob });

    render(<App />);

    // 先等清單畫出來，再等一個依賴 /users/me 的元素：Bob 自己那列的「退出帳本」。
    await screen.findByText('Bob');
    expect(await screen.findByRole('button', { name: '退出帳本' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新增成員' })).not.toBeInTheDocument();
    expect(rowOf('Alice').queryByLabelText('Alice的角色')).not.toBeInTheDocument();
  });

  it('offers no way to add members to a personal ledger', async () => {
    routeFetch({
      detail: { ...shared, kind: 'PERSONAL', members: [shared.members[0]] },
    });

    render(<App />);

    await waitForMyRole();
    // 後端會回 409，所以連入口都不畫。
    expect(screen.queryByRole('button', { name: '新增成員' })).not.toBeInTheDocument();
  });

  it('makes an archived ledger read-only, including leaving it', async () => {
    routeFetch({ detail: { ...shared, archivedAt: '2026-06-01T00:00:00.000Z' } });

    render(<App />);

    expect(await screen.findByText(/帳本已封存，僅可讀取/)).toBeInTheDocument();
    await waitForMyRole();
    expect(screen.queryByRole('button', { name: '新增成員' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '退出帳本' })).not.toBeInTheDocument();
    expect(rowOf('Bob').queryByLabelText('Bob的角色')).not.toBeInTheDocument();
  });

  // ── 新增成員 ─────────────────────────────────────────────────────────────

  it('opens the two add sources from the single add-member entry', async () => {
    routeFetch();
    const user = userEvent.setup();

    render(<App />);
    await waitForMyRole();

    const trigger = screen.getByRole('button', { name: '新增成員' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);

    expect(screen.getByRole('button', { name: '新增對象' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新增虛擬成員' })).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens the add-member form in the right panel', async () => {
    routeFetch();
    const user = userEvent.setup();

    render(<App />);
    await waitForMyRole();

    await user.click(screen.getByRole('button', { name: '新增成員' }));
    await user.click(screen.getByRole('button', { name: '新增對象' }));
    await user.click(await screen.findByRole('button', { name: '用 email 新增' }));

    // SC-42：表單搬到右側欄，不再往下擠開成員清單。右側欄是 <main> 的兄弟，
    // 所以「不在 main 裡」就是「在右側欄」，這個判準不依賴 CSS 類名。
    const form = await screen.findByRole('dialog', { name: '新增成員' });
    expect(form.closest('main')).toBeNull();
  });

  it('adds a member and closes the dialog', async () => {
    routeFetch();
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '新增成員' }));
    await user.click(screen.getByRole('button', { name: '新增對象' }));
    await user.click(await screen.findByRole('button', { name: '用 email 新增' }));
    await user.type(screen.getByLabelText('email'), 'carol@example.com');
    await user.selectOptions(screen.getByLabelText('角色'), 'VIEWER');
    await user.click(screen.getByRole('button', { name: '加入' }));

    await waitFor(() => {
      const posted = requests().find(
        (request) => request.method === 'POST' && request.url.endsWith('/members'),
      );
      expect(posted).toBeDefined();
      expect(JSON.parse(posted?.body ?? '{}')).toEqual({
        email: 'carol@example.com',
        role: 'VIEWER',
      });
    });
  });

  it('says the person has to register when the email is unknown', async () => {
    routeFetch({
      onAdd: () => apiError(404, 'USER_NOT_FOUND', '查無此使用者，請確認對方已經註冊。'),
    });
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '新增成員' }));
    await user.click(screen.getByRole('button', { name: '新增對象' }));
    await user.click(await screen.findByRole('button', { name: '用 email 新增' }));
    await user.type(screen.getByLabelText('email'), 'ghost@example.com');
    await user.click(screen.getByRole('button', { name: '加入' }));

    // 訊息不可只寫「找不到」，而且彈窗要留著讓人改 email。
    // USER_NOT_FOUND 有對照到中文，顯示的是對照表裡的句子。
    expect(await screen.findByRole('alert')).toHaveTextContent('找不到使用這個 email 的帳號');
    expect(screen.getByLabelText('email')).toHaveValue('ghost@example.com');
  });

  it('says the person is already a member', async () => {
    routeFetch({
      onAdd: () => apiError(409, 'ALREADY_MEMBER', '這個人已經是這本帳本的成員。'),
    });
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '新增成員' }));
    await user.click(screen.getByRole('button', { name: '新增對象' }));
    await user.click(await screen.findByRole('button', { name: '用 email 新增' }));
    await user.type(screen.getByLabelText('email'), 'bob@example.com');
    await user.click(screen.getByRole('button', { name: '加入' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('已經是這本帳本的成員');
  });

  // ── 改角色 ───────────────────────────────────────────────────────────────

  it('offers owner as a role so the ledger can be handed over (S6-D1)', async () => {
    routeFetch();

    render(<App />);

    const select = await screen.findByLabelText('Bob的角色');
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['擁有者', '可編輯', '唯讀', '移除']);
  });

  it('changes a role straight from the row (S6-D2)', async () => {
    routeFetch();
    const user = userEvent.setup();

    render(<App />);

    await user.selectOptions(await screen.findByLabelText('Bob的角色'), 'VIEWER');

    await waitFor(() => {
      const patched = requests().find((request) => request.method === 'PATCH');
      expect(patched).toBeDefined();
      expect(JSON.parse(patched?.body ?? '{}')).toEqual({ role: 'VIEWER' });
    });
  });

  it('puts a failed role change under that row, not at the top of the page', async () => {
    routeFetch({
      onPatchRole: () => apiError(409, 'LAST_OWNER_CANNOT_LEAVE', '帳本至少要有一位擁有者。'),
      detail: {
        ...shared,
        members: [
          shared.members[0],
          { userId: 'u2', email: 'bob@example.com', name: 'Bob', role: 'OWNER' },
        ],
      },
    });
    const user = userEvent.setup();

    render(<App />);

    await user.selectOptions(await screen.findByLabelText('Bob的角色'), 'VIEWER');

    // 訊息貼在 Bob 那一列裡面——整頁共用一個錯誤框的話，看的人不知道是哪一列。
    expect(await rowOf('Bob').findByRole('alert')).toHaveTextContent('至少要有一位擁有者');
    // 下拉退回原值：清單讀的是伺服器上的角色，而那一筆並沒有被改動。
    expect(screen.getByLabelText('Bob的角色')).toHaveValue('OWNER');
  });

  // ── 移除與退出 ───────────────────────────────────────────────────────────

  it('spells out that the removed member keeps their transactions', async () => {
    routeFetch();
    const user = userEvent.setup();

    render(<App />);

    const roleSelect = await screen.findByLabelText('Bob的角色');
    await user.selectOptions(
      roleSelect,
      screen.getByRole('option', { name: '移除' }).getAttribute('value') ?? '',
    );

    expect(screen.getByText(/將 Bob 移出這本帳本/)).toBeInTheDocument();
    expect(screen.getByText(/他先前記的交易會留下/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '移除' }));

    await waitFor(() => {
      expect(requests().some((request) => request.method === 'DELETE')).toBe(true);
    });
  });

  it('sends a leave request and returns the user to the ledger list', async () => {
    routeFetch({ onLeave: () => new Response(null, { status: 204 }) });
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '退出帳本' }));
    expect(await screen.findByRole('heading', { name: '退出「家庭帳本」' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '退出' }));

    await waitFor(() => {
      const leaveRequest = requests().find((request) => request.url.endsWith('/leave'));
      expect(leaveRequest?.method).toBe('POST');
      expect(JSON.parse(leaveRequest?.body ?? '{}')).toEqual({
        targetLedgerId: null,
        excludedItemIds: [],
      });
    });

    // 留在明細頁的話，下一次重取會拿到 404——那本帳本已經不屬於自己了。
    await waitFor(() => {
      expect(window.location.pathname).toBe('/ledgers');
    });
  });

  it('shows the leave blocker and only offers cancel', async () => {
    routeFetch({
      leavePreview: {
        items: [],
        accounts: [],
        carryOvers: [],
        withdrawals: [],
        leave: { allowed: false, blockedBy: 'LAST_OWNER' },
      },
    });
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '退出帳本' }));

    expect(await screen.findByText('你是最後一位擁有者，不能退出')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '退出' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/ledgers/led-2');
  });

  it('offers to change a member with transactions to viewer after the 409 response', async () => {
    routeFetch({
      onRemove: () =>
        apiError(409, 'MEMBER_HAS_TRANSACTIONS', '成員有交易，請先將角色改為檢視者。'),
    });
    const user = userEvent.setup();

    render(<App />);

    const roleSelect = await screen.findByLabelText('Bob的角色');
    await user.selectOptions(
      roleSelect,
      screen.getByRole('option', { name: '移除' }).getAttribute('value') ?? '',
    );
    await user.click(screen.getByRole('button', { name: '移除' }));

    expect(await screen.findByText('Bob在這本帳本有帳，只能改成檢視者')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '改成檢視者' }));

    await waitFor(() => {
      const patch = requests().find((request) => request.method === 'PATCH');
      expect(patch?.url).toContain('/members/u2');
      expect(JSON.parse(patch?.body ?? '{}')).toEqual({ role: 'VIEWER' });
    });
    expect(screen.queryByRole('dialog', { name: '移除成員' })).not.toBeInTheDocument();
  });
});
