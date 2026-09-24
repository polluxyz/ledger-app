import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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
});
