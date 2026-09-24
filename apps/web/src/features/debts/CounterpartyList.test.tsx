import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CounterpartyList } from './CounterpartyList';

/** CounterpartyList 驗 API 分頁、餘額文字與整列按鈕的對象 id 回報。 */
describe('CounterpartyList', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    fetchMock.mockImplementation((url: string) => {
      const page = Number(new URL(url).searchParams.get('page') ?? 1);
      const items =
        page === 1
          ? [
              { id: 'cp-1', name: '小明', balance: 9 },
              { id: 'cp-2', name: '阿華', balance: -11 },
              { id: 'cp-3', name: '老王', balance: 0 },
            ]
          : [{ id: 'cp-4', name: '小美', balance: 20 }];
      return Promise.resolve(
        new Response(JSON.stringify({ items, page, limit: 20, total: 42 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  function renderList(onSelectCounterparty = vi.fn()) {
    render(
      <QueryClientProvider client={queryClient}>
        <CounterpartyList onSelectCounterparty={onSelectCounterparty} />
      </QueryClientProvider>,
    );
    return onSelectCounterparty;
  }

  it('uses API balance values for the three short balance labels', async () => {
    renderList();

    expect(await screen.findByText('欠我 $9')).toBeInTheDocument();
    expect(screen.getByText('我欠 $11')).toBeInTheDocument();
    expect(screen.getByText('兩清')).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/counterparties\?page=1&limit=20$/);
  });

  it('reports the clicked counterparty id from the whole row button', async () => {
    const user = userEvent.setup();
    const onSelectCounterparty = vi.fn();
    renderList(onSelectCounterparty);

    await user.click(await screen.findByRole('button', { name: /小明/ }));

    expect(onSelectCounterparty).toHaveBeenCalledWith('cp-1');
  });

  it('requests the next page with the shared pagination control', async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByRole('button', { name: /小明/ });
    await user.click(screen.getByRole('button', { name: '下一頁' }));

    await waitFor(() =>
      expect(String(fetchMock.mock.calls.at(-1)?.[0])).toMatch(
        /\/counterparties\?page=2&limit=20$/,
      ),
    );
    expect(await screen.findByRole('button', { name: /小美/ })).toBeInTheDocument();
  });
});
