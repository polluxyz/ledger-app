import { render, screen, waitFor } from '@testing-library/react';
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
  const detail = {
    id: 'led-2',
    name: '家庭帳本',
    currency: 'TWD',
    kind: 'SHARED',
    tracksBalance: true,
    archivedAt: null,
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

  function routeFetch(
    overrides: { detail?: () => Promise<Response>; me?: Record<string, unknown> } = {},
  ) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.includes('/users/me')) {
        return Promise.resolve(jsonResponse(200, overrides.me ?? alice));
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
    expect(screen.getByText('連動')).toBeInTheDocument();
    // 兩個不可更改的欄位都要把這件事寫在畫面上。
    expect(screen.getAllByText('建立後不可更改')).toHaveLength(2);
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '成員（2）' })).toBeInTheDocument();
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

  it('hides the rename button from someone who is not the owner', async () => {
    // 以 Bob（EDITOR）的身分看同一本帳本。
    routeFetch({ me: { id: 'u2', email: 'bob@example.com', name: 'Bob' } });

    render(<App />);

    expect(await screen.findByRole('heading', { name: '家庭帳本' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '改名' })).not.toBeInTheDocument();
    expect(screen.getByText('可編輯')).toBeInTheDocument();
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
      // 只送名稱。`kind` 與 `tracksBalance` 帶上去都會被後端退回 400。
      expect(JSON.parse(typeof body === 'string' ? body : '{}')).toEqual({ name: '我們家' });
    });
  });

  it('offers no rename on an archived ledger', async () => {
    routeFetch({
      detail: () =>
        Promise.resolve(jsonResponse(200, { ...detail, archivedAt: '2026-06-01T00:00:00.000Z' })),
    });

    render(<App />);

    expect(await screen.findByText('封存後僅可讀取')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '改名' })).not.toBeInTheDocument();
  });
});
