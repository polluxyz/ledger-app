import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

/**
 * 篩選與分頁（SC-10）。
 *
 * 這一組測試釘的是「送出去的查詢字串對不對」——篩選、排序、分頁都由後端執行，
 * 前端不自行過濾拿到的那一頁（那樣算出來的結果只涵蓋當頁，是錯的）。
 */
describe('Filtering and paging the transaction list', () => {
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
  const account = { id: 'acc-1', name: '現金', initialBalance: 0, balance: 880 };
  const lunch = {
    id: 'txn-1',
    type: 'EXPENSE',
    amount: 120,
    date: '2026-08-12T04:00:00.000Z',
    note: null,
    category: expenseCategory,
    account: { id: account.id, name: account.name },
    toAccount: null,
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

  function routeFetch(options: { items?: unknown[]; total?: number } = {}) {
    const items = options.items ?? [lunch];
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/transactions')) {
        return Promise.resolve(
          jsonResponse(200, { items, page: 1, limit: 20, total: options.total ?? items.length }),
        );
      }
      if (url.includes('/categories')) {
        return Promise.resolve(jsonResponse(200, [expenseCategory]));
      }
      if (url.includes('/accounts')) {
        return Promise.resolve(jsonResponse(200, [account]));
      }
      return Promise.resolve(jsonResponse(200, [ledger]));
    });
  }

  /** 最後一次送出的交易列表請求，拆成查詢參數。 */
  function lastQuery(): URLSearchParams {
    const calls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/transactions'));
    const url = String(calls[calls.length - 1]?.[0] ?? '');
    return new URL(url, 'http://localhost').searchParams;
  }

  const filterBar = () => screen.getByRole('region', { name: '篩選交易' });

  it('asks the backend to filter by type', async () => {
    const user = userEvent.setup();
    routeFetch();

    render(<App />);
    await screen.findByRole('listitem');

    await user.selectOptions(within(filterBar()).getByLabelText('型別'), 'INCOME');

    await waitFor(() => {
      expect(lastQuery().get('type')).toBe('INCOME');
    });
  });

  it('takes the whole last day when an end date is given', async () => {
    // 後端是 date <= to。把 to 送成當天 00:00 的話，「篩到 8/25」會漏掉 8/25
    // 記的每一筆，而使用者只會覺得資料不見了。
    const user = userEvent.setup();
    routeFetch();

    render(<App />);
    await screen.findByRole('listitem');

    await user.type(within(filterBar()).getByLabelText('迄日'), '2026-08-25');

    await waitFor(() => {
      const to = lastQuery().get('to');
      expect(to).not.toBeNull();
      expect(new Date(to!).getHours()).toBe(23);
      expect(new Date(to!).getMinutes()).toBe(59);
    });
  });

  it('disables the category filter for transfers', async () => {
    const user = userEvent.setup();
    routeFetch();

    render(<App />);
    await screen.findByRole('listitem');

    await user.selectOptions(within(filterBar()).getByLabelText('型別'), 'TRANSFER');

    // 轉帳沒有分類。這裡用「停用」是對的：切回支出就恢復。
    expect(within(filterBar()).getByLabelText('分類')).toBeDisabled();
  });

  it('pages through the list', async () => {
    const user = userEvent.setup();
    routeFetch({ total: 45 });

    render(<App />);
    const pager = await screen.findByRole('navigation', { name: '分頁' });

    expect(within(pager).getByText('第 1 / 3 頁')).toBeInTheDocument();
    expect(within(pager).getByRole('button', { name: '上一頁' })).toBeDisabled();

    await user.click(within(pager).getByRole('button', { name: '下一頁' }));

    await waitFor(() => {
      expect(lastQuery().get('page')).toBe('2');
    });
  });

  it('returns to the first page whenever a filter changes', async () => {
    // 少了這件事，使用者會在「第 5 頁」看到空白，而畫面上沒有任何線索說明原因。
    const user = userEvent.setup();
    routeFetch({ total: 45 });

    render(<App />);
    const pager = await screen.findByRole('navigation', { name: '分頁' });
    await user.click(within(pager).getByRole('button', { name: '下一頁' }));
    await waitFor(() => {
      expect(lastQuery().get('page')).toBe('2');
    });

    await user.selectOptions(within(filterBar()).getByLabelText('型別'), 'EXPENSE');

    await waitFor(() => {
      expect(lastQuery().get('page')).toBe('1');
    });
  });

  it('says the filter found nothing, not that the ledger is empty', async () => {
    const user = userEvent.setup();
    routeFetch({ items: [] });

    render(<App />);
    expect(await screen.findByText(/還沒有任何交易/)).toBeInTheDocument();

    await user.selectOptions(within(filterBar()).getByLabelText('型別'), 'INCOME');

    expect(await screen.findByText('沒有符合條件的交易。')).toBeInTheDocument();
  });

  it('hides the pager when everything fits on one page', async () => {
    routeFetch({ total: 1 });

    render(<App />);
    await screen.findByRole('listitem');

    // 兩顆都停用的翻頁鈕只會讓人以為壞了。
    expect(screen.queryByRole('navigation', { name: '分頁' })).not.toBeInTheDocument();
  });
});
