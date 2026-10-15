import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

/**
 * 交易頁上有兩個「分類」下拉：新增表單一個、篩選列一個。查詢一律限縮在新增表單之內
 * ——fieldset 的 <legend> 就是它的無障礙名稱。
 */
const newTransactionForm = () => screen.getByRole('group', { name: '新增一筆交易' });

async function selectFoodCategory(user: ReturnType<typeof userEvent.setup>) {
  const form = within(newTransactionForm());
  await user.click(form.getByRole('combobox', { name: '分類' }));
  await user.click(
    await within(form.getByRole('listbox', { name: '分類' })).findByRole('option', {
      name: '餐飲',
    }),
  );
}

/**
 * Slice 0 的核心流程測試（SC-3、SC-4）：已登入者在交易頁看到帳本交易，新增一筆後
 * 不必重整就出現在列表。以真實的 App 出發，只把 fetch 換成 mock。
 */
describe('Transactions on the transactions page', () => {
  const fetchMock = vi.fn();

  const ledger = {
    id: 'ledger-1',
    name: '我的帳本',
    currency: 'TWD',
    archivedAt: null,
    role: 'OWNER',
  };
  const expenseCategory = { id: 'cat-1', name: '餐飲', type: 'EXPENSE', icon: null };
  const account = {
    id: 'acc-1',
    name: '現金',
    initialBalance: 0,
    balance: 88000,
    isTemporary: false,
    hasTransactions: true,
  };
  const lunch = {
    id: 'txn-1',
    type: 'EXPENSE',
    amount: 12000,
    date: '2026-08-12T04:00:00.000Z',
    note: '午餐',
    category: expenseCategory,
    account: { id: account.id, name: account.name },
    toAccount: null,
    creator: { id: 'u1', name: 'Alice' },
    createdAt: '2026-08-12T04:00:00.000Z',
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    window.history.pushState({}, '', '/transactions');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** 依請求路徑回應，讓測試不必在意 react-query 的呼叫順序。 */
  function routeFetch(
    overrides: {
      transactions?: unknown;
      createResponse?: () => Response;
      /** 換一本帳本。 */
      ledger?: Record<string, unknown>;
    } = {},
  ) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/transactions') && init?.method === 'POST') {
        return Promise.resolve(
          overrides.createResponse?.() ?? jsonResponse(201, { ...lunch, id: 'txn-new' }),
        );
      }
      if (url.includes('/transactions')) {
        return Promise.resolve(
          jsonResponse(200, overrides.transactions ?? { items: [], page: 1, limit: 20, total: 0 }),
        );
      }
      if (url.includes('/categories')) {
        return Promise.resolve(jsonResponse(200, [expenseCategory]));
      }
      if (url.includes('/users/me/record-defaults')) {
        return Promise.resolve(
          jsonResponse(200, {
            ledgerId: (overrides.ledger?.id as string | undefined) ?? ledger.id,
            accountId: 'acc-1',
          }),
        );
      }
      // 帳戶是使用者範圍的頂層端點，路徑裡沒有帳本。
      if (url.includes('/accounts')) {
        return Promise.resolve(jsonResponse(200, [account]));
      }
      if (url.includes('/ledgers')) {
        return Promise.resolve(jsonResponse(200, [overrides.ledger ?? ledger]));
      }
      return Promise.resolve(jsonResponse(404, { message: 'not mocked' }));
    });
  }

  it('lists the ledger transactions', async () => {
    routeFetch({ transactions: { items: [lunch], page: 1, limit: 20, total: 1 } });

    render(<App />);

    const item = await screen.findByRole('listitem');
    expect(within(item).getByText('餐飲')).toBeInTheDocument();
    // 金額由 shared 以分格式化，整數元的畫面文字維持不變。
    expect(within(item).getByText('-$120')).toBeInTheDocument();
    expect(within(item).queryByText(/現金/)).not.toBeInTheDocument();
    expect(within(item).queryByText('午餐')).not.toBeInTheDocument();
  });

  it("shows no account for another member's transaction", async () => {
    // 共享帳本中，別人的帳戶會被後端遮成 null；列表只是不顯示，其餘照舊。
    const someoneElses = { ...lunch, account: null, creator: { id: 'u2', name: 'Bob' } };
    routeFetch({ transactions: { items: [someoneElses], page: 1, limit: 20, total: 1 } });

    render(<App />);

    const item = await screen.findByRole('listitem');
    expect(within(item).getByText('餐飲')).toBeInTheDocument();
    expect(within(item).queryByText(/現金/)).not.toBeInTheDocument();
  });

  it('shows a transfer without a sign and without a category', async () => {
    // 轉帳沒有分類，也不該顯示正負號——錢只是換了帳戶，沒有花掉也沒有賺到。
    const transfer = {
      ...lunch,
      type: 'TRANSFER',
      category: null,
      toAccount: { id: 'acc-2', name: '國泰世華' },
    };
    routeFetch({ transactions: { items: [transfer], page: 1, limit: 20, total: 1 } });

    render(<App />);

    const item = await screen.findByRole('listitem');
    expect(within(item).getByText('轉帳')).toBeInTheDocument();
    expect(within(item).getByText('$120')).toBeInTheDocument();
    expect(within(item).queryByText(/國泰世華/)).not.toBeInTheDocument();
  });

  it('colors a transfer neutrally instead of as income', async () => {
    // 原本只分「支出」與「其他」兩種顏色，轉帳因此被畫成收入的綠色，
    // 看起來像多了一筆錢。
    const transfer = {
      ...lunch,
      type: 'TRANSFER',
      category: null,
      toAccount: { id: 'acc-2', name: '國泰世華' },
    };
    routeFetch({ transactions: { items: [transfer], page: 1, limit: 20, total: 1 } });

    render(<App />);

    const amount = within(await screen.findByRole('listitem')).getByText('$120');
    expect(amount.className).toMatch(/transfer/);
    expect(amount.className).not.toMatch(/income/);
  });

  it('shows an empty state when there are no transactions', async () => {
    routeFetch();

    render(<App />);

    expect(await screen.findByText(/還沒有任何交易/)).toBeInTheDocument();
  });

  it('adds a transaction and refreshes the list without a reload', async () => {
    const user = userEvent.setup();
    // 這個案例不能用 routeFetch：要驗證「建立後列表自動重取」，交易清單必須
    // 隨著 `created` 改變回應內容。
    let created = false;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/transactions') && init?.method === 'POST') {
        created = true;
        return Promise.resolve(jsonResponse(201, lunch));
      }
      if (url.includes('/transactions')) {
        return Promise.resolve(
          jsonResponse(200, {
            items: created ? [lunch] : [],
            page: 1,
            limit: 20,
            total: created ? 1 : 0,
          }),
        );
      }
      if (url.includes('/categories')) {
        return Promise.resolve(jsonResponse(200, [expenseCategory]));
      }
      if (url.includes('/users/me/record-defaults')) {
        return Promise.resolve(jsonResponse(200, { ledgerId: ledger.id, accountId: account.id }));
      }
      if (url.includes('/accounts')) {
        return Promise.resolve(jsonResponse(200, [account]));
      }
      return Promise.resolve(jsonResponse(200, [ledger]));
    });

    render(<App />);

    // 等分類載入完成，下拉才有選項。
    expect(await screen.findByText(/還沒有任何交易/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('金額'), '120');
    await selectFoodCategory(user);
    await user.click(screen.getByRole('button', { name: '新增' }));

    // 列表自動重取，新的一筆出現。
    expect(await screen.findByRole('listitem')).toBeInTheDocument();

    const postCall = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    const body = JSON.parse((postCall?.[1] as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    // 輸入的元由 shared 解析成整數分後送出。
    expect(body.amount).toBe(12000);
    expect(body.type).toBe('EXPENSE');
    // 帳戶為必填：使用者沒動下拉，仍會帶上記帳預設帳戶。
    expect(body.accountId).toBe('acc-1');
  });

  it('surfaces a validation error from the backend', async () => {
    const user = userEvent.setup();
    routeFetch({
      createResponse: () =>
        jsonResponse(400, {
          statusCode: 400,
          errorCode: 'VALIDATION_FAILED',
          message: 'Validation failed',
          details: ['amount must be a positive number'],
        }),
    });

    render(<App />);

    expect(await screen.findByText(/還沒有任何交易/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('金額'), '1');
    await selectFoodCategory(user);
    await user.click(screen.getByRole('button', { name: '新增' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('amount must be a positive number');
  });

  // ── 所有帳本都需要帳戶（3h 決策 165） ─────────────────────────────────────

  it('requires an account in every ledger', async () => {
    const user = userEvent.setup();
    let posted: Record<string, unknown> = {};
    routeFetch({
      ledger: { ...ledger, id: 'ledger-trip', name: '出遊分帳' },
      createResponse: () =>
        jsonResponse(201, {
          ...lunch,
          id: 'txn-new',
          account: { id: account.id, name: account.name },
        }),
    });

    render(<App />);

    expect(await screen.findByText(/還沒有任何交易/)).toBeInTheDocument();
    expect(await screen.findByLabelText('帳戶')).toHaveValue('acc-1');

    await user.type(screen.getByLabelText('金額'), '123');
    await selectFoodCategory(user);
    await user.click(screen.getByRole('button', { name: '新增' }));

    await waitFor(() => {
      const created = fetchMock.mock.calls.find(
        (call) =>
          String(call[0]).includes('/transactions') &&
          (call[1] as RequestInit | undefined)?.method === 'POST',
      );
      expect(created).toBeDefined();
      const body = (created?.[1] as RequestInit | undefined)?.body;
      posted = JSON.parse(typeof body === 'string' ? body : '{}') as Record<string, unknown>;
    });
    expect(posted.accountId).toBe('acc-1');
  });

  it('keeps the account field in every ledger', async () => {
    routeFetch();

    render(<App />);

    expect(await screen.findByLabelText('帳戶')).toBeInTheDocument();
  });

  it('points at the accounts page when there are no selectable accounts', async () => {
    // 臨時帳戶不能手動選；沒有真正帳戶時記帳表單會引導去新增。
    routeFetch({
      ledger: { ...ledger, id: 'ledger-trip' },
    });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes('/accounts')) {
        return Promise.resolve(jsonResponse(200, []));
      }
      if (String(url).includes('/ledgers') && !String(url).includes('/transactions')) {
        return Promise.resolve(jsonResponse(200, [{ ...ledger, id: 'ledger-trip' }]));
      }
      if (String(url).includes('/users/me/record-defaults')) {
        return Promise.resolve(jsonResponse(200, { ledgerId: 'ledger-trip', accountId: 'acc-1' }));
      }
      if (String(url).includes('/categories')) {
        return Promise.resolve(jsonResponse(200, [expenseCategory]));
      }
      void init;
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, limit: 20, total: 0 }));
    });

    render(<App />);

    expect(await screen.findByText(/記帳前要先有一個帳戶/)).toBeInTheDocument();
    expect(screen.queryByLabelText('金額')).not.toBeInTheDocument();
  });
});
