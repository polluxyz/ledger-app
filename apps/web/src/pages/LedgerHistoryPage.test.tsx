import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

/**
 * 已退出帳本的唯讀頁：以 API mock 驗名稱、退出標籤、既有交易列呈現與無寫入入口。
 */
describe('Ledger history page', () => {
  const fetchMock = vi.fn();
  const ledger = {
    id: 'ledger-history',
    name: '旅行帳本',
    currency: 'TWD',
    kind: 'SHARED',
    tracksBalance: true,
    archivedAt: null,
    left: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    members: [],
  };
  const transaction = {
    id: 'txn-history',
    type: 'EXPENSE',
    amount: 12000,
    date: '2026-10-01T04:00:00.000Z',
    title: '晚餐',
    note: null,
    category: { id: 'cat-food', name: '餐飲', type: 'EXPENSE', icon: null },
    account: null,
    toAccount: null,
    creator: { id: 'user-1', name: 'Alice' },
    debt: null,
    split: null,
    payer: null,
    ledgerSplit: null,
    settlement: null,
    accountPending: true,
    createdAt: '2026-10-01T04:00:00.000Z',
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    window.history.pushState({}, '', '/ledgers/ledger-history/history');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      const json = (body: unknown, status = 200) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      if (url.endsWith('/users/me')) return json({ id: 'user-1', name: 'Alice' });
      if (url.includes('/ledgers/ledger-history/transactions')) {
        return json({ items: [transaction], page: 1, limit: 20, total: 1 });
      }
      if (url.endsWith('/ledgers/ledger-history')) return json(ledger);
      if (url.endsWith('/ledgers')) return json([]);
      return json([]);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the ledger name and exited tag with transactions and no write controls', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole('heading', { name: '旅行帳本' })).toBeInTheDocument();
    expect(screen.getByText('已退出')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/ledgers/ledger-history/transactions?page=1&limit=20'),
      expect.objectContaining({ method: 'GET' }),
    );

    const main = within(screen.getByRole('main'));
    const row = await main.findByRole('listitem');
    expect(within(row).getByText('餐飲')).toBeInTheDocument();
    expect(within(row).getByText('晚餐')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /編輯/ })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: '待補' })).not.toBeInTheDocument();
    expect(
      main.queryByRole('button', { name: /新增|編輯|刪除|結清|補帳戶/ }),
    ).not.toBeInTheDocument();

    await user.click(within(row).getByText('晚餐'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(main.getByRole('link', { name: '回到帳本列表' })).toHaveAttribute('href', '/ledgers');
  });

  it('uses the existing not-found message for a 404 ledger response', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/ledgers/ledger-history')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ statusCode: 404, errorCode: 'NOT_FOUND', message: 'Not found' }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    render(<App />);

    expect(await screen.findByText('找不到這本帳本。')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '回到帳本列表' })).toHaveLength(1);
    expect(screen.queryByText('旅行帳本')).not.toBeInTheDocument();
  });
});
