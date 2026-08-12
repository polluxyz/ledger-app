import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

/**
 * Slice 0 的核心流程測試（SC-3、SC-4）：已登入者看到帳本交易，新增一筆後
 * 不必重整就出現在列表。以真實的 App 出發，只把 fetch 換成 mock。
 */
describe('Transactions on the home page', () => {
  const fetchMock = vi.fn();

  const ledger = { id: 'ledger-1', name: '我的帳本', currency: 'TWD', role: 'OWNER' };
  const expenseCategory = { id: 'cat-1', name: '餐飲', type: 'EXPENSE' };
  const paymentMethod = { id: 'pm-1', name: '現金' };
  const lunch = {
    id: 'txn-1',
    type: 'EXPENSE',
    amount: 120,
    date: '2026-08-12T04:00:00.000Z',
    note: '午餐',
    category: expenseCategory,
    paymentMethod,
    creator: { id: 'u1', name: 'Alice' },
    createdAt: '2026-08-12T04:00:00.000Z',
  };

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

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** 依請求路徑回應，讓測試不必在意 react-query 的呼叫順序。 */
  function routeFetch(overrides: { transactions?: unknown } = {}) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/transactions') && init?.method === 'POST') {
        return Promise.resolve(jsonResponse(201, { ...lunch, id: 'txn-new' }));
      }
      if (url.includes('/transactions')) {
        return Promise.resolve(
          jsonResponse(200, overrides.transactions ?? { items: [], page: 1, limit: 20, total: 0 }),
        );
      }
      if (url.includes('/categories')) {
        return Promise.resolve(jsonResponse(200, [expenseCategory]));
      }
      if (url.includes('/payment-methods')) {
        return Promise.resolve(jsonResponse(200, [paymentMethod]));
      }
      if (url.includes('/ledgers')) {
        return Promise.resolve(jsonResponse(200, [ledger]));
      }
      return Promise.resolve(jsonResponse(404, { message: 'not mocked' }));
    });
  }

  it('lists the ledger transactions', async () => {
    routeFetch({ transactions: { items: [lunch], page: 1, limit: 20, total: 1 } });

    render(<App />);

    const item = await screen.findByRole('listitem');
    expect(within(item).getByText('餐飲')).toBeInTheDocument();
    // 金額直接以元顯示，不做任何換算。
    expect(within(item).getByText('-$120')).toBeInTheDocument();
    expect(within(item).getByText(/現金/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no transactions', async () => {
    routeFetch();

    render(<App />);

    expect(await screen.findByText(/還沒有任何交易/)).toBeInTheDocument();
  });

  it('adds a transaction and refreshes the list without a reload', async () => {
    const user = userEvent.setup();
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
      if (url.includes('/payment-methods')) {
        return Promise.resolve(jsonResponse(200, [paymentMethod]));
      }
      return Promise.resolve(jsonResponse(200, [ledger]));
    });

    render(<App />);

    // 等分類載入完成，下拉才有選項。
    expect(await screen.findByText(/還沒有任何交易/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('金額'), '120');
    await user.selectOptions(screen.getByLabelText('分類'), 'cat-1');
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
    // 金額原樣送出（整數、不換算）；未選付款方式時該欄位不送。
    expect(body.amount).toBe(120);
    expect(body.type).toBe('EXPENSE');
    expect(body.paymentMethodId).toBeUndefined();
  });

  it('surfaces a validation error from the backend', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/transactions') && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(400, {
            statusCode: 400,
            errorCode: 'VALIDATION_FAILED',
            message: 'Validation failed',
            details: ['amount must be a positive number'],
          }),
        );
      }
      if (url.includes('/transactions')) {
        return Promise.resolve(jsonResponse(200, { items: [], page: 1, limit: 20, total: 0 }));
      }
      if (url.includes('/categories')) {
        return Promise.resolve(jsonResponse(200, [expenseCategory]));
      }
      if (url.includes('/payment-methods')) {
        return Promise.resolve(jsonResponse(200, [paymentMethod]));
      }
      return Promise.resolve(jsonResponse(200, [ledger]));
    });

    render(<App />);

    expect(await screen.findByText(/還沒有任何交易/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('金額'), '0');
    await user.selectOptions(screen.getByLabelText('分類'), 'cat-1');
    await user.click(screen.getByRole('button', { name: '新增' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('amount must be a positive number');
  });
});
