import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerSummary, Split } from '@ledger/shared';
import App from '../../App';
import { TransactionForm } from './TransactionForm';

/**
 * 交易表單驗證型別切換、帳戶與付款人切換、分帳送出及舊分帳編輯。
 *
 * 測試從真實 `TransactionForm` 出發，只把 API fetch 換成 mock；因此能同時驗證
 * 欄位狀態與送出的 request body，而不用啟動後端。
 *
 * 3b-1 加了第 4 格「借還」：新增模式固定多一格，方塊的寬度與位移照實際格數
 * 算（下面兩條釘住這件事）；編輯模式沒有那一格（借還交易不能編輯）。
 *
 * 策略：從真實的 `App` 出發，只把 `fetch` 換成 mock。表單住在右側欄，要先按
 * 「＋ 新增交易」才會出現，而且是 portal 進外殼的，所以一律用 `findBy*`。
 */
describe('TransactionForm', () => {
  const fetchMock = vi.fn();

  /** 連動帳本才畫得出轉帳鈕（見 TransactionForm 的 `canTransfer`）。 */
  const trackingLedger: LedgerSummary = {
    id: 'ledger-1',
    name: '我的帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    tracksBalance: true,
    archivedAt: null,
    role: 'OWNER',
    createdAt: '2026-09-01T00:00:00.000Z',
  };
  const plainLedger = { ...trackingLedger, id: 'ledger-2', tracksBalance: false };
  const category = { id: 'cat-1', name: '餐飲', type: 'EXPENSE', icon: null };
  const accounts = [
    { id: 'acc-1', name: '現金', initialBalance: 0, balance: 88000 },
    { id: 'acc-2', name: '銀行', initialBalance: 0, balance: 500000 },
  ];

  function routeFetch(ledger: typeof trackingLedger, options: { items?: unknown[] } = {}) {
    const items = options.items ?? [];
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const json = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.includes('/debts/summary')) {
        return json({ items: [] });
      }
      if (url.includes('/debts')) {
        return json({ items: [], page: 1, limit: 100, total: 0 });
      }
      if (url.includes('/counterparties') && init?.method === 'POST') {
        const requestBody =
          typeof init.body === 'string' ? (JSON.parse(init.body) as { name?: string }) : {};
        return json({ id: `new-${requestBody.name}`, displayName: requestBody.name });
      }
      if (url.includes('/counterparties')) {
        return json({
          items: [
            {
              id: 'cp-1',
              name: '小明',
              displayName: '小明',
              askMerge: false,
              balance: 1500,
              link: null,
              createdAt: '2026-09-01T00:00:00.000Z',
              updatedAt: '2026-09-01T00:00:00.000Z',
            },
          ],
          page: 1,
          limit: 100,
          total: 1,
        });
      }
      if (url.includes('/transactions')) {
        return json({ items, page: 1, limit: 20, total: items.length });
      }
      if (url.endsWith('/splits')) return json({ id: 'split-1' });
      if (url.includes('/categories')) {
        return json([category]);
      }
      if (url.includes('/accounts')) {
        return json(accounts);
      }
      return json([ledger]);
    });
  }

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    window.history.pushState({}, '', '/');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const WAIT = { timeout: 5000 };

  /** 按「新增交易」打開右側欄，回傳包住三顆型別鈕的那一條分段控制。 */
  async function openTypeBar(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: '新增交易' }, WAIT));
    const expense = await screen.findByRole('button', { name: '支出' }, WAIT);
    const bar = expense.parentElement;
    expect(bar).not.toBeNull();
    return bar as HTMLElement;
  }

  async function selectFoodCategory(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('combobox', { name: '分類' }));
    await user.click(
      await within(screen.getByRole('listbox', { name: '分類' })).findByRole(
        'option',
        { name: '餐飲' },
        WAIT,
      ),
    );
  }

  async function postedTransactionBody(): Promise<Record<string, unknown>> {
    let body: Record<string, unknown> = {};
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes('/transactions') &&
          (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(call).toBeDefined();
      const raw = (call?.[1] as RequestInit | undefined)?.body;
      body = JSON.parse(typeof raw === 'string' ? raw : '{}') as Record<string, unknown>;
    });
    return body;
  }

  async function postedBody(pathPart: string): Promise<Record<string, unknown>> {
    let body: Record<string, unknown> = {};
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes(pathPart) && (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(call).toBeDefined();
      const raw = (call?.[1] as RequestInit | undefined)?.body;
      body = JSON.parse(typeof raw === 'string' ? raw : '{}') as Record<string, unknown>;
    });
    return body;
  }

  async function patchedBody(pathPart: string): Promise<Record<string, unknown>> {
    let body: Record<string, unknown> = {};
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes(pathPart) && (init as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(call).toBeDefined();
      const raw = (call?.[1] as RequestInit | undefined)?.body;
      body = JSON.parse(typeof raw === 'string' ? raw : '{}') as Record<string, unknown>;
    });
    return body;
  }

  it('marks the pressed type and moves the mark when another type is picked', async () => {
    routeFetch(trackingLedger);
    const user = userEvent.setup();

    render(<App />);
    const bar = await openTypeBar(user);

    // 預設是支出。名稱與 aria-pressed 都不能因為改寫而變。
    expect(within(bar).getByRole('button', { name: '支出' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(bar).getByRole('button', { name: '收入' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await user.click(within(bar).getByRole('button', { name: '收入' }));

    // 同一時間只有一顆是按下的——三顆各自畫底色的年代這件事靠 variant，
    // 現在靠 aria-pressed 與那個滑動的方塊，狀態本身必須一模一樣。
    expect(within(bar).getByRole('button', { name: '收入' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(bar).getByRole('button', { name: '支出' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(bar).getByRole('button', { name: '轉帳' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('sizes the sliding mark by the number of buttons actually drawn', async () => {
    routeFetch(trackingLedger);
    const user = userEvent.setup();

    render(<App />);
    const bar = await openTypeBar(user);

    // 方塊是裝飾，螢幕閱讀器不該讀到它，也不該被當成第五顆按鈕。
    const mark = bar.querySelector('[aria-hidden="true"] > span');
    expect(mark).not.toBeNull();
    // 四格（支出／收入／轉帳／借還）：一格是 1/4 寬，停在第一格（支出）。
    expect(within(bar).getAllByRole('button')).toHaveLength(4);
    expect(mark).toHaveStyle({ width: `${100 / 4}%`, transform: 'translateX(0%)' });

    await user.click(within(bar).getByRole('button', { name: '轉帳' }));

    // 第三格＝往右兩格。位置用 transform 而不是 left，切換時才滑得動。
    expect(mark).toHaveStyle({ transform: 'translateX(200%)' });
  });

  it('falls back to two slots when the ledger has no transfers', async () => {
    // 非連動帳本沒有轉帳鈕，方塊的寬度要跟著格數變（支出／收入／借還＝三格），
    // 否則會蓋到隔壁。
    routeFetch(plainLedger);
    const user = userEvent.setup();

    render(<App />);
    const bar = await openTypeBar(user);

    expect(within(bar).queryByRole('button', { name: '轉帳' })).not.toBeInTheDocument();
    const mark = bar.querySelector('[aria-hidden="true"] > span');
    expect(mark).toHaveStyle({ width: `${100 / 3}%` });

    await user.click(within(bar).getByRole('button', { name: '收入' }));

    expect(mark).toHaveStyle({ transform: 'translateX(100%)' });
  });

  it('swaps the transaction fields for the debt entry form when 借還 is picked', async () => {
    routeFetch(trackingLedger);
    const user = userEvent.setup();

    render(<App />);
    const bar = await openTypeBar(user);

    // 第 4 格存在，預設沒選（spec 3b-1 W2）。
    const debtTab = within(bar).getByRole('button', { name: '借還' });
    expect(debtTab).toHaveAttribute('aria-pressed', 'false');

    await user.click(debtTab);

    expect(screen.getByRole('button', { name: '借還' })).toHaveAttribute('aria-pressed', 'true');
    // 借還分頁只有三種往來選項，交易欄位整個換掉。
    expect(await screen.findByRole('button', { name: '借出' }, WAIT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '借入' })).toBeInTheDocument();
    const debtKinds = screen.getByRole('group', { name: '往來種類' });
    expect(
      within(debtKinds)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['借出', '借入', '還款']);
    expect(screen.getByRole('button', { name: '還款' })).toBeDisabled();
    expect(screen.getByLabelText('對象')).toBeInTheDocument();
    expect(screen.queryByLabelText('分類')).not.toBeInTheDocument();
  });

  it('opens on 借還 and pre-fills the counterparty when an initial name is provided', () => {
    routeFetch(trackingLedger);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <TransactionForm ledger={trackingLedger} initialDebtCounterparty="小明" />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: '借還' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('對象')).toHaveValue('小明');
  });

  it('does not offer the 借還 tab in the edit dialog', async () => {
    // 借還交易不能進編輯表單（后端 409 DEBT_TRANSACTION_READ_ONLY），編輯模式的
    // 分段控制不出現那一格。
    const expense = {
      id: 'txn-1',
      type: 'EXPENSE',
      amount: 12000,
      date: '2026-08-12T04:00:00.000Z',
      note: '午餐',
      category,
      account: { id: 'acc-1', name: '現金' },
      toAccount: null,
      creator: { id: 'u1', name: 'Alice' },
      createdAt: '2026-08-12T04:00:00.000Z',
    };
    routeFetch(trackingLedger, { items: [expense] });
    window.history.pushState({}, '', '/transactions');
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^編輯/ }, WAIT));

    const dialog = await screen.findByRole('dialog', {}, WAIT);
    expect(within(dialog).queryByRole('button', { name: '借還' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '支出' })).toBeInTheDocument();
  });

  it('converts a decimal amount to cents before submitting', async () => {
    routeFetch(trackingLedger);
    const user = userEvent.setup();

    render(<App />);
    await openTypeBar(user);
    await user.type(screen.getByLabelText('金額'), '333.33');
    await selectFoodCategory(user);
    await user.click(screen.getByRole('button', { name: /^新增$/ }));

    expect(await postedTransactionBody()).toMatchObject({ amount: 33333 });
  });

  it('does not submit an amount with more than two decimal places', async () => {
    routeFetch(trackingLedger);
    const user = userEvent.setup();

    render(<App />);
    await openTypeBar(user);
    await user.type(screen.getByLabelText('金額'), '1.234');

    const submit = screen.getByRole('button', { name: /^新增$/ });
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).includes('/transactions') &&
          (init as RequestInit | undefined)?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('renders the expense fields in the specified order without optional markers', async () => {
    routeFetch(trackingLedger);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <TransactionForm ledger={trackingLedger} />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await screen.findByLabelText('帳戶', {}, WAIT);
    const labels = Array.from(container.querySelectorAll('form label'))
      .map((label) => label.textContent?.trim())
      .filter((label) => label !== undefined);
    expect(labels.slice(0, 2)).toEqual(['金額', '日期']);
    expect(screen.getByRole('combobox', { name: '分類' })).toBeInTheDocument();
    expect(labels.slice(2, 6)).toEqual(['帳戶', '名稱', '備註', '分帳']);
    expect(container.textContent).not.toContain('（選填）');
  });

  it('uses POST /splits for another payer and previews my full share when splitting is off', async () => {
    routeFetch(trackingLedger);
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <TransactionForm ledger={trackingLedger} />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await screen.findByLabelText('帳戶', {}, WAIT);
    await user.type(screen.getByLabelText('金額'), '750');
    await selectFoodCategory(user);
    await user.type(screen.getByLabelText('名稱'), '晚餐');
    await user.click(screen.getByRole('button', { name: '改為選付款人' }));
    const payer = screen.getByRole('combobox', { name: '付款人' });
    await user.type(payer, '小明');
    await user.click(await screen.findByRole('option', { name: '小明' }, WAIT));

    expect(screen.queryByRole('region', { name: '分帳' })).not.toBeInTheDocument();
    expect(screen.getByText('你欠小明 $750')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '改為選帳戶' }));
    expect(
      within(screen.getByRole('region', { name: '分帳' })).getByRole('checkbox', { name: '分帳' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '改為選付款人' }));
    const secondPayer = screen.getByRole('combobox', { name: '付款人' });
    await user.type(secondPayer, '小明');
    await user.click(await screen.findByRole('option', { name: '小明' }, WAIT));
    await user.click(screen.getByRole('button', { name: /^新增$/ }));

    const body = await postedBody('/splits');
    expect(body).toMatchObject({
      type: 'EXPENSE',
      categoryId: 'cat-1',
      title: '晚餐',
      total: 75000,
      payer: { counterpartyId: 'cp-1' },
      method: 'EQUAL',
      participants: [{ counterpartyId: null }],
    });
    expect(body).not.toHaveProperty('accountId');
  });

  it('starts the payer picker blank and never offers me', async () => {
    routeFetch(trackingLedger);
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <TransactionForm ledger={trackingLedger} />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await screen.findByLabelText('帳戶', {}, WAIT);
    await user.click(screen.getByRole('button', { name: '改為選付款人' }));
    const payer = screen.getByRole('combobox', { name: '付款人' });
    expect(payer).toHaveValue('');
    await user.click(payer);

    expect(await screen.findByRole('option', { name: '小明' }, WAIT)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '我' })).not.toBeInTheDocument();
  });

  it('keeps the split list when choosing another payer and restores the toggle on account mode', async () => {
    routeFetch(trackingLedger);
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <TransactionForm ledger={trackingLedger} />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await screen.findByLabelText('帳戶', {}, WAIT);
    await user.type(screen.getByLabelText('金額'), '3000');
    await selectFoodCategory(user);
    await user.click(screen.getByRole('checkbox', { name: '分帳' }));
    const addPerson = screen.getByRole('combobox', { name: '＋ 新增分帳對象' });
    await user.type(addPerson, '小明');
    await user.click(await screen.findByRole('option', { name: '小明' }, WAIT));

    await user.click(screen.getByRole('button', { name: '改為選付款人' }));
    const payer = screen.getByRole('combobox', { name: '付款人' });
    await user.type(payer, '小華');
    await user.click(await screen.findByRole('option', { name: '＋ 新增「小華」' }, WAIT));
    expect(screen.queryByRole('region', { name: '分帳' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '改為選帳戶' }));
    const splitSection = screen.getByRole('region', { name: '分帳' });
    expect(within(splitSection).getByRole('checkbox', { name: '分帳' })).toBeChecked();
    expect(within(splitSection).getAllByRole('listitem')).toHaveLength(2);
    expect(within(splitSection).getAllByRole('listitem')[1]).toHaveTextContent('小明');
    expect(within(splitSection).queryByText('小華')).not.toBeInTheDocument();
  });

  it('applies the blank recipient picker and one-person request to income', async () => {
    routeFetch(trackingLedger);
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <TransactionForm ledger={trackingLedger} />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await screen.findByLabelText('帳戶', {}, WAIT);
    await user.click(screen.getByRole('button', { name: '收入' }));
    await user.type(screen.getByLabelText('金額'), '750');
    await selectFoodCategory(user);
    await user.click(screen.getByRole('button', { name: '改為選收款人' }));
    const payee = screen.getByRole('combobox', { name: '收款人' });
    expect(payee).toHaveValue('');
    await user.click(payee);
    expect(await screen.findByRole('option', { name: '小明' }, WAIT)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '我' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: '小明' }));

    expect(screen.queryByRole('region', { name: '分帳' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^新增$/ }));

    expect(await postedBody('/splits')).toMatchObject({
      type: 'INCOME',
      total: 75000,
      payer: { counterpartyId: 'cp-1' },
      method: 'EQUAL',
      participants: [{ counterpartyId: null }],
    });
  });

  it('edits an older payer split using my share and saves it as one-person equal', async () => {
    routeFetch(trackingLedger);
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const legacySplit: Split = {
      id: 'split-legacy',
      type: 'EXPENSE',
      ledgerId: 'ledger-1',
      category: { id: 'cat-1', name: '餐飲' },
      total: 320000,
      date: '2026-08-12T04:00:00.000Z',
      title: '晚餐',
      note: null,
      payer: { counterpartyId: 'cp-1', name: '小明' },
      payerEntryId: null,
      account: null,
      method: 'EQUAL',
      precision: 'CENT',
      participants: [
        {
          counterpartyId: 'cp-1',
          name: '小明',
          share: 80000,
          ratio: null,
          entryId: null,
          sync: null,
        },
        {
          counterpartyId: 'cp-2',
          name: '小華',
          share: 80000,
          ratio: null,
          entryId: null,
          sync: null,
        },
        { counterpartyId: null, name: null, share: 80000, ratio: null, entryId: null, sync: null },
        {
          counterpartyId: 'cp-3',
          name: '阿美',
          share: 80000,
          ratio: null,
          entryId: null,
          sync: null,
        },
      ],
      createdAt: '2026-08-12T04:00:00.000Z',
      updatedAt: '2026-08-12T04:00:00.000Z',
    };

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <TransactionForm ledger={trackingLedger} split={legacySplit} />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await screen.findByLabelText('分類', {}, WAIT);
    expect(screen.getByLabelText('金額')).toHaveValue(800);
    expect(screen.queryByRole('region', { name: '分帳' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '儲存' }));

    expect(await patchedBody('/splits/split-legacy')).toMatchObject({
      total: 80000,
      payer: { counterpartyId: 'cp-1' },
      method: 'EQUAL',
      participants: [{ counterpartyId: null }],
    });
  });

  it('submits an equal split with the selected account and all four participants', async () => {
    routeFetch(trackingLedger);
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <TransactionForm ledger={trackingLedger} />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await screen.findByLabelText('帳戶', {}, WAIT);
    await user.type(screen.getByLabelText('金額'), '3000');
    await selectFoodCategory(user);
    await user.type(screen.getByLabelText('名稱'), '晚餐');
    await user.click(screen.getByRole('checkbox', { name: '分帳' }));
    const addPerson = screen.getByRole('combobox', { name: '＋ 新增分帳對象' });
    await user.type(addPerson, '小明');
    await user.click(await screen.findByRole('option', { name: '小明' }, WAIT));
    await user.type(addPerson, '小華');
    await user.click(await screen.findByRole('option', { name: '＋ 新增「小華」' }, WAIT));
    await user.type(addPerson, '阿美');
    await user.click(await screen.findByRole('option', { name: '＋ 新增「阿美」' }, WAIT));

    const splitSection = screen.getByRole('region', { name: '分帳' });
    const participants = within(splitSection).getAllByRole('listitem');
    expect(participants).toHaveLength(4);
    participants.forEach((participant) => {
      expect(within(participant).getByText('$750')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /^新增$/ }));

    const body = await postedBody('/splits');
    expect(body).toMatchObject({
      type: 'EXPENSE',
      categoryId: 'cat-1',
      title: '晚餐',
      total: 300000,
      accountId: 'acc-1',
      method: 'EQUAL',
    });
    expect(body.participants).toHaveLength(4);
    expect(body.participants).toEqual(
      expect.arrayContaining([
        { counterpartyId: null },
        { counterpartyId: 'cp-1' },
        { counterpartyId: 'new-小華' },
        { counterpartyId: 'new-阿美' },
      ]),
    );
  });
});
