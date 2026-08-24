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
    tracksBalance: true,
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
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.open = false;
    });
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
  }

  function routeFetch(options: Options = {}) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const target = String(url);
      const method = init?.method ?? 'GET';

      if (target.includes('/users/me')) {
        return Promise.resolve(jsonResponse(200, options.me ?? alice));
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

  /**
   * 成員清單的那一列。用 email 定位而不是名字——名字那個 span 在「我」那一列的
   * 文字是「Alice（我）」，用名字精準比對會找不到。
   */
  const rowOf = (email: string) => within(screen.getByText(email).closest('li') as HTMLElement);

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

  const requests = () =>
    fetchMock.mock.calls.map((call) => ({
      url: String(call[0]),
      method: (call[1] as RequestInit | undefined)?.method ?? 'GET',
      body: (() => {
        const raw = (call[1] as RequestInit | undefined)?.body;
        return typeof raw === 'string' ? raw : '';
      })(),
    }));

  // ── 誰看得到什麼 ──────────────────────────────────────────────────────────

  it('lets an owner manage others but not themselves', async () => {
    routeFetch();

    render(<App />);

    // 等「Bob的角色」出現，而不是等標題——標題不依賴 /users/me，等它會在還不知道
    // 自己是誰的時候就往下斷言。
    expect(await screen.findByLabelText('Bob的角色')).toBeInTheDocument();
    // Bob 那列可以改角色與移除。
    expect(rowOf('bob@example.com').getByLabelText('Bob的角色')).toBeInTheDocument();
    expect(rowOf('bob@example.com').getByRole('button', { name: '移除Bob' })).toBeInTheDocument();
    // 自己那列沒有改角色與移除，只有退出。
    expect(rowOf('alice@example.com').queryByLabelText('Alice的角色')).not.toBeInTheDocument();
    expect(
      rowOf('alice@example.com').getByRole('button', { name: '退出帳本' }),
    ).toBeInTheDocument();
  });

  it('hides management from a member who is not the owner', async () => {
    // 以 Bob（EDITOR）的身分看同一本帳本。
    routeFetch({ me: bob });

    render(<App />);

    // 先等清單畫出來，再等一個依賴 /users/me 的元素：Bob 自己那列的「退出帳本」。
    await screen.findByText('bob@example.com');
    expect(
      await rowOf('bob@example.com').findByRole('button', { name: '退出帳本' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加入成員' })).not.toBeInTheDocument();
    expect(
      rowOf('alice@example.com').queryByRole('button', { name: '移除Alice' }),
    ).not.toBeInTheDocument();
  });

  it('offers no way to add members to a personal ledger', async () => {
    routeFetch({
      detail: { ...shared, kind: 'PERSONAL', members: [shared.members[0]] },
    });

    render(<App />);

    await waitForMyRole();
    // 後端會回 409，所以連入口都不畫。
    expect(screen.queryByRole('button', { name: '加入成員' })).not.toBeInTheDocument();
  });

  it('makes an archived ledger read-only, including leaving it', async () => {
    routeFetch({ detail: { ...shared, archivedAt: '2026-06-01T00:00:00.000Z' } });

    render(<App />);

    expect(await screen.findByText(/帳本已封存，僅可讀取/)).toBeInTheDocument();
    await waitForMyRole();
    expect(screen.queryByRole('button', { name: '加入成員' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '退出帳本' })).not.toBeInTheDocument();
    expect(rowOf('bob@example.com').queryByLabelText('Bob的角色')).not.toBeInTheDocument();
  });

  // ── 加入成員 ─────────────────────────────────────────────────────────────

  it('adds a member and closes the dialog', async () => {
    routeFetch();
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '加入成員' }));
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

    await user.click(await screen.findByRole('button', { name: '加入成員' }));
    await user.type(screen.getByLabelText('email'), 'ghost@example.com');
    await user.click(screen.getByRole('button', { name: '加入' }));

    // 訊息不可只寫「找不到」，而且彈窗要留著讓人改 email。
    expect(await screen.findByRole('alert')).toHaveTextContent('查無此使用者');
    expect(screen.getByLabelText('email')).toHaveValue('ghost@example.com');
  });

  it('says the person is already a member', async () => {
    routeFetch({
      onAdd: () => apiError(409, 'ALREADY_MEMBER', '這個人已經是這本帳本的成員。'),
    });
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '加入成員' }));
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
    expect(options).toEqual(['擁有者', '可編輯', '唯讀']);
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
    expect(await rowOf('bob@example.com').findByRole('alert')).toHaveTextContent(
      '至少要有一位擁有者',
    );
    // 下拉退回原值：清單讀的是伺服器上的角色，而那一筆並沒有被改動。
    expect(screen.getByLabelText('Bob的角色')).toHaveValue('OWNER');
  });

  // ── 移除與退出 ───────────────────────────────────────────────────────────

  it('spells out that the removed member keeps their transactions', async () => {
    routeFetch();
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '移除Bob' }));

    expect(screen.getByText(/將 Bob 移出這本帳本/)).toBeInTheDocument();
    expect(screen.getByText(/他先前記的交易會留下/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '移除' }));

    await waitFor(() => {
      expect(requests().some((request) => request.method === 'DELETE')).toBe(true);
    });
  });

  it('sends the user back to the ledger list after they leave', async () => {
    routeFetch();
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '退出帳本' }));
    expect(screen.getByText(/你將無法再看到裡面的交易/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '退出' }));

    // 留在明細頁的話，下一次重取會拿到 404——那本帳本已經不屬於自己了。
    await waitFor(() => {
      expect(window.location.pathname).toBe('/ledgers');
    });
  });

  it('keeps the dialog open when the last owner tries to leave', async () => {
    routeFetch({
      onRemove: () => apiError(409, 'LAST_OWNER_CANNOT_LEAVE', '帳本至少要有一位擁有者。'),
    });
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '退出帳本' }));
    await user.click(screen.getByRole('button', { name: '退出' }));

    // 409 是按下確認之後才發生的。彈窗關掉的話，使用者只會看到「什麼都沒發生」。
    expect(await screen.findByRole('alert')).toHaveTextContent('至少要有一位擁有者');
    expect(window.location.pathname).toBe('/ledgers/led-2');
  });
});
