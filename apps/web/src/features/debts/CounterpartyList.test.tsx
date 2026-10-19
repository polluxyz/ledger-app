import type { CounterpartyLedgerPart, LedgerGroup, LedgerSummary } from '@ledger/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { CounterpartyList } from './CounterpartyList';
import { useState } from 'react';

/** 借還清單驗兩種餘額來源、總覽唯讀展開與個人分頁的 API 篩選參數。 */
describe('CounterpartyList', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;
  let ledgerGroups: LedgerGroup[];
  const ledger: LedgerSummary = {
    id: 'ledger-1',
    name: '我的帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    archivedAt: null,
    role: 'OWNER',
    createdAt: '2026-09-01T00:00:00.000Z',
  };

  const firstSource: CounterpartyLedgerPart = {
    ledgerId: 'ledger-hualien',
    ledgerName: '花蓮三日',
    personId: 'person-ming',
    personName: '明哥',
    amount: 300,
  };
  const secondSource: CounterpartyLedgerPart = {
    ledgerId: 'ledger-old-home',
    ledgerName: '老家',
    personId: 'person-old-home',
    personName: '小明',
    amount: -1500,
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    ledgerGroups = [];
    fetchMock.mockImplementation((url: string) => {
      const parsedUrl = new URL(url);
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      if (parsedUrl.pathname.endsWith('/ledger-groups')) {
        return json(ledgerGroups);
      }
      if (parsedUrl.pathname.endsWith('/ledgers')) {
        return json([ledger]);
      }
      if (parsedUrl.pathname.endsWith('/accounts')) {
        return json([]);
      }
      if (parsedUrl.pathname.endsWith('/users/me/record-defaults')) {
        return json({ ledgerId: 'ledger-1', accountId: null });
      }

      const detailId = ['cp-1', 'cp-2'].find((id) =>
        parsedUrl.pathname.endsWith(`/counterparties/${id}`),
      );
      if (detailId) {
        const displayName = detailId === 'cp-1' ? '小明的暱稱' : '小華';
        const balance = detailId === 'cp-1' ? 900 : -1100;
        return json({
          id: detailId,
          name: displayName,
          displayName,
          askMerge: false,
          balance,
          totalBalance: balance,
          ledgerParts: detailId === 'cp-1' ? [firstSource, secondSource] : [],
          link: null,
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        });
      }
      if (/\/counterparties\/cp-[12]\/entries/.test(parsedUrl.pathname)) {
        return json({ items: [], page: 1, limit: 20, total: 0 });
      }

      const page = Number(parsedUrl.searchParams.get('page') ?? 1);
      const items =
        page === 1
          ? [
              {
                id: 'cp-1',
                name: '舊暱稱',
                displayName: '小明的暱稱',
                askMerge: false,
                balance: 900,
                totalBalance: 4200,
                ledgerParts: [firstSource, secondSource],
                link: { userId: 'user-ming', userName: '王小明', theirBalance: -900 },
              },
              {
                id: 'cp-2',
                name: '阿華',
                displayName: '小華',
                askMerge: false,
                balance: -1100,
                totalBalance: -1100,
                ledgerParts: [],
                link: null,
              },
              {
                id: 'cp-3',
                name: '清零的人',
                displayName: '清零的人',
                askMerge: false,
                balance: 0,
                totalBalance: 2500,
                ledgerParts: [],
                link: null,
              },
            ]
          : [
              {
                id: 'cp-4',
                name: '小美',
                displayName: '小美',
                askMerge: false,
                balance: 2000,
                totalBalance: 2500,
                ledgerParts: [],
                link: null,
              },
            ];
      const filteredItems =
        parsedUrl.searchParams.get('nonZero') === 'true'
          ? items.filter((item) => item.balance !== 0)
          : items;
      return json({ items: filteredItems, page, limit: 20, total: 42 });
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  function renderList(mode: 'overview' | 'personal' = 'overview') {
    function Harness() {
      const [expandedCounterpartyId, setExpandedCounterpartyId] = useState<string | null>(null);
      return (
        <CounterpartyList
          ledger={ledger}
          mode={mode}
          expandedCounterpartyId={expandedCounterpartyId}
          onExpandedChange={setExpandedCounterpartyId}
          onEditSplit={vi.fn()}
        />
      );
    }

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it('shows API total balances and asks the server to omit two-cleared counterparties', async () => {
    renderList();

    expect(await screen.findByText('小明的暱稱欠你 $42')).toBeInTheDocument();
    expect(screen.getByText('你欠小華 $11')).toBeInTheDocument();
    expect(screen.getByText('連動')).toBeInTheDocument();
    expect(screen.queryByText('兩清')).not.toBeInTheDocument();
    expect(screen.queryByText('老王')).not.toBeInTheDocument();
    expect(screen.queryByText('清零的人')).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).match(/\/counterparties\?page=1&limit=20&nonZero=true$/),
      ),
    ).toBe(true);
  });

  it('uses one-character labels that distinguish names across the displayed counterparty list', async () => {
    renderList();

    expect(await screen.findByTitle('小明的暱稱')).toHaveTextContent('明');
    expect(screen.getByTitle('小華')).toHaveTextContent('華');
  });

  it('toggles the inline detail from the primary row button', async () => {
    const user = userEvent.setup();
    renderList();

    const row = await screen.findByRole('button', { name: /^小明的暱稱/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(row).toHaveAttribute('aria-controls', 'counterparty-details-cp-1');
    expect(row).not.toHaveAttribute('aria-label');
    expect(
      screen.queryByRole('button', { name: '展開小明的暱稱的帳本來源' }),
    ).not.toBeInTheDocument();

    await user.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('heading', { name: '花蓮三日' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '共享帳本' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '往來紀錄' })).not.toBeInTheDocument();
    expect(screen.queryByText('個人往來')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '記一筆' })).not.toBeInTheDocument();

    await user.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: '花蓮三日' })).not.toBeInTheDocument(),
    );
  });

  it('keeps only one counterparty expanded and renders the API shared sources', async () => {
    const user = userEvent.setup();
    renderList();
    const firstRow = await screen.findByRole('button', { name: /^小明的暱稱/ });
    const secondRow = screen.getByRole('button', { name: /^小華/ });

    await user.click(firstRow);
    expect(await screen.findByRole('heading', { name: '花蓮三日' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '明哥欠你 $3' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '老家' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '你欠小明 $15' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /老家|花蓮三日/ })).not.toBeInTheDocument();

    await user.click(secondRow);
    expect(firstRow).toHaveAttribute('aria-expanded', 'false');
    expect(secondRow).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: '花蓮三日' })).not.toBeInTheDocument(),
    );
  });

  it('shows unpointed people under each API ledger group and preserves the source values', async () => {
    ledgerGroups = [
      {
        ledger: { id: 'ledger-unpointed', name: '花蓮三日' },
        people: [
          {
            person: { id: 'person-hua', name: '小華', userId: null, status: 'GUEST' },
            amount: 139400,
            pointer: { counterpartyId: null, auto: false },
          },
        ],
      },
    ];
    renderList();

    expect(await screen.findByRole('heading', { name: '花蓮三日' })).toBeInTheDocument();
    expect(screen.getByText('小華欠你 $1,394')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith('/ledger-groups?unpointed=true')),
    ).toBe(true);
    const unpointedGroup = screen.getByRole('region', { name: '沒指向的共享帳本' });
    expect(within(unpointedGroup).queryByRole('button')).not.toBeInTheDocument();
  });

  it('requests the next page through the shared pagination control', async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByRole('button', { name: /^小明的暱稱/ });
    await user.click(screen.getByRole('button', { name: '下一頁' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).match(/\/counterparties\?page=2&limit=20&nonZero=true$/),
        ),
      ).toBe(true),
    );
    expect(await screen.findByRole('button', { name: /^小美/ })).toBeInTheDocument();
  });

  it('uses personal balances, requests the server filter, and displays its response as given', async () => {
    renderList('personal');

    expect(await screen.findByText('小明的暱稱欠你 $9')).toBeInTheDocument();
    expect(screen.getByText('你欠小華 $11')).toBeInTheDocument();
    // API mock 故意回傳零餘額，確認列表照回應顯示，不在前端再過濾。
    expect(screen.getByRole('button', { name: /^清零的人/ })).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).match(/\/counterparties\?page=1&limit=20&personalNonZero=true$/),
      ),
    ).toBe(true);
  });
});
