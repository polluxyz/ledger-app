import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  Counterparty,
  DebtEntry,
  LedgerGroup,
  LedgerSummary,
  Transaction,
} from '@ledger/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DebtHistoryView } from './DebtHistoryView';

vi.mock('../auth/use-current-user', () => ({
  useCurrentUser: () => ({ data: { id: 'u-1' } }),
}));

/** 歷史分頁以 API mock 驗證後端篩選、分頁與結清的修改和撤銷流程。 */
describe('DebtHistoryView', () => {
  const fetchMock = vi.fn();
  const requests: { url: string; init?: RequestInit }[] = [];

  const currentLedger: LedgerSummary = {
    id: 'ledger-1',
    name: '我的帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    archivedAt: null,
    role: 'OWNER',
    createdAt: '2026-09-01T00:00:00.000Z',
  };

  const sharedLedger: LedgerSummary = {
    id: 'ledger-shared-1',
    name: '旅行帳本',
    currency: 'TWD',
    kind: 'SHARED',
    archivedAt: null,
    role: 'EDITOR',
    createdAt: '2026-09-01T00:00:00.000Z',
  };

  const counterpartyMing: Counterparty = {
    id: 'cp-ming',
    name: '小明',
    displayName: '小明',
    askMerge: false,
    balance: 0,
    totalBalance: 0,
    ledgerParts: [],
    link: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  const personMe = { id: 'p-me', name: '我', userId: 'u-1', status: 'MEMBER' as const };
  const personMing = { id: 'p-ming', name: '小明', userId: 'u-2', status: 'MEMBER' as const };

  const settlementTxn: Transaction = {
    id: 'txn-settle-1',
    type: 'TRANSFER',
    amount: 10000,
    date: '2026-09-02T00:00:00.000Z',
    title: null,
    note: null,
    category: null,
    account: null,
    toAccount: null,
    creator: { id: 'u-1', name: '我' },
    settlement: { id: 'set-1', from: personMing, to: personMe },
    debt: null,
    split: null,
    payer: null,
    ledgerSplit: null,
    accountPending: false,
    differenceOfId: null,
    difference: null,
    createdAt: '2026-09-02T00:00:00.000Z',
  };

  const secondSettlementTxn: Transaction = {
    ...settlementTxn,
    id: 'txn-settle-2',
    amount: 25000,
    date: '2026-09-01T00:00:00.000Z',
    settlement: { id: 'set-2', from: personMe, to: personMing },
  };

  function makeEntry(id: string, note: string): DebtEntry {
    return {
      id,
      counterpartyId: 'cp-ming',
      kind: 'COLLECT',
      delta: -5000,
      date: '2026-09-02T00:00:00.000Z',
      note,
      transactionId: 'txn-' + id,
      splitId: null,
      settlesEntryId: null,
      difference: null,
      balanceAfter: 0,
      sync: 'NONE',
      paired: false,
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
    };
  }

  function makeLedgerGroup(id = 'ledger-shared-1', name = '旅行帳本', left = false): LedgerGroup {
    return {
      ledger: { id, name, left },
      people: [],
      settlementCount: 1,
    };
  }

  let counterpartiesList: Counterparty[];
  let ledgerGroupsList: LedgerGroup[];
  let ledgersList: LedgerSummary[];
  let entriesByPage: Record<number, DebtEntry[]>;
  let entryTotal: number;
  let settlementsByPage: Record<number, Transaction[]>;
  let settlementTotal: number;

  function hasRequest(path: string, query: Record<string, string> = {}, method?: string) {
    return requests.some(({ url, init }) => {
      const parsed = new URL(String(url), 'http://localhost');
      return (
        parsed.pathname.endsWith(path) &&
        (method === undefined || init?.method === method) &&
        Object.entries(query).every(([key, value]) => parsed.searchParams.get(key) === value)
      );
    });
  }

  function renderHistory(onEditSplit = vi.fn()) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <DebtHistoryView ledger={currentLedger} onEditSplit={onEditSplit} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    requests.length = 0;
    counterpartiesList = [counterpartyMing];
    ledgerGroupsList = [makeLedgerGroup()];
    ledgersList = [currentLedger, sharedLedger];
    entriesByPage = { 1: [makeEntry('entry-1', '還清'), makeEntry('entry-2', '舊紀錄')] };
    entryTotal = 2;
    settlementsByPage = { 1: [settlementTxn] };
    settlementTotal = 1;

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      requests.push({ url, init });
      const parsed = new URL(String(url), 'http://localhost');
      const path = parsed.pathname;
      const page = Number(parsed.searchParams.get('page') ?? '1');
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      if (path.endsWith('/counterparties') && !path.includes('/entries')) {
        return json({
          items: counterpartiesList,
          page: 1,
          limit: 20,
          total: counterpartiesList.length,
        });
      }
      if (path.includes('/counterparties/') && path.endsWith('/entries')) {
        return json({
          items: entriesByPage[page] ?? [],
          page,
          limit: 20,
          total: entryTotal,
        });
      }
      if (path.endsWith('/ledger-groups')) {
        return json(ledgerGroupsList);
      }
      if (path.endsWith('/ledgers')) {
        return json(ledgersList);
      }
      if (path.endsWith('/people')) {
        return json([personMe, personMing]);
      }
      if (path.endsWith('/accounts')) {
        return json([]);
      }
      if (path.includes('/settlements') && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (path.includes('/settlements') && init?.method === 'PATCH') {
        return json(settlementTxn);
      }
      if (path.endsWith('/settlements')) {
        return json({
          items: settlementsByPage[page] ?? [],
          page,
          limit: 20,
          total: settlementTotal,
        });
      }
      return json([]);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads API-filtered personal and shared history, then expands both sections', async () => {
    const user = userEvent.setup();
    renderHistory();

    expect(await screen.findByRole('heading', { name: '個人往來' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '共享帳本' })).toBeInTheDocument();
    await waitFor(() => {
      expect(hasRequest('/counterparties', { hasHistory: 'true' })).toBe(true);
      expect(hasRequest('/ledger-groups', { hasSettlements: 'true' })).toBe(true);
    });

    const personRow = screen.getByRole('button', { name: '小明' });
    await user.click(personRow);
    expect(await screen.findByText('還清')).toBeInTheDocument();
    await waitFor(() => {
      expect(hasRequest('/counterparties/cp-ming/entries', { section: 'history', page: '1' })).toBe(
        true,
      );
    });
    expect(hasRequest('/ledgers/ledger-shared-1/transactions')).toBe(false);

    const ledgerRow = screen.getByRole('button', { name: '旅行帳本' });
    await user.click(ledgerRow);
    const settlementRow = (await screen.findByText('$100')).closest('li');
    expect(settlementRow).not.toBeNull();
    expect(
      within(settlementRow as HTMLElement).getByRole('button', { name: '更多操作' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(hasRequest('/ledgers/ledger-shared-1/settlements', { page: '1', limit: '20' })).toBe(
        true,
      );
    });
  });

  it('opens the settlement edit form and sends a PATCH request', async () => {
    const user = userEvent.setup();
    renderHistory();

    const ledgerRow = await screen.findByRole('button', { name: '旅行帳本' });
    await user.click(ledgerRow);
    const settlementRow = (await screen.findByText('$100')).closest('li') as HTMLElement;
    await user.click(within(settlementRow).getByRole('button', { name: '更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '修改' }));

    const amount = await screen.findByLabelText('金額');
    expect(screen.queryByRole('button', { name: '刪除' })).not.toBeInTheDocument();
    await user.clear(amount);
    await user.type(amount, '125');
    await user.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => {
      expect(hasRequest('/ledgers/ledger-shared-1/settlements/set-1', {}, 'PATCH')).toBe(true);
    });
    const patchRequest = requests.find(
      ({ url, init }) =>
        new URL(String(url), 'http://localhost').pathname.endsWith(
          '/ledgers/ledger-shared-1/settlements/set-1',
        ) && init?.method === 'PATCH',
    );
    const patchBody = patchRequest?.init?.body;
    if (typeof patchBody !== 'string') {
      throw new Error('PATCH 請求缺少 JSON body');
    }
    expect(JSON.parse(patchBody)).toMatchObject({
      fromPersonId: 'p-ming',
      toPersonId: 'p-me',
      amount: 12500,
    });
  });

  it('confirms and sends DELETE when a settlement is revoked', async () => {
    const user = userEvent.setup();
    renderHistory();

    const ledgerRow = await screen.findByRole('button', { name: '旅行帳本' });
    await user.click(ledgerRow);
    const settlementRow = (await screen.findByText('$100')).closest('li') as HTMLElement;
    await user.click(within(settlementRow).getByRole('button', { name: '更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '撤銷' }));
    expect(await screen.findByRole('heading', { name: '撤銷這筆？' })).toBeInTheDocument();
    expect(screen.queryByText('確定撤銷這筆結清？')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '撤銷' }));

    await waitFor(() => {
      expect(hasRequest('/ledgers/ledger-shared-1/settlements/set-1', {}, 'DELETE')).toBe(true);
    });
  });

  it('hides settlement actions for exited ledgers and VIEWER ledgers', async () => {
    const user = userEvent.setup();
    const viewerLedger = {
      ...sharedLedger,
      id: 'ledger-viewer',
      name: '唯讀旅行',
      role: 'VIEWER' as const,
    };
    ledgerGroupsList = [
      makeLedgerGroup('ledger-left', '已退出帳本', true),
      makeLedgerGroup(viewerLedger.id, viewerLedger.name),
    ];
    ledgersList = [currentLedger, viewerLedger];
    counterpartiesList = [];
    renderHistory();

    const exitedRow = await screen.findByRole('button', { name: '已退出帳本' });
    await user.click(exitedRow);
    expect(await screen.findByText('$100')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更多操作' })).not.toBeInTheDocument();

    const viewerRow = screen.getByRole('button', { name: '唯讀旅行' });
    await user.click(viewerRow);
    expect(await screen.findByText('$100')).toBeInTheDocument();
    expect(screen.getAllByText('$100')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '更多操作' })).not.toBeInTheDocument();
  });

  it('loads the second page for personal entries and shared settlements', async () => {
    const user = userEvent.setup();
    entriesByPage = { 1: [makeEntry('entry-1', '還清')], 2: [makeEntry('entry-2', '第二頁往來')] };
    entryTotal = 21;
    settlementsByPage = { 1: [settlementTxn], 2: [secondSettlementTxn] };
    settlementTotal = 21;
    renderHistory();

    await user.click(await screen.findByRole('button', { name: '小明' }));
    expect(await screen.findByText('還清')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '載入更多' }));
    expect(await screen.findByText('第二頁往來')).toBeInTheDocument();
    await waitFor(() => {
      expect(
        hasRequest('/counterparties/cp-ming/entries', {
          section: 'history',
          page: '2',
          limit: '20',
        }),
      ).toBe(true);
    });

    await user.click(screen.getByRole('button', { name: '旅行帳本' }));
    expect(await screen.findByText('$100')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '載入更多' }));
    expect(await screen.findByText('$250')).toBeInTheDocument();
    await waitFor(() => {
      expect(hasRequest('/ledgers/ledger-shared-1/settlements', { page: '2', limit: '20' })).toBe(
        true,
      );
    });
  });

  it('shows 沒有歷史紀錄 when both API sections are empty', async () => {
    counterpartiesList = [];
    ledgerGroupsList = [];
    ledgersList = [currentLedger];
    renderHistory();

    expect(await screen.findByText('沒有歷史紀錄')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '個人往來' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '共享帳本' })).not.toBeInTheDocument();
  });
});
