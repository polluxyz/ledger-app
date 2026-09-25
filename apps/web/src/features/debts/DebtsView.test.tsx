import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DebtsView } from './DebtsView';

/** DebtsView 負責借還提示與把對象選擇回報交易頁，不在這一層另算往來資料。 */
describe('DebtsView', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'counterparty-1',
                name: '小明',
                balance: 9,
                link: null,
                createdAt: '2026-09-01T04:00:00.000Z',
                updatedAt: '2026-09-01T04:00:00.000Z',
              },
            ],
            page: 1,
            limit: 20,
            total: 1,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  function renderView(onSelectCounterparty = vi.fn()) {
    render(
      <QueryClientProvider client={queryClient}>
        <DebtsView onSelectCounterparty={onSelectCounterparty} />
      </QueryClientProvider>,
    );
    return onSelectCounterparty;
  }

  it('labels the view as not belonging to a ledger and opens the selected person', async () => {
    const user = userEvent.setup();
    const onSelectCounterparty = vi.fn();
    renderView(onSelectCounterparty);

    expect(screen.getByText('借還紀錄不分帳本')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /小明/ }));
    expect(onSelectCounterparty).toHaveBeenCalledWith('counterparty-1');
  });

  it('shows the first-entry prompt when the API returns no counterparties', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ items: [], page: 1, limit: 20, total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    renderView();

    expect(
      await screen.findByText('還沒有借還紀錄，從『新增交易 → 借還』開始記第一筆'),
    ).toBeInTheDocument();
  });

  it('creates a counterparty from the header and opens its ledger', async () => {
    const created = {
      id: 'counterparty-new',
      name: '小華',
      balance: 0,
      link: null,
      createdAt: '2026-09-25T00:00:00.000Z',
      updatedAt: '2026-09-25T00:00:00.000Z',
    };
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (new URL(url).pathname.endsWith('/counterparties') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify(created), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'counterparty-1',
                name: '小明',
                balance: 9,
                link: null,
                createdAt: '2026-09-01T04:00:00.000Z',
                updatedAt: '2026-09-01T04:00:00.000Z',
              },
            ],
            page: 1,
            limit: 20,
            total: 1,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    });
    const user = userEvent.setup();
    const onSelectCounterparty = renderView();

    await user.click(screen.getByRole('button', { name: '＋ 新增' }));
    const dialog = screen.getByRole('dialog', { name: '新增一個人' });
    await user.type(within(dialog).getByLabelText('名字'), '小華');
    await user.click(within(dialog).getByRole('button', { name: '新增' }));

    await waitFor(() => expect(onSelectCounterparty).toHaveBeenCalledWith('counterparty-new'));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/counterparties$/),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: '小華' }) }),
    );
  });
});
