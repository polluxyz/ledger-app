import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

/**
 * 首頁上有兩個「分類」下拉：新增表單一個、篩選列一個。查詢一律限縮在新增表單之內
 * ——fieldset 的 <legend> 就是它的無障礙名稱。
 */
const newTransactionForm = () => screen.getByRole('group', { name: '新增一筆交易' });

/**
 * 轉帳（SC-15）。轉帳沒有分類、必須有轉入帳戶，所有帳本都會影響帳戶餘額。
 */
describe('Recording a transfer', () => {
  const fetchMock = vi.fn();

  const ledger = {
    id: 'ledger-1',
    name: '我的帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    archivedAt: null,
    role: 'OWNER',
  };
  const expenseCategory = { id: 'cat-1', name: '餐飲', type: 'EXPENSE' };
  const cash = {
    id: 'acc-1',
    name: '現金',
    initialBalance: 0,
    balance: 100000,
    isTemporary: false,
    hasTransactions: true,
  };
  const bank = {
    id: 'acc-2',
    name: '國泰世華',
    initialBalance: 0,
    balance: 500000,
    isTemporary: false,
    hasTransactions: true,
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

  function routeFetch(overrides: { accounts?: unknown[]; ledger?: Record<string, unknown> } = {}) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/transactions') && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(201, {
            id: 'txn-new',
            type: 'TRANSFER',
            amount: 50000,
            date: '2026-08-25T04:00:00.000Z',
            note: null,
            category: null,
            account: { id: cash.id, name: cash.name },
            toAccount: { id: bank.id, name: bank.name },
            creator: { id: 'u1', name: 'Alice' },
            createdAt: '2026-08-25T04:00:00.000Z',
          }),
        );
      }
      if (url.includes('/transactions/marked')) {
        return Promise.resolve(jsonResponse(200, { items: [], page: 1, limit: 10, total: 0 }));
      }
      if (url.includes('/counterparties?')) {
        return Promise.resolve(jsonResponse(200, { items: [], page: 1, limit: 100, total: 0 }));
      }
      if (url.includes('/ledger-groups?unpointed=true')) {
        return Promise.resolve(jsonResponse(200, []));
      }
      if (url.includes('/friend-requests?') || url.includes('/debt-proposals?')) {
        return Promise.resolve(jsonResponse(200, { items: [], page: 1, limit: 20, total: 0 }));
      }
      if (url.includes('/statistics?')) {
        const ledgerId =
          url.split('/ledgers/')[1]?.split('/')[0] ??
          (typeof overrides.ledger?.id === 'string' ? overrides.ledger.id : ledger.id);
        return Promise.resolve(
          jsonResponse(200, {
            ledgerId,
            from: '2026-10-01',
            to: '2026-10-31',
            ledger: { income: 0, expense: 0, net: 0 },
            mine: { income: 0, expense: 0, net: 0 },
            expenseGroups: [],
            incomeGroups: [],
          }),
        );
      }
      if (url.includes('/transactions')) {
        return Promise.resolve(jsonResponse(200, { items: [], page: 1, limit: 20, total: 0 }));
      }
      if (url.includes('/categories')) {
        return Promise.resolve(jsonResponse(200, [expenseCategory]));
      }
      if (url.includes('/users/me/record-defaults')) {
        return Promise.resolve(jsonResponse(200, { ledgerId: ledger.id, accountId: cash.id }));
      }
      if (url.includes('/accounts/balance-trend')) {
        return Promise.resolve(jsonResponse(200, { months: [] }));
      }
      if (url.includes('/accounts')) {
        return Promise.resolve(jsonResponse(200, overrides.accounts ?? [cash, bank]));
      }
      return Promise.resolve(jsonResponse(200, [overrides.ledger ?? ledger]));
    });
  }

  it('swaps the category field for a destination account', async () => {
    const user = userEvent.setup();
    routeFetch();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '轉帳' }));

    // 轉帳沒有分類（「從銀行領錢」不屬於任何消費類別）。
    expect(within(newTransactionForm()).queryByLabelText('分類')).not.toBeInTheDocument();
    expect(screen.getByLabelText('轉出帳戶')).toBeInTheDocument();
    expect(screen.getByLabelText('轉入帳戶')).toBeInTheDocument();
  });

  it('sends toAccountId and no category', async () => {
    const user = userEvent.setup();
    routeFetch();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '轉帳' }));
    await user.type(screen.getByLabelText('金額'), '500');
    await user.click(screen.getByRole('button', { name: '新增' }));

    let posted: Record<string, unknown> = {};
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

    expect(posted.type).toBe('TRANSFER');
    // 兩個帳戶都要有，而且不能相同——預設挑第一個與轉出不同的帳戶。
    expect(posted.accountId).toBe('acc-1');
    expect(posted.toAccountId).toBe('acc-2');
    // 帶著分類會被後端擋成 400。
    expect(posted).not.toHaveProperty('categoryId');
  });

  it('offers transfer in every ledger', async () => {
    routeFetch({ ledger: { ...ledger, id: 'ledger-trip' } });

    render(<App />);

    expect(await screen.findByRole('button', { name: '支出' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '轉帳' })).toBeInTheDocument();
  });

  it('explains itself instead of failing when there is only one account', async () => {
    const user = userEvent.setup();
    routeFetch({ accounts: [cash] });

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '轉帳' }));

    // 讓使用者送出後才撞 400 TRANSFER_SAME_ACCOUNT 是不必要的。
    expect(screen.getByText(/轉帳需要兩個帳戶/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新增' })).toBeDisabled();
  });
});
