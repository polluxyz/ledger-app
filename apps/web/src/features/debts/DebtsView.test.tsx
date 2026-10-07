import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerGroup } from '@ledger/shared';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { DebtsView } from './DebtsView';

/** DebtsView 負責借還提示與把對象選擇回報交易頁，不在這一層另算往來資料。 */
describe('DebtsView', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;
  let counterpartyItems: unknown[];
  let ledgerGroups: LedgerGroup[];
  let createdCounterparty: unknown;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    counterpartyItems = [
      {
        id: 'counterparty-1',
        name: '小明',
        displayName: '小明',
        askMerge: false,
        balance: 900,
        totalBalance: 900,
        ledgerParts: [],
        link: null,
        createdAt: '2026-09-01T04:00:00.000Z',
        updatedAt: '2026-09-01T04:00:00.000Z',
      },
    ];
    ledgerGroups = [];
    createdCounterparty = {
      id: 'counterparty-new',
      name: '小華',
      displayName: '小華',
      askMerge: false,
      balance: 0,
      totalBalance: 0,
      ledgerParts: [],
      link: null,
      createdAt: '2026-09-25T00:00:00.000Z',
      updatedAt: '2026-09-25T00:00:00.000Z',
    };
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const parsedUrl = new URL(url);
      const json = (body: unknown, status = 200) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (parsedUrl.pathname.endsWith('/ledger-groups')) {
        return json(ledgerGroups);
      }
      if (parsedUrl.pathname.endsWith('/counterparties') && init?.method === 'POST') {
        return json(createdCounterparty, 201);
      }
      return json({
        items: counterpartyItems,
        page: 1,
        limit: 20,
        total: counterpartyItems.length,
      });
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  function renderView(onSelectCounterparty = vi.fn()) {
    render(
      <MemoryRouter initialEntries={['/transactions?view=debts']}>
        <QueryClientProvider client={queryClient}>
          <DebtsView onSelectCounterparty={onSelectCounterparty} />
        </QueryClientProvider>
        <LocationProbe />
      </MemoryRouter>,
    );
    return onSelectCounterparty;
  }

  it('labels the view as not belonging to a ledger and opens the selected person', async () => {
    const user = userEvent.setup();
    const onSelectCounterparty = vi.fn();
    renderView(onSelectCounterparty);

    expect(screen.getByText('借還紀錄不分帳本')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /^小明/ }));
    expect(onSelectCounterparty).toHaveBeenCalledWith('counterparty-1');
  });

  it('shows the first-entry prompt when the API returns no counterparties', async () => {
    counterpartyItems = [];
    renderView();

    expect(
      await screen.findByText('還沒有借還紀錄，從『新增交易 → 借還』開始記第一筆'),
    ).toBeInTheDocument();
  });

  it('creates a counterparty from the header and opens its ledger', async () => {
    createdCounterparty = {
      id: 'counterparty-new',
      name: '小華',
      displayName: '小華',
      askMerge: false,
      balance: 0,
      totalBalance: 0,
      ledgerParts: [],
      link: null,
      createdAt: '2026-09-25T00:00:00.000Z',
      updatedAt: '2026-09-25T00:00:00.000Z',
    };
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

  it('opens a settle intent with the API group values for an active ledger', async () => {
    const user = userEvent.setup();
    ledgerGroups = [
      {
        ledger: { id: 'ledger-hualien', name: '花蓮三日', left: false },
        people: [
          {
            person: { id: 'person-ming', name: '明哥', userId: null, status: 'GUEST' },
            amount: -51200,
            pointer: { counterpartyId: null, auto: false },
          },
        ],
      },
    ];
    renderView();

    await user.click(await screen.findByRole('button', { name: /開啟 花蓮三日 的結清/ }));

    expect(JSON.parse(screen.getByTestId('location-state').textContent ?? '{}')).toEqual({
      pathname: '/transactions',
      search: '?view=settle',
      state: {
        settleIntent: { ledgerId: 'ledger-hualien', personId: 'person-ming', amount: -51200 },
      },
    });
  });

  it('opens history for an exited ledger source', async () => {
    const user = userEvent.setup();
    ledgerGroups = [
      {
        ledger: { id: 'ledger-old-home', name: '老家', left: true },
        people: [
          {
            person: { id: 'person-ming', name: '明哥', userId: null, status: 'GUEST' },
            amount: 51200,
            pointer: { counterpartyId: null, auto: false },
          },
        ],
      },
    ];
    renderView();

    await user.click(await screen.findByRole('button', { name: /唯讀畫面/ }));

    expect(JSON.parse(screen.getByTestId('location-state').textContent ?? '{}')).toEqual({
      pathname: '/ledgers/ledger-old-home/history',
      search: '',
      state: null,
    });
  });
});

function LocationProbe() {
  const location = useLocation();
  const state: unknown = location.state;
  return (
    <output data-testid="location-state">
      {JSON.stringify({
        pathname: location.pathname,
        search: location.search,
        state,
      })}
    </output>
  );
}
