import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

/**
 * 轉帳（SC-15）。轉帳的欄位規則與支出／收入不同，因此獨立成一檔：
 * 沒有分類、必須有轉入帳戶、而且只在「與帳戶連動」的帳本才有意義。
 */
describe('Recording a transfer', () => {
  const fetchMock = vi.fn();

  const ledger = {
    id: 'ledger-1',
    name: '我的帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    tracksBalance: true,
    archivedAt: null,
    role: 'OWNER',
  };
  const expenseCategory = { id: 'cat-1', name: '餐飲', type: 'EXPENSE' };
  const cash = { id: 'acc-1', name: '現金', initialBalance: 0, balance: 1000 };
  const bank = { id: 'acc-2', name: '國泰世華', initialBalance: 0, balance: 5000 };

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
            amount: 500,
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
      if (url.includes('/transactions')) {
        return Promise.resolve(jsonResponse(200, { items: [], page: 1, limit: 20, total: 0 }));
      }
      if (url.includes('/categories')) {
        return Promise.resolve(jsonResponse(200, [expenseCategory]));
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
    expect(screen.queryByLabelText('分類')).not.toBeInTheDocument();
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

  it('offers no transfer at all in a ledger that does not track balances', async () => {
    // 那本帳本不影響餘額，轉帳沒有意義，後端也會回 400 ACCOUNT_NOT_ALLOWED。
    routeFetch({ ledger: { ...ledger, id: 'ledger-trip', tracksBalance: false } });

    render(<App />);

    expect(await screen.findByRole('button', { name: '支出' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '轉帳' })).not.toBeInTheDocument();
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
