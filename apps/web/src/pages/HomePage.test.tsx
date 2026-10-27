import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { resetHomeCategoryColorsForTests } from '../app/use-home-category-colors';

/**
 * 首頁（phase 2k W260～W270、SC-H2～SC-H18）。從真實 App 與 QueryClient 出發，
 * 只替換 fetch；待處理卡、記帳表單、各 query 與右側欄都使用正式實作。
 */
describe('Home dashboard', () => {
  const fetchMock = vi.fn();

  const ledger = {
    id: 'ledger-1',
    name: '日常',
    currency: 'TWD',
    kind: 'PERSONAL',
    tracksBalance: true,
    archivedAt: null,
    role: 'OWNER',
  };
  const otherLedger = { ...ledger, id: 'ledger-2', name: '家用', kind: 'SHARED' };
  const foodCategory = { id: 'cat-1', name: '餐飲', type: 'EXPENSE', icon: null };
  const newCategory = { id: 'cat-new', name: '新增類', type: 'EXPENSE', icon: null };
  const account = {
    id: 'acc-1',
    name: '現金',
    initialBalance: 0,
    balance: 88000,
    isTemporary: false,
    hasTransactions: true,
  };
  let availableLedgers: Array<typeof ledger> = [ledger];
  let markedTransactions: Array<Record<string, unknown>> = [];
  let markedTotal = 0;
  let emptyMarksAfterCreate = false;
  let statisticsFailure = false;
  let balanceTrendFailure = false;
  let accountsFailure = false;
  let accountsPending = false;
  let accountsEmpty = false;
  let afterCreate = false;
  let createdTransaction: Record<string, unknown> | null = null;
  let accountBalance = account.balance;
  let counterpartBalance = 10000;
  let holdRefetches: Promise<void> | null = null;
  let releaseRefetches: (() => void) | null = null;
  let delayedRecentLedgerId: string | null = null;
  let delayedRecentResponse: Promise<Response> | null = null;
  let recentTransactionOverride: Array<Record<string, unknown>> | null = null;
  const createdRequests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const accountWriteRequests: string[] = [];

  function makeTransaction(
    ledgerId: string,
    index: number,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const isHome = ledgerId === otherLedger.id;
    return {
      id: `${isHome ? 'home' : 'daily'}-txn-${index}`,
      type: 'EXPENSE',
      amount: (100 + index) * 100,
      date: '2026-08-12T04:00:00.000Z',
      note: `備註 ${index}`,
      title: `交易 ${index}`,
      category: isHome ? { ...foodCategory, id: 'cat-home', name: '家用分類' } : foodCategory,
      account: { id: account.id, name: account.name },
      toAccount: null,
      creator: { id: 'u1', name: 'Alice' },
      debt: null,
      split: null,
      ledgerSplit: null,
      createdAt: '2026-08-12T04:00:00.000Z',
      marked: false,
      accountPending: false,
      ...overrides,
    };
  }

  const dailyTransactions = Array.from({ length: 7 }, (_, index) =>
    makeTransaction(ledger.id, index + 1),
  );
  const homeTransactions = Array.from({ length: 3 }, (_, index) =>
    makeTransaction(otherLedger.id, index + 1),
  );

  function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function endpointOf(input: unknown) {
    const url = new URL(String(input), 'http://localhost');
    return {
      url,
      path: url.pathname.replace(/^\/api/, ''),
    };
  }

  function countRequest(pathSuffix: string, params: Record<string, string> = {}) {
    return fetchMock.mock.calls.filter(([input]) => {
      const { url, path } = endpointOf(input);
      return (
        path.endsWith(pathSuffix) &&
        Object.entries(params).every(([key, value]) => url.searchParams.get(key) === value)
      );
    }).length;
  }

  function homeRequestSnapshot(ledgerId = ledger.id) {
    return {
      accounts: countRequest('/accounts'),
      balanceTrend: countRequest('/accounts/balance-trend'),
      counterparties: countRequest('/counterparties', { nonZero: 'true', limit: '5' }),
      mergePrompts: countRequest('/counterparties', { askMerge: 'true' }),
      ledgerGroups: countRequest('/ledger-groups', { unpointed: 'true' }),
      marked: countRequest('/transactions/marked'),
      recent: countRequest(`/ledgers/${ledgerId}/transactions`, { page: '1', limit: '5' }),
      statistics: countRequest(`/ledgers/${ledgerId}/statistics`),
      categories: countRequest(`/ledgers/${ledgerId}/categories`),
    };
  }

  function statisticsFor(ledgerId: string) {
    const shared = ledgerId === otherLedger.id;
    const multiplier = afterCreate && !shared ? 1 : 0;
    return {
      ledgerId,
      from: '2026-10-01',
      to: '2026-10-31',
      ledger: shared
        ? { expense: 120000, income: 20000, net: -100000 }
        : {
            expense: 70300 + multiplier * 10000,
            income: 5000000,
            net: 4929700 + multiplier * 10000,
          },
      mine: shared
        ? { expense: 45000, income: 20000, net: -25000 }
        : {
            expense: 70300 + multiplier * 10000,
            income: 5000000,
            net: 4929700 + multiplier * 10000,
          },
      expenseGroups: [
        {
          kind: 'CATEGORY',
          category: shared
            ? { id: 'cat-home', name: '家用分類', icon: null }
            : { id: foodCategory.id, name: foodCategory.name, icon: null },
          amount: shared ? 120000 : 70300 + multiplier * 10000,
          percentageBps: 10000,
        },
      ],
      incomeGroups: [],
      people: shared ? [] : null,
    };
  }

  function balanceTrend() {
    return {
      months: Array.from({ length: 12 }, (_, index) => ({
        month: `2025-${String(index + 1).padStart(2, '0')}`,
        total: 1000000 + index * 10000 + (afterCreate ? 500000 : 0),
      })),
    };
  }

  function transactionPage(ledgerId: string) {
    const items =
      recentTransactionOverride ??
      (ledgerId === otherLedger.id ? homeTransactions : dailyTransactions);
    return {
      items: createdTransaction && ledgerId === ledger.id ? [createdTransaction, ...items] : items,
      page: 1,
      limit: 5,
      total: items.length + (createdTransaction && ledgerId === ledger.id ? 1 : 0),
    };
  }

  function isRefreshEndpoint(path: string, url: URL) {
    return (
      path === '/accounts' ||
      path === '/accounts/balance-trend' ||
      path.endsWith('/statistics') ||
      (path === '/counterparties' &&
        (url.searchParams.has('nonZero') || url.searchParams.has('askMerge'))) ||
      path === '/ledger-groups' ||
      path === '/transactions/marked' ||
      /^\/ledgers\/[^/]+\/transactions$/.test(path)
    );
  }

  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/');
    resetHomeCategoryColorsForTests();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    availableLedgers = [ledger];
    markedTransactions = [];
    markedTotal = 0;
    emptyMarksAfterCreate = false;
    statisticsFailure = false;
    balanceTrendFailure = false;
    accountsFailure = false;
    accountsPending = false;
    accountsEmpty = false;
    afterCreate = false;
    createdTransaction = null;
    accountBalance = account.balance;
    counterpartBalance = 10000;
    holdRefetches = null;
    releaseRefetches = null;
    delayedRecentLedgerId = null;
    delayedRecentResponse = null;
    recentTransactionOverride = null;
    createdRequests.length = 0;
    accountWriteRequests.length = 0;
    dailyTransactions.forEach((transaction, index) => {
      Object.assign(transaction, makeTransaction(ledger.id, index + 1));
    });

    fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
      const { url, path } = endpointOf(input);
      const method = init?.method ?? 'GET';
      if (holdRefetches && method === 'GET' && isRefreshEndpoint(path, url)) {
        await holdRefetches;
      }
      if (
        method === 'GET' &&
        delayedRecentLedgerId !== null &&
        path === `/ledgers/${delayedRecentLedgerId}/transactions` &&
        delayedRecentResponse !== null
      ) {
        return delayedRecentResponse;
      }

      if (method === 'POST' && /^\/ledgers\/[^/]+\/transactions$/.test(path)) {
        const body =
          typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
        const ledgerId = path.split('/')[2] ?? ledger.id;
        createdRequests.push({ path, body });
        afterCreate = true;
        createdTransaction = makeTransaction(ledgerId, 99, {
          id: 'created-1',
          title: '剛新增',
          note: '剛新增',
          category: newCategory,
          amount: body.amount,
          createdAt: '2026-10-24T00:00:00.000Z',
        });
        if (emptyMarksAfterCreate) {
          markedTransactions = [];
          markedTotal = 0;
        } else {
          markedTransactions = [
            { ...createdTransaction, marked: true, ledger: { id: ledgerId, name: ledger.name } },
          ];
          markedTotal = 1;
        }
        accountBalance = 99000;
        counterpartBalance = 20000;
        return response(createdTransaction, 201);
      }

      if (path.endsWith('/mark') && (method === 'PUT' || method === 'DELETE')) {
        if (method === 'DELETE') {
          markedTransactions = [];
          markedTotal = 0;
        }
        return new Response(null, { status: 204 });
      }

      if (path.endsWith('/account') && method === 'PUT') {
        accountWriteRequests.push(path);
        return response({ transactionId: path.split('/').at(-2), account });
      }

      if (path.endsWith('/statistics')) {
        if (statisticsFailure) {
          return response(
            { statusCode: 400, errorCode: 'TEST', message: 'statistics failed' },
            400,
          );
        }
        const ledgerId = path.split('/')[2] ?? ledger.id;
        return response(statisticsFor(ledgerId));
      }
      if (path === '/accounts/balance-trend') {
        if (balanceTrendFailure) {
          return response(
            { statusCode: 400, errorCode: 'TEST', message: 'balance trend failed' },
            400,
          );
        }
        return response(balanceTrend());
      }
      if (path === '/accounts') {
        if (accountsFailure) {
          return response({ statusCode: 400, errorCode: 'TEST', message: 'accounts failed' }, 400);
        }
        if (accountsPending) return new Promise<Response>(() => {});
        if (accountsEmpty) return response([]);
        return response([{ ...account, balance: accountBalance }]);
      }
      if (path === '/counterparties') {
        if (url.searchParams.has('askMerge')) {
          return response({ items: [], page: 1, limit: 20, total: 0 });
        }
        return response({
          items: [
            {
              id: 'counterparty-1',
              displayName: '小明',
              balance: counterpartBalance,
              totalBalance: counterpartBalance,
            },
          ],
          page: 1,
          limit: 5,
          total: 1,
        });
      }
      if (path === '/ledger-groups') {
        return response(
          afterCreate
            ? [
                {
                  ledger: { id: otherLedger.id, name: otherLedger.name },
                  people: [{ person: { id: 'person-1', name: '小王' }, amount: 5000 }],
                },
              ]
            : [],
        );
      }
      if (path === '/transactions/marked') {
        const page = Number(url.searchParams.get('page') ?? 1);
        const limit = Number(url.searchParams.get('limit') ?? 10);
        const start = (page - 1) * limit;
        return response({
          items: markedTransactions.slice(start, start + limit),
          page,
          limit,
          total: markedTotal,
        });
      }
      if (path === '/friend-requests') {
        return response({ items: [], page: 1, limit: 20, total: 0 });
      }
      if (path === '/debt-proposals') {
        return response({ items: [], page: 1, limit: 20, total: 0 });
      }
      if (path === '/users/me/record-defaults') {
        return response({ ledgerId: ledger.id, accountId: account.id });
      }
      if (path === '/users/me') {
        return response({ id: 'u1', email: 'alice@example.test', name: 'Alice' });
      }
      if (path === '/ledgers') {
        return response(availableLedgers);
      }
      if (/^\/ledgers\/[^/]+\/transactions$/.test(path)) {
        const ledgerId = path.split('/')[2] ?? ledger.id;
        return response(transactionPage(ledgerId));
      }
      if (/^\/ledgers\/[^/]+\/categories$/.test(path)) {
        return response([foodCategory, newCategory]);
      }
      if (path.endsWith('/people')) {
        return response([]);
      }
      return response({});
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const WAIT = { timeout: 5000 };

  function signIn() {
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
  }

  async function recentRegion() {
    const region = await screen.findByRole('region', { name: '最近交易' }, WAIT);
    await waitFor(
      () => expect(within(region).queryByText('載入中…')).not.toBeInTheDocument(),
      WAIT,
    );
    return within(region);
  }

  async function waitForInitialHome() {
    await screen.findByRole('button', { name: '新增交易' }, WAIT);
    await screen.findByRole('link', { name: /本月支出/ }, WAIT);
    await recentRegion();
    await waitFor(() => {
      expect(countRequest('/accounts')).toBe(1);
      expect(countRequest('/accounts/balance-trend')).toBe(1);
      expect(countRequest('/counterparties', { nonZero: 'true', limit: '5' })).toBe(1);
      expect(countRequest('/counterparties', { askMerge: 'true' })).toBe(1);
      expect(countRequest('/ledger-groups', { unpointed: 'true' })).toBe(1);
      expect(countRequest('/transactions/marked')).toBe(1);
      expect(countRequest(`/ledgers/${ledger.id}/transactions`, { page: '1', limit: '5' })).toBe(1);
      expect(countRequest(`/ledgers/${ledger.id}/statistics`)).toBe(1);
    }, WAIT);
  }

  async function switchLedger(user: ReturnType<typeof userEvent.setup>, name: string) {
    const switcher = screen.getByRole('group', { name: '作用中帳本' });
    await user.click(within(switcher).getByRole('button'));
    await user.click(within(switcher).getByRole('option', { name: new RegExp(name) }));
  }

  async function chooseCategory(
    user: ReturnType<typeof userEvent.setup>,
    form: HTMLElement,
    name: string,
  ) {
    await user.click(within(form).getByRole('combobox', { name: '分類' }));
    await user.click(
      await within(within(form).getByRole('listbox', { name: '分類' })).findByRole('option', {
        name,
      }),
    );
  }

  it('keeps the guest home and avoids authenticated data requests', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findAllByText('$0')).toHaveLength(3);
    expect(screen.getByText(/登入後即可開始記帳/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '最近交易' })).not.toBeInTheDocument();
    expect(countRequest('/accounts')).toBe(0);
    expect(countRequest('/accounts/balance-trend')).toBe(0);
    expect(countRequest('/counterparties')).toBe(0);
    expect(countRequest('/transactions/marked')).toBe(0);

    await user.click(screen.getByRole('button', { name: '註冊' }));
    expect(await screen.findByRole('dialog', { name: '註冊' }, WAIT)).toBeInTheDocument();
  });

  it('uses one statistics response for the three totals and the category section', async () => {
    signIn();
    render(<App />);

    await waitForInitialHome();
    expect(screen.getByRole('link', { name: /本月支出/ })).toHaveTextContent('$703');
    expect(screen.getByRole('link', { name: /本月收入/ })).toHaveTextContent('$50,000');
    expect(screen.getByRole('link', { name: /結餘/ })).toHaveTextContent('$49,297');
    expect(screen.getByRole('link', { name: /本月支出/ })).not.toHaveTextContent('我 ');
    expect(screen.getByRole('list', { name: '支出分類' })).toHaveTextContent('餐飲');
    expect(countRequest(`/ledgers/${ledger.id}/statistics`)).toBe(1);
  });

  it('uses the Taiwan calendar month for the statistics request and stat links', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-31T16:30:00.000Z'));
    signIn();
    render(<App />);

    await waitForInitialHome();

    const request = fetchMock.mock.calls.find(([input]) =>
      endpointOf(input).path.endsWith('/statistics'),
    );
    expect(request).toBeDefined();
    const requestUrl = endpointOf(request?.[0]).url;
    expect(requestUrl.searchParams.get('from')).toBe('2026-04-01');
    expect(requestUrl.searchParams.get('to')).toBe('2026-04-30');

    for (const label of [/本月支出/, /本月收入/, /結餘/]) {
      const link = screen.getByRole('link', { name: label });
      expect(
        new URL(link.getAttribute('href')!, 'http://localhost').searchParams.get('month'),
      ).toBe('2026-04');
    }
  });

  it('shows shared-ledger totals and category names after switching while personal queries stay cached', async () => {
    const user = userEvent.setup();
    signIn();
    availableLedgers = [ledger, otherLedger];
    render(<App />);

    await waitForInitialHome();
    const personalCounts = homeRequestSnapshot();
    await switchLedger(user, '家用');

    expect(await screen.findByRole('link', { name: /本月支出.*1,200/ }, WAIT)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /本月支出/ })).toHaveTextContent('我 $450');
    expect(screen.getByRole('heading', { name: '本月支出 · 家用' })).toBeInTheDocument();
    expect(screen.getByLabelText('我的總資產 $11,100')).toBeInTheDocument();
    const recent = await recentRegion();
    expect(recent.getAllByRole('button', { name: /編輯.*家用分類/ })).toHaveLength(3);
    expect(countRequest(`/ledgers/${otherLedger.id}/statistics`)).toBe(1);
    expect(countRequest(`/ledgers/${otherLedger.id}/transactions`, { page: '1', limit: '5' })).toBe(
      1,
    );
    expect(homeRequestSnapshot()).toEqual(personalCounts);
  });

  it('keeps real PendingCard and TransactionWorkbench mounted without refetching personal data on ledger switch', async () => {
    const user = userEvent.setup();
    signIn();
    availableLedgers = [ledger, otherLedger];
    render(<App />);

    await waitForInitialHome();
    expect(await screen.findByRole('group', { name: '新增一筆交易' }, WAIT)).toBeInTheDocument();
    const before = homeRequestSnapshot();
    await switchLedger(user, '家用');
    await screen.findByRole('link', { name: /本月支出.*1,200/ }, WAIT);
    await recentRegion();
    await waitFor(() => {
      expect(countRequest(`/ledgers/${otherLedger.id}/statistics`)).toBe(1);
      expect(
        countRequest(`/ledgers/${otherLedger.id}/transactions`, { page: '1', limit: '5' }),
      ).toBe(1);
    }, WAIT);

    expect(homeRequestSnapshot()).toEqual(before);
    expect(screen.getByRole('group', { name: '新增一筆交易' })).toBeInTheDocument();
  });

  it('uses the default A+ card order, keeps trend total stable on hover, and removes 我的', async () => {
    const user = userEvent.setup();
    signIn();
    render(<App />);

    await waitForInitialHome();
    const layout = document.querySelector('[data-home-layout="tree"]');
    expect(
      Array.from(layout!.querySelectorAll<HTMLElement>('[data-home-card-id]')).map(
        (card) => card.dataset.homeCardId,
      ),
    ).toEqual(['expense', 'income', 'net', 'trend', 'categories', 'activity', 'accounts', 'debts']);
    expect(screen.queryByRole('heading', { name: '我的' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('總資產 $11,100')).toBeInTheDocument();

    const firstPoint = screen.getByRole('button', { name: '2025年1月 $10,000' });
    await user.hover(firstPoint);
    expect(screen.getByLabelText('總資產 $11,100')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /每月資產/ })).toHaveTextContent(
      '$10,000 · 2025年1月',
    );
  });

  it('does not leave an empty pending card on the home page', async () => {
    signIn();
    render(<App />);

    await waitForInitialHome();
    expect(screen.queryByRole('heading', { name: '待確認' })).not.toBeInTheDocument();
  });

  it('shows at most five compact rows in recent activity', async () => {
    signIn();
    render(<App />);

    const recent = await recentRegion();
    const rows = recent.getAllByRole('listitem');

    expect(rows).toHaveLength(5);
    expect(within(rows[0]!).getByText('交易 1')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('餐飲')).toBeInTheDocument();
    expect(rows[0]).not.toHaveTextContent('備註 1');
    expect(rows[0]).not.toHaveTextContent('現金');
    expect(recent.getByText('交易 5')).toBeInTheDocument();
    expect(recent.queryByText('交易 6')).not.toBeInTheDocument();
  });

  it('keeps home links and title actions while leaving filters and paging to the transactions page', async () => {
    signIn();
    availableLedgers = [ledger, otherLedger];
    render(<App />);

    await recentRegion();
    expect(screen.getByRole('link', { name: '查看全部' })).toHaveAttribute('href', '/transactions');
    expect(screen.getByRole('link', { name: '明細 →' }).getAttribute('href')).toMatch(
      /^\/stats\?tab=cat&ledger=/,
    );
    expect(screen.getByRole('link', { name: '全部 →' })).toHaveAttribute(
      'href',
      '/transactions?view=debts&tab=overview',
    );
    const accountSection = screen.getByRole('heading', { name: '帳戶' }).closest('section');
    expect(accountSection).not.toBeNull();
    expect(within(accountSection!).getByRole('link', { name: '管理' })).toHaveAttribute(
      'href',
      '/accounts',
    );

    const heading = screen.getByRole('heading', { name: '總覽' });
    const header = heading.closest('header');
    const addButton = await screen.findByRole('button', { name: '新增交易' }, WAIT);
    const switcher = screen.getByRole('group', { name: '作用中帳本' });
    expect(addButton.closest('header')).toBe(header);
    expect(switcher.closest('header')).toBe(header);
    expect(heading.compareDocumentPosition(addButton) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    );
    expect(screen.queryByRole('region', { name: '篩選交易' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '分頁' })).not.toBeInTheDocument();
  });

  it('shares the account query when the workbench form unmounts and mounts again', async () => {
    const user = userEvent.setup();
    signIn();
    render(<App />);

    await waitForInitialHome();
    expect(await screen.findByRole('group', { name: '新增一筆交易' }, WAIT)).toBeInTheDocument();
    expect(countRequest('/accounts')).toBe(1);

    const recent = await recentRegion();
    await user.click(recent.getAllByRole('button', { name: /^編輯/ })[0]!);
    expect(await screen.findByRole('dialog', { name: '編輯交易' }, WAIT)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '新增交易' }));
    expect(await screen.findByRole('group', { name: '新增一筆交易' }, WAIT)).toBeInTheDocument();
    expect(countRequest('/accounts')).toBe(1);
  });

  it('uses the LedgerView account query loading and error states', async () => {
    signIn();
    accountsFailure = true;
    render(<App />);

    await screen.findByRole('button', { name: '新增交易' }, WAIT);
    expect(await screen.findByText('帳戶暫時無法載入', {}, WAIT)).toBeInTheDocument();
    expect(countRequest('/accounts')).toBe(1);
    expect(screen.queryByRole('list', { name: '帳戶清單' })).not.toBeInTheDocument();
  });

  it('keeps the account loading state inside its own home card', async () => {
    signIn();
    accountsPending = true;
    render(<App />);

    const accountHeading = await screen.findByRole('heading', { name: '帳戶' }, WAIT);
    const accountCard = accountHeading.closest('section');
    expect(accountCard).not.toBeNull();
    expect(within(accountCard!).getByText('載入中…')).toBeInTheDocument();
    expect(countRequest('/accounts')).toBe(1);
  });

  it('keeps the account page link available when the account list is empty', async () => {
    signIn();
    accountsEmpty = true;
    render(<App />);

    await waitForInitialHome();
    const assets = screen.getByRole('heading', { name: '帳戶' }).closest('section');
    expect(assets).not.toBeNull();
    expect(within(assets!).getByText('還沒有帳戶。')).toBeInTheDocument();
    expect(within(assets!).getByRole('link', { name: '管理' })).toHaveAttribute(
      'href',
      '/accounts',
    );
  });

  it('does not show the old ledger recent rows while the new ledger request is pending', async () => {
    const user = userEvent.setup();
    signIn();
    availableLedgers = [ledger, otherLedger];
    let resolveRecent!: (value: Response) => void;
    const delayedRecent = new Promise<Response>((resolve) => {
      resolveRecent = resolve;
    });
    render(<App />);

    const recent = await recentRegion();
    expect(recent.getAllByRole('button', { name: /編輯.*餐飲/ })).toHaveLength(5);
    delayedRecentLedgerId = otherLedger.id;
    delayedRecentResponse = delayedRecent;
    await switchLedger(user, '家用');

    await waitFor(
      () => expect(countRequest(`/ledgers/${otherLedger.id}/transactions`)).toBe(1),
      WAIT,
    );
    expect(
      within(screen.getByRole('region', { name: '最近交易' })).getByText('載入中…'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: '最近交易' })).queryByRole('button', {
        name: /編輯.*餐飲/,
      }),
    ).not.toBeInTheDocument();

    resolveRecent(response(transactionPage(otherLedger.id)));
    delayedRecentLedgerId = null;
    delayedRecentResponse = null;
    expect(await screen.findAllByRole('button', { name: /編輯.*家用分類/ }, WAIT)).toHaveLength(3);
  });

  it('clears a right-panel target across A to B to A switches', async () => {
    const user = userEvent.setup();
    signIn();
    availableLedgers = [ledger, otherLedger];
    render(<App />);

    const recent = await recentRegion();
    await user.click(recent.getAllByRole('button', { name: /^編輯/ })[0]!);
    expect(await screen.findByRole('dialog', { name: '編輯交易' }, WAIT)).toBeInTheDocument();

    await switchLedger(user, '家用');
    expect(await screen.findByRole('group', { name: '新增一筆交易' }, WAIT)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '編輯交易' })).not.toBeInTheDocument();
    await switchLedger(user, '日常');
    expect(await screen.findByRole('group', { name: '新增一筆交易' }, WAIT)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '編輯交易' })).not.toBeInTheDocument();
  });

  it('opens an editor from a recent row and only collapses it when closed', async () => {
    const user = userEvent.setup();
    signIn();
    render(<App />);

    const recent = await recentRegion();
    await user.click(recent.getAllByRole('button', { name: /^編輯/ })[0]!);
    const panel = await screen.findByRole('dialog', { name: '編輯交易' }, WAIT);
    expect(within(panel).getByLabelText('金額')).toHaveValue(101);

    await user.click(within(panel).getByRole('button', { name: '關閉' }));
    await waitFor(() => {
      expect(document.querySelector('[data-registered]')).not.toHaveAttribute('data-open');
    }, WAIT);
    expect(screen.getByRole('dialog', { name: '編輯交易' }).closest('[inert]')).not.toBeNull();
    expect(screen.queryByRole('group', { name: '新增一筆交易' })).not.toBeInTheDocument();
  });

  it('opens a recent row editor with the keyboard', async () => {
    const user = userEvent.setup();
    signIn();
    render(<App />);

    const recent = await recentRegion();
    const row = recent.getAllByRole('button', { name: /^編輯.*餐飲/ })[0]!;
    row.focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('dialog', { name: '編輯交易' }, WAIT)).toBeInTheDocument();
  });

  it('edits linked debt rows from recent activity and leaves another persons debt read-only', async () => {
    const user = userEvent.setup();
    signIn();
    recentTransactionOverride = [
      makeTransaction(ledger.id, 1, {
        id: 'linked-debt',
        type: 'LEND',
        title: '借小明',
        category: null,
        debt: {
          entryId: 'entry-1',
          kind: 'LEND',
          counterpartyId: 'counterparty-1',
          counterpartyName: '小明',
          paired: false,
          note: null,
        },
      }),
      makeTransaction(ledger.id, 2, {
        id: 'other-debt',
        type: 'LEND',
        title: '他人借出',
        category: null,
        debt: null,
      }),
    ];
    render(<App />);

    const recent = await recentRegion();
    await user.click(recent.getByRole('button', { name: /^編輯.*借出/ }));
    expect(await screen.findByRole('dialog', { name: '編輯交易' }, WAIT)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '關閉' }));
    await waitFor(() => {
      expect(document.querySelector('[data-registered]')).not.toHaveAttribute('data-open');
    }, WAIT);

    await user.click(recent.getByText('借出', { exact: true }));
    expect(document.querySelector('[data-registered]')).not.toHaveAttribute('data-open');
  });

  it('switches to a marked transaction ledger before editing and keeps the target after a rerender', async () => {
    const user = userEvent.setup();
    signIn();
    availableLedgers = [ledger, otherLedger];
    markedTransactions = [
      {
        ...makeTransaction(otherLedger.id, 8, { id: 'marked-home', amount: 9900, marked: true }),
        ledger: { id: otherLedger.id, name: otherLedger.name },
      },
    ];
    markedTotal = 1;
    render(<App />);

    await waitForInitialHome();
    await user.click(screen.getByRole('tab', { name: '標註 1' }));
    const marked = screen.getByRole('region', { name: '標註' });
    expect(within(marked).getByText('家用')).toBeInTheDocument();
    await user.click(within(marked).getByRole('button', { name: /^編輯/ }));
    const dialog = await screen.findByRole('dialog', { name: '編輯交易' }, WAIT);
    expect(within(dialog).getByLabelText('金額')).toHaveValue(99);
    expect(localStorage.getItem('ledger.activeLedgerId')).toBe(otherLedger.id);

    await user.click(screen.getByRole('tab', { name: '最近' }));
    await user.click(screen.getByRole('tab', { name: '標註 1' }));
    expect(screen.getByRole('dialog', { name: '編輯交易' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('dialog', { name: '編輯交易' })).getByLabelText('金額'),
    ).toHaveValue(99);
  });

  it('keeps a cross-ledger fill-account intent and submits against the marked ledger', async () => {
    const user = userEvent.setup();
    signIn();
    availableLedgers = [ledger, otherLedger];
    markedTransactions = [
      {
        ...makeTransaction(otherLedger.id, 9, {
          id: 'marked-pending-account',
          amount: 12000,
          marked: true,
          account: null,
          accountPending: true,
        }),
        ledger: { id: otherLedger.id, name: otherLedger.name },
      },
    ];
    markedTotal = 1;
    render(<App />);

    await waitForInitialHome();
    await user.click(screen.getByRole('tab', { name: '標註 1' }));
    await user.click(
      within(screen.getByRole('region', { name: '標註' })).getByRole('button', {
        name: '臨時帳戶',
      }),
    );
    const fillDialog = await screen.findByRole('dialog', { name: '補帳戶' }, WAIT);
    expect(screen.queryByRole('dialog', { name: '編輯交易' })).not.toBeInTheDocument();
    expect(localStorage.getItem('ledger.activeLedgerId')).toBe(otherLedger.id);

    await user.click(screen.getByRole('tab', { name: '最近' }));
    await user.click(screen.getByRole('tab', { name: '標註 1' }));
    expect(screen.getByRole('dialog', { name: '補帳戶' })).toBeInTheDocument();
    await user.selectOptions(within(fillDialog).getByLabelText('帳戶'), account.id);
    await user.click(within(fillDialog).getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(accountWriteRequests).toHaveLength(1), WAIT);
    expect(accountWriteRequests[0]).toContain(
      `/ledgers/${otherLedger.id}/transactions/marked-pending-account/account`,
    );
  });

  it('keeps the add form contents through a same-ledger background refetch', async () => {
    const user = userEvent.setup();
    signIn();
    render(<App />);

    await waitForInitialHome();
    const accountRequests = countRequest('/accounts');
    const form = screen.getByRole('group', { name: '新增一筆交易' });
    const amount = within(form).getByLabelText('金額');
    const note = within(form).getByLabelText('備註');
    await user.type(amount, '321');
    await user.type(note, '保留內容');
    const recent = await recentRegion();
    await user.click(
      within(recent.getAllByRole('listitem')[0] as HTMLElement).getByRole('button', {
        name: /更多交易動作/,
      }),
    );
    await user.click(screen.getByRole('menuitem', { name: '標註' }));

    await waitFor(
      () =>
        expect(countRequest(`/ledgers/${ledger.id}/transactions`, { page: '1', limit: '5' })).toBe(
          2,
        ),
      WAIT,
    );
    expect(
      within(screen.getByRole('group', { name: '新增一筆交易' })).getByLabelText('金額'),
    ).toHaveValue(321);
    expect(
      within(screen.getByRole('group', { name: '新增一筆交易' })).getByLabelText('備註'),
    ).toHaveValue('保留內容');
    expect(countRequest('/accounts')).toBe(accountRequests + 1);
  });

  it('refetches each affected home endpoint once after a transaction write and keeps old values until responses arrive', async () => {
    const user = userEvent.setup();
    signIn();
    render(<App />);

    await waitForInitialHome();
    const before = homeRequestSnapshot();
    const totalBefore = fetchMock.mock.calls.length;
    holdRefetches = new Promise<void>((resolve) => {
      releaseRefetches = resolve;
    });

    await user.type(
      within(screen.getByRole('group', { name: '新增一筆交易' })).getByLabelText('金額'),
      '250',
    );
    await chooseCategory(user, screen.getByRole('group', { name: '新增一筆交易' }), '新增類');
    await user.click(
      within(screen.getByRole('group', { name: '新增一筆交易' })).getByRole('button', {
        name: '新增',
      }),
    );

    await waitFor(() => {
      expect(createdRequests).toHaveLength(1);
      const after = homeRequestSnapshot();
      expect(after.accounts).toBe(before.accounts + 1);
      expect(after.balanceTrend).toBe(before.balanceTrend + 1);
      expect(after.counterparties).toBe(before.counterparties + 1);
      expect(after.mergePrompts).toBe(before.mergePrompts + 1);
      expect(after.ledgerGroups).toBe(before.ledgerGroups + 1);
      expect(after.marked).toBe(before.marked + 1);
      expect(after.recent).toBe(before.recent + 1);
      expect(after.statistics).toBe(before.statistics + 1);
      expect(after.categories).toBe(before.categories + 1);
    }, WAIT);

    expect(screen.getByRole('link', { name: /本月支出/ })).toHaveTextContent('$703');
    expect(screen.getByLabelText('總資產 $11,100')).toBeInTheDocument();
    expect(screen.getByLabelText('小明欠你 $100')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '最近交易' })).toHaveTextContent('餐飲');
    expect(screen.queryByRole('tab', { name: '標註 1' })).not.toBeInTheDocument();

    const delta = fetchMock.mock.calls.length - totalBefore;
    // 總數為 POST 1 次、8 個首頁端點各 1 次、分類清單 1 次（4a W244）。
    expect(delta).toBe(10);
    releaseRefetches?.();
    holdRefetches = null;

    expect(await screen.findByRole('link', { name: /本月支出.*803/ }, WAIT)).toBeInTheDocument();
    expect(screen.getByLabelText('總資產 $16,100')).toBeInTheDocument();
    expect(await screen.findByLabelText('小明欠你 $200', {}, WAIT)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '最近交易' })).toHaveTextContent('新增類');
    expect(await screen.findByRole('tab', { name: '標註 1' }, WAIT)).toBeInTheDocument();
  });

  it('returns to Recent and moves focus there when the last mark is cancelled', async () => {
    const user = userEvent.setup();
    signIn();
    availableLedgers = [{ ...ledger, role: 'VIEWER' }];
    markedTransactions = [
      {
        ...makeTransaction(ledger.id, 1, { id: 'only-mark', marked: true }),
        ledger: { id: ledger.id, name: ledger.name },
      },
    ];
    markedTotal = 1;
    render(<App />);

    await waitForInitialHome();
    await user.click(screen.getByRole('tab', { name: '標註 1' }));
    const marked = screen.getByRole('region', { name: '標註' });
    await user.click(within(marked).getByRole('button', { name: /更多交易動作/ }));
    await user.click(screen.getByRole('menuitem', { name: '取消標註' }));

    await waitFor(
      () => expect(screen.queryByRole('tab', { name: /標註/ })).not.toBeInTheDocument(),
      WAIT,
    );
    const recentTab = screen.getByRole('tab', { name: '最近' });
    expect(recentTab).toHaveAttribute('aria-selected', 'true');
    expect(recentTab).toHaveFocus();
  });

  it('shows recent content with a valid tab label when marked disappears after a refetch', async () => {
    const user = userEvent.setup();
    signIn();
    markedTransactions = [
      {
        ...makeTransaction(ledger.id, 1, { id: 'only-mark', marked: true }),
        ledger: { id: ledger.id, name: ledger.name },
      },
    ];
    markedTotal = 1;
    emptyMarksAfterCreate = true;
    render(<App />);

    await waitForInitialHome();
    await user.click(screen.getByRole('tab', { name: '標註 1' }));
    expect(screen.getByRole('tab', { name: '標註 1' })).toHaveAttribute('aria-selected', 'true');

    const form = screen.getByRole('group', { name: '新增一筆交易' });
    await user.type(within(form).getByLabelText('金額'), '250');
    await chooseCategory(user, form, '新增類');
    await user.click(within(form).getByRole('button', { name: '新增' }));

    await waitFor(
      () => expect(screen.queryByRole('tab', { name: /標註/ })).not.toBeInTheDocument(),
      WAIT,
    );
    const recentTab = screen.getByRole('tab', { name: '最近' });
    const panel = screen.getByRole('tabpanel');
    expect(recentTab).toHaveAttribute('aria-selected', 'true');
    expect(panel).toHaveAttribute('aria-labelledby', 'home-recent-tab');
    const recentRegion = within(panel).getByRole('region', { name: '最近交易' });
    expect(recentRegion).toBeInTheDocument();
    expect(
      within(recentRegion).queryByRole('heading', { name: '最近交易' }),
    ).not.toBeInTheDocument();
  });

  it('supports tablist arrow navigation and roving tabindex', async () => {
    const user = userEvent.setup();
    signIn();
    markedTransactions = [
      {
        ...makeTransaction(ledger.id, 2, { id: 'marked-2', marked: true }),
        ledger: { id: ledger.id, name: ledger.name },
      },
    ];
    markedTotal = 1;
    render(<App />);

    await waitForInitialHome();
    const recent = screen.getByRole('tab', { name: '最近' });
    recent.focus();
    await user.keyboard('{ArrowRight}');
    const marked = screen.getByRole('tab', { name: '標註 1' });
    expect(marked).toHaveFocus();
    expect(marked).toHaveAttribute('aria-selected', 'true');
    expect(marked).toHaveAttribute('tabindex', '0');
    expect(recent).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{ArrowLeft}');
    expect(recent).toHaveFocus();
  });

  it('shows the marked total, first ten rows, and the remaining page on demand', async () => {
    const user = userEvent.setup();
    signIn();
    markedTransactions = Array.from({ length: 12 }, (_, index) => ({
      ...makeTransaction(ledger.id, index + 1, { id: `marked-${index + 1}`, marked: true }),
      ledger: { id: ledger.id, name: ledger.name },
    }));
    markedTotal = 12;
    render(<App />);

    await waitForInitialHome();
    await user.click(screen.getByRole('tab', { name: '標註 12' }));
    const marked = screen.getByRole('region', { name: '標註' });
    expect(within(marked).getAllByRole('listitem')).toHaveLength(10);
    await user.click(within(marked).getByRole('button', { name: '再 2 筆' }));
    await waitFor(() => expect(within(marked).getAllByRole('listitem')).toHaveLength(12), WAIT);
  });

  it('updates category colors immediately from settings without a request or ledger reset', async () => {
    const user = userEvent.setup();
    signIn();
    availableLedgers = [ledger, otherLedger];
    render(<App />);

    await waitForInitialHome();
    const requestsBefore = fetchMock.mock.calls.length;
    const swatch = screen
      .getByRole('list', { name: '支出分類' })
      .querySelector<HTMLSpanElement>('li span[aria-hidden="true"]');
    expect(swatch).not.toBeNull();
    const initialColor = swatch?.getAttribute('style');

    await user.click(await screen.findByRole('button', { name: 'Alice的選單' }, WAIT));
    await user.click(screen.getByRole('button', { name: '設定' }));
    const settings = within(screen.getByRole('dialog', { name: '設定' }));
    await user.click(settings.getByRole('radio', { name: '金色' }));

    expect(swatch?.style.getPropertyValue('--group-color')).toBe('var(--color-accent)');
    expect(swatch?.getAttribute('style')).not.toBe(initialColor);
    expect(fetchMock.mock.calls.length).toBe(requestsBefore);
    expect(localStorage.getItem('ledger.activeLedgerId')).toBe(ledger.id);
    expect(localStorage.getItem('ledger.homeCategoryColors')).toBe('gold');
  });

  it('keeps statistics errors local and shows the balance chart independently', async () => {
    signIn();
    statisticsFailure = true;
    render(<App />);

    await screen.findByRole('button', { name: '新增交易' }, WAIT);
    expect(await screen.findByRole('alert', {}, WAIT)).toHaveTextContent('統計暫時無法載入');
    expect(screen.getByRole('heading', { name: '帳戶' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '資產趨勢' })).toBeInTheDocument();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
  });

  it('shows a balance trend error without hiding the other home cards', async () => {
    signIn();
    balanceTrendFailure = true;
    render(<App />);

    await screen.findByRole('button', { name: '新增交易' }, WAIT);
    expect(await screen.findByText('資產暫時無法載入', {}, WAIT)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /本月支出/ })).toHaveTextContent('$703');
    expect(screen.getByRole('heading', { name: '借還' })).toBeInTheDocument();
  });

  it('shows the trend, pending card, and My cards without a ledger, with no ledger-specific query', async () => {
    signIn();
    availableLedgers = [];
    render(<App />);

    expect(await screen.findByText('找不到任何帳本。', {}, WAIT)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '帳戶' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '資產趨勢' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '借還' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '我的' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '支出分類' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '全部 →' })).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) => endpointOf(input).path.endsWith('/statistics')),
    ).toBe(false);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        /^\/ledgers\/[^/]+\/transactions$/.test(endpointOf(input).path),
      ),
    ).toBe(false);
  });
});
