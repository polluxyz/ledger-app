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
 * 快取一致性：**任何**會改變交易的操作之後，帳戶餘額都必須跟著重取。
 *
 * 這三條測試刻意獨立成一檔。餘額是後端依交易算出來的，少了 `invalidateQueries`
 * 不會拋錯、不會讓其他測試變紅，只會讓首頁的數字停在舊值——沒有專屬案例釘住的話，
 * 這種問題會一路活到使用者面前。新增、編輯、刪除各有一條。
 */
describe('Writing a transaction refreshes account balances', () => {
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
  const category = { id: 'cat-1', name: '餐飲', type: 'EXPENSE' };
  const account = { id: 'acc-1', name: '現金', initialBalance: 5000, balance: 5000 };
  const lunch = {
    id: 'txn-1',
    type: 'EXPENSE',
    amount: 120,
    date: '2026-08-12T04:00:00.000Z',
    note: '午餐',
    category,
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

  /**
   * 每種寫入都讓餘額變成一個不同的數字，第二次請求 `/accounts` 才拿得到它。
   * 畫面上出現新數字＝快取真的失效並重取了。
   */
  function routeFetch(options: { items?: unknown[] } = {}) {
    const items = options.items ?? [];
    let balance = account.balance;

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';

      if (url.includes('/transactions') && method === 'POST') {
        balance = 4880;
        return Promise.resolve(jsonResponse(201, { ...lunch, id: 'txn-new' }));
      }
      if (url.includes('/transactions') && method === 'PATCH') {
        balance = 4800;
        return Promise.resolve(jsonResponse(200, { ...lunch, amount: 200 }));
      }
      if (url.includes('/transactions') && method === 'DELETE') {
        balance = 5120;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.includes('/transactions')) {
        return Promise.resolve(
          jsonResponse(200, { items, page: 1, limit: 20, total: items.length }),
        );
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

  /** 等首頁把餘額載出來，才知道「之後那次請求」確實是這次操作造成的。 */
  async function waitForInitialBalance(): Promise<number> {
    expect(await screen.findByLabelText('現金餘額')).toHaveTextContent('$5,000');
    return accountRequests();
  }

  async function expectRefetched(before: number, balance: string): Promise<void> {
    await waitFor(() => {
      expect(accountRequests()).toBeGreaterThan(before);
    });
    // 重取回來的新數字要真的出現在畫面上。
    expect(await screen.findByText(balance)).toBeInTheDocument();
  }

  it('asks for the balances again after a transaction is created', async () => {
    const user = userEvent.setup();
    routeFetch();

    render(<App />);
    const before = await waitForInitialBalance();

    await user.type(screen.getByLabelText('金額'), '120');
    await user.selectOptions(within(newTransactionForm()).getByLabelText('分類'), 'cat-1');
    await user.click(screen.getByRole('button', { name: '新增' }));

    await expectRefetched(before, '$4,880');
  });

  it('asks for the balances again after a transaction is edited', async () => {
    // 改金額就是改餘額。這條與「新增」那條同等重要，卻更容易被漏掉。
    const user = userEvent.setup();
    routeFetch({ items: [lunch] });

    render(<App />);
    const before = await waitForInitialBalance();

    await user.click(await screen.findByRole('button', { name: /^編輯/ }));
    const dialog = screen.getByRole('dialog');
    await user.clear(within(dialog).getByLabelText('金額'));
    await user.type(within(dialog).getByLabelText('金額'), '200');
    await user.click(within(dialog).getByRole('button', { name: '儲存' }));

    await expectRefetched(before, '$4,800');
  });

  it('asks for the balances again after a transaction is deleted', async () => {
    const user = userEvent.setup();
    routeFetch({ items: [lunch] });

    render(<App />);
    const before = await waitForInitialBalance();

    await user.click(await screen.findByRole('button', { name: /^刪除2026/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '刪除' }));

    await expectRefetched(before, '$5,120');
  });
});
