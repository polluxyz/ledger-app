import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { LedgerGroup, LedgerSummary } from '@ledger/shared';
import { MemoryRouter } from 'react-router-dom';
import { DebtsView } from './DebtsView';

/** DebtsView 負責個人分頁的新增入口與外部展開請求，不另算往來資料。 */
describe('DebtsView', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;
  let counterpartyItems: unknown[];
  let ledgerGroups: LedgerGroup[];
  let createdCounterparty: unknown;
  const ledger: LedgerSummary = {
    id: 'ledger-1',
    name: '我的帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    tracksBalance: false,
    archivedAt: null,
    role: 'OWNER',
    createdAt: '2026-09-01T00:00:00.000Z',
  };

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
      if (parsedUrl.pathname.endsWith('/counterparties/counterparty-1/entries')) {
        return json({ items: [], page: 1, limit: 20, total: 0 });
      }
      if (parsedUrl.pathname.endsWith('/counterparties/counterparty-1')) {
        return json(counterpartyItems[0]);
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

  function renderView(
    openCounterpartyId?: string | null,
    mode: 'overview' | 'personal' = 'personal',
  ) {
    function Harness() {
      const [expandedCounterpartyId, setExpandedCounterpartyId] = useState<string | null>(
        openCounterpartyId ?? null,
      );
      return (
        <DebtsView
          ledger={ledger}
          mode={mode}
          expandedCounterpartyId={expandedCounterpartyId}
          onExpandedChange={setExpandedCounterpartyId}
          openCounterpartyId={openCounterpartyId}
          onEditSplit={vi.fn()}
        />
      );
    }

    render(
      <MemoryRouter initialEntries={['/transactions?view=debts']}>
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it('omits personal add button and expands the selected person in place', async () => {
    const user = userEvent.setup();
    renderView();

    expect(screen.queryByRole('button', { name: '＋ 新增' })).not.toBeInTheDocument();
    const row = await screen.findByRole('button', { name: /^小明/ });
    await user.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('button', { name: '記一筆' })).toBeInTheDocument();
  });

  it('expands an externally requested person only when it appears in this page', async () => {
    renderView('counterparty-1');

    expect(await screen.findByRole('button', { name: /^小明/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(await screen.findByRole('button', { name: '記一筆' })).toBeInTheDocument();
  });

  it('leaves the list collapsed when an externally requested person is not on this page', async () => {
    renderView('counterparty-not-listed');

    const row = await screen.findByRole('button', { name: /^小明/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: '記一筆' })).not.toBeInTheDocument();
  });

  it('shows the first-entry prompt when the API returns no counterparties', async () => {
    counterpartyItems = [];
    renderView();

    expect(await screen.findByText('目前沒有個人往來。')).toBeInTheDocument();
  });

  it('shows the overview without the personal add action and keeps source rows read-only', async () => {
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
    renderView(undefined, 'overview');

    expect(await screen.findByRole('heading', { name: /老家.*已退出/ })).toBeInTheDocument();
    expect(screen.getByText('明哥欠你 $512')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '＋ 新增' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /老家|明哥/ })).not.toBeInTheDocument();
  });
});
