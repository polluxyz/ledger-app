import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Counterparty, FriendRequest } from '@ledger/shared';
import { CounterpartyDirectory } from './CounterpartyDirectory';

describe('CounterpartyDirectory', () => {
  const fetchMock = vi.fn();
  const linkedCounterparty: Counterparty = {
    id: 'linked-1',
    name: '小明',
    displayName: '小明',
    askMerge: false,
    balance: 987654,
    link: { userId: 'user-1', userName: '王小明', theirBalance: -123456 },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
  const unlinkedCounterparty: Counterparty = {
    ...linkedCounterparty,
    id: 'unlinked-1',
    name: '林小安',
    displayName: '林小安',
    link: null,
  };
  const outgoingInvite: FriendRequest = {
    id: 'invite-1',
    direction: 'outgoing',
    status: 'PENDING',
    counterpart: { userId: null, name: null, email: 'lin@example.com' },
    createdAt: '2026-09-01T00:00:00.000Z',
    respondedAt: null,
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  function respondWith(items: Counterparty[], getInvite: () => FriendRequest | null) {
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      if (url.includes('/friend-requests/invite-1/cancel')) {
        return json(outgoingInvite);
      }
      if (url.includes('/friend-requests?direction=outgoing')) {
        const invite = getInvite();
        return json({ items: invite ? [invite] : [], page: 1, limit: 100, total: invite ? 1 : 0 });
      }
      if (url.includes('/counterparties')) {
        return json({ items, page: 1, limit: 100, total: items.length });
      }
      return Promise.reject(new Error(`未預期的請求：${url} (${init?.method ?? 'GET'})`));
    });
  }

  function renderDirectory(q = '') {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onSelectCounterparty = vi.fn();
    const result = render(
      <QueryClientProvider client={queryClient}>
        <CounterpartyDirectory q={q} onSelectCounterparty={onSelectCounterparty} />
      </QueryClientProvider>,
    );
    return { onSelectCounterparty, ...result };
  }

  it('groups names by link state without showing any balance', async () => {
    respondWith([linkedCounterparty, unlinkedCounterparty], () => null);
    const { container } = renderDirectory();

    expect(await screen.findByRole('heading', { name: '已連動（1）' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '未連動（1）' })).toBeInTheDocument();
    expect(screen.getByText('王小明')).toBeInTheDocument();
    expect(screen.getByText('（小明）')).toBeInTheDocument();
    expect(screen.getByText('連動')).toBeInTheDocument();
    expect(screen.getByText('林小安')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '邀請中' })).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent('$');
  });

  it('shows and cancels outgoing invites, and omits that section when none remain', async () => {
    const user = userEvent.setup();
    let pendingInvite: FriendRequest | null = outgoingInvite;
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/friend-requests/invite-1/cancel')) {
        expect(init?.method).toBe('POST');
        pendingInvite = null;
        return json(outgoingInvite);
      }
      if (url.includes('/friend-requests?direction=outgoing')) {
        return json({
          items: pendingInvite ? [pendingInvite] : [],
          page: 1,
          limit: 100,
          total: pendingInvite ? 1 : 0,
        });
      }
      if (url.includes('/counterparties')) {
        return json({ items: [], page: 1, limit: 100, total: 0 });
      }
      return Promise.reject(new Error(`未預期的請求：${url}`));
    });
    renderDirectory();

    expect(await screen.findByRole('heading', { name: '邀請中' })).toBeInTheDocument();
    expect(screen.getByText('lin@example.com')).toBeInTheDocument();
    expect(screen.getByText('還沒有對象')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '取消邀請' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: '邀請中' })).not.toBeInTheDocument();
      expect(screen.queryByText('lin@example.com')).not.toBeInTheDocument();
    });
    expect(fetchMock.mock.calls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.stringContaining('/friend-requests/invite-1/cancel'),
          expect.objectContaining({ method: 'POST' }),
        ]),
      ]),
    );
  });

  it('sends the current query and opens the selected person through its row button', async () => {
    const user = userEvent.setup();
    respondWith([unlinkedCounterparty], () => null);
    const { onSelectCounterparty } = renderDirectory('林');

    const row = await screen.findByRole('button', { name: '林小安' });
    await user.click(row);

    expect(onSelectCounterparty).toHaveBeenCalledWith('unlinked-1');
    expect(
      fetchMock.mock.calls.some(
        ([input]) => new URL(String(input), window.location.origin).searchParams.get('q') === '林',
      ),
    ).toBe(true);
  });

  it('shows the search reminder only when the server reports more than one hundred people', async () => {
    fetchMock.mockImplementation((input: string) => {
      const url = String(input);
      const body = url.includes('/counterparties')
        ? { items: [unlinkedCounterparty], page: 1, limit: 100, total: 101 }
        : { items: [], page: 1, limit: 100, total: 0 };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    renderDirectory();

    expect(await screen.findByText('用搜尋縮小範圍')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '林小安' })).toBeInTheDocument();
  });
});
