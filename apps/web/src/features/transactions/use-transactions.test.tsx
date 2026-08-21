import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

/**
 * 快取一致性（D5）：記一筆帳之後，帳戶餘額必須跟著重取。
 *
 * 這條測試刻意獨立成一檔。餘額是後端依交易算出來的，少了 `invalidateQueries`
 * 不會拋錯、不會讓其他測試變紅，只會讓首頁的數字停在舊值——沒有專屬案例釘住的話，
 * 這種問題會一路活到使用者面前。
 */
describe('Creating a transaction refreshes account balances', () => {
  const fetchMock = vi.fn();

  const ledger = {
    id: 'ledger-1',
    name: '我的帳本',
    currency: 'TWD',
    tracksBalance: true,
    archivedAt: null,
    role: 'OWNER',
  };
  const category = { id: 'cat-1', name: '餐飲', type: 'EXPENSE' };
  const account = { id: 'acc-1', name: '現金', initialBalance: 5000, balance: 5000 };

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

  /** 記帳後餘額少 120：第二次請求 `/accounts` 才拿得到這個數字。 */
  function routeFetch() {
    let balance = account.balance;

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';

      if (url.includes('/transactions') && method === 'POST') {
        balance -= 120;
        return Promise.resolve(
          jsonResponse(201, {
            id: 'txn-new',
            type: 'EXPENSE',
            amount: 120,
            date: '2026-08-22T04:00:00.000Z',
            note: null,
            category,
            account: { id: account.id, name: account.name },
            toAccount: null,
            creator: { id: 'u1', name: 'Alice' },
            createdAt: '2026-08-22T04:00:00.000Z',
          }),
        );
      }
      if (url.includes('/transactions')) {
        return Promise.resolve(jsonResponse(200, { items: [], page: 1, limit: 20, total: 0 }));
      }
      if (url.includes('/categories')) {
        return Promise.resolve(jsonResponse(200, [category]));
      }
      if (url.includes('/accounts')) {
        return Promise.resolve(jsonResponse(200, [{ ...account, balance }]));
      }
      return Promise.resolve(jsonResponse(200, [ledger]));
    });
  }

  const accountRequests = () =>
    fetchMock.mock.calls.filter(
      (call) =>
        String(call[0]).includes('/accounts') &&
        ((call[1] as RequestInit | undefined)?.method ?? 'GET') === 'GET',
    ).length;

  it('asks for the balances again after the transaction is saved', async () => {
    const user = userEvent.setup();
    routeFetch();

    render(<App />);

    // 等首頁把餘額載出來，才知道「之後那次請求」確實是新增造成的。
    expect(await screen.findByLabelText('現金餘額')).toHaveTextContent('$5,000');
    const before = accountRequests();

    await user.type(screen.getByLabelText('金額'), '120');
    await user.selectOptions(screen.getByLabelText('分類'), 'cat-1');
    await user.click(screen.getByRole('button', { name: '新增' }));

    await waitFor(() => {
      expect(accountRequests()).toBeGreaterThan(before);
    });
    // 重取回來的新數字要真的出現在畫面上。
    expect(await screen.findByText('$4,880')).toBeInTheDocument();
  });
});
