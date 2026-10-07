import type { CounterpartyLedgerPart, LedgerGroup } from '@ledger/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CounterpartyList } from './CounterpartyList';

/** 借還清單驗 API 總額、nonZero、展開來源、未指向群組與來源互動。 */
describe('CounterpartyList', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;
  let ledgerGroups: LedgerGroup[];

  const firstSource: CounterpartyLedgerPart = {
    ledgerId: 'ledger-hualien',
    ledgerName: '花蓮三日',
    personId: 'person-ming',
    personName: '明哥',
    amount: 300,
    left: false,
  };
  const leftSource: CounterpartyLedgerPart = {
    ledgerId: 'ledger-old-home',
    ledgerName: '老家',
    personId: 'person-old-home',
    personName: '小明',
    amount: -1500,
    left: true,
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
                ledgerParts: [firstSource, leftSource],
                link: { userId: 'user-ming', userName: '王小明', theirBalance: -900 },
              },
              {
                id: 'cp-2',
                name: '阿華',
                displayName: '阿華',
                askMerge: false,
                balance: -1100,
                totalBalance: -1100,
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
      return json({ items, page, limit: 20, total: 42 });
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  function renderList(onSelectCounterparty = vi.fn(), onOpenLedgerSource = vi.fn()) {
    render(
      <QueryClientProvider client={queryClient}>
        <CounterpartyList
          onSelectCounterparty={onSelectCounterparty}
          onOpenLedgerSource={onOpenLedgerSource}
        />
      </QueryClientProvider>,
    );
    return { onSelectCounterparty, onOpenLedgerSource };
  }

  it('shows API total balances and asks the server to omit two-cleared counterparties', async () => {
    renderList();

    expect(await screen.findByText('小明的暱稱欠你 $42')).toBeInTheDocument();
    expect(screen.getByText('你欠阿華 $11')).toBeInTheDocument();
    expect(screen.getByText('連動')).toBeInTheDocument();
    expect(screen.queryByText('兩清')).not.toBeInTheDocument();
    expect(screen.queryByText('老王')).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).match(/\/counterparties\?page=1&limit=20&nonZero=true$/),
      ),
    ).toBe(true);
  });

  it('opens the counterparty from the primary row button', async () => {
    const user = userEvent.setup();
    const { onSelectCounterparty } = renderList();

    await user.click(await screen.findByRole('button', { name: /^小明的暱稱/ }));

    expect(onSelectCounterparty).toHaveBeenCalledWith('cp-1');
  });

  it('expands API personal and ledger sources, including the exited label and signed arrows', async () => {
    const user = userEvent.setup();
    const { onSelectCounterparty, onOpenLedgerSource } = renderList();
    const toggle = await screen.findByRole('button', { name: '展開小明的暱稱的帳本來源' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(toggle);
    await user.keyboard('{Enter}');

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('個人往來')).toBeInTheDocument();
    expect(screen.getByText('小明的暱稱欠你 $9')).toBeInTheDocument();
    expect(screen.getByText('花蓮三日')).toBeInTheDocument();
    expect(screen.getByText('明哥欠你 $3')).toBeInTheDocument();
    expect(screen.getByText('老家')).toBeInTheDocument();
    expect(screen.getByText('已退出')).toBeInTheDocument();
    expect(screen.getByText('你欠小明 $15')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '開啟小明的暱稱的個人往來' }));
    expect(onSelectCounterparty).toHaveBeenCalledWith('cp-1');
    await user.click(screen.getByRole('button', { name: /開啟 花蓮三日 的結清/ }));
    expect(onOpenLedgerSource).toHaveBeenCalledWith(firstSource);
    expect(
      screen.getByRole('button', { name: /開啟已退出帳本 老家 的唯讀畫面/ }),
    ).toBeInTheDocument();
  });

  it('shows unpointed people under each API ledger group and preserves the source values', async () => {
    ledgerGroups = [
      {
        ledger: { id: 'ledger-unpointed', name: '花蓮三日', left: true },
        people: [
          {
            person: { id: 'person-hua', name: '小華', userId: null, status: 'GUEST' },
            amount: 139400,
            pointer: { counterpartyId: null, auto: false },
          },
        ],
      },
    ];
    const user = userEvent.setup();
    const { onOpenLedgerSource } = renderList();

    expect(await screen.findByRole('heading', { name: /花蓮三日.*已退出/ })).toBeInTheDocument();
    expect(screen.getByText('小華欠你 $1,394')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith('/ledger-groups?unpointed=true')),
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: /開啟已退出帳本 花蓮三日 的唯讀畫面/ }));

    await waitFor(() =>
      expect(onOpenLedgerSource).toHaveBeenCalledWith({
        ledgerId: 'ledger-unpointed',
        ledgerName: '花蓮三日',
        personId: 'person-hua',
        personName: '小華',
        amount: 139400,
        left: true,
      }),
    );
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
});
