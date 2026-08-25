import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

/**
 * 編輯與刪除交易（SC-10）。
 *
 * 查詢一律限縮在彈窗之內：首頁同時有「新增」表單與「編輯」彈窗，兩張表單的欄位
 * 標籤一模一樣，不縮小範圍會抓錯一個。
 */
describe('Editing and deleting a transaction', () => {
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

  /** 列表固定回傳一筆；`items` 可換成別的形狀（例如別人記的那一筆）。 */
  function routeFetch(overrides: { items?: unknown[] } = {}) {
    const items = overrides.items ?? [lunch];
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.includes('/transactions') && method === 'PATCH') {
        return Promise.resolve(jsonResponse(200, lunch));
      }
      if (url.includes('/transactions') && method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.includes('/transactions')) {
        return Promise.resolve(
          jsonResponse(200, { items, page: 1, limit: 20, total: items.length }),
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

  /** 找出送出的 PATCH body。 */
  async function patchedBody(): Promise<Record<string, unknown>> {
    let body: Record<string, unknown> = {};
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (entry) => (entry[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(call).toBeDefined();
      const raw = (call?.[1] as RequestInit | undefined)?.body;
      body = JSON.parse(typeof raw === 'string' ? raw : '{}') as Record<string, unknown>;
    });
    return body;
  }

  async function openEditor(): Promise<HTMLElement> {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^編輯/ }));
    return screen.getByRole('dialog');
  }

  it('prefills the dialog with the transaction', async () => {
    routeFetch();

    render(<App />);
    const dialog = await openEditor();

    expect(within(dialog).getByLabelText('金額')).toHaveValue(120);
    expect(within(dialog).getByLabelText('日期')).toHaveValue('2026-08-12');
    expect(within(dialog).getByLabelText('備註（選填）')).toHaveValue('午餐');
    expect(within(dialog).getByLabelText('分類')).toHaveValue('cat-1');
  });

  it('sends only a PATCH with the edited values', async () => {
    const user = userEvent.setup();
    routeFetch();

    render(<App />);
    const dialog = await openEditor();

    await user.clear(within(dialog).getByLabelText('金額'));
    await user.type(within(dialog).getByLabelText('金額'), '200');
    await user.click(within(dialog).getByRole('button', { name: '儲存' }));

    const body = await patchedBody();
    expect(body.amount).toBe(200);
    expect(body.categoryId).toBe('cat-1');
    expect(body.accountId).toBe('acc-1');
  });

  it('clears the note with an empty string, not by leaving it out', async () => {
    // PATCH 的 undefined 代表「不動」，所以清空備註只能靠空字串。
    const user = userEvent.setup();
    routeFetch();

    render(<App />);
    const dialog = await openEditor();

    await user.clear(within(dialog).getByLabelText('備註（選填）'));
    await user.click(within(dialog).getByRole('button', { name: '儲存' }));

    const body = await patchedBody();
    expect(body.note).toBe('');
  });

  it("locks the account field on another member's transaction", async () => {
    // 別人的帳戶被後端遮成 null，前端拿不到原值。若照新增模式那樣落到第一個帳戶，
    // 會把別人的交易悄悄搬到自己的戶頭——而且後端不會擋。
    const user = userEvent.setup();
    const someoneElses = { ...lunch, account: null, creator: { id: 'u2', name: 'Bob' } };
    routeFetch({ items: [someoneElses] });

    render(<App />);
    const dialog = await openEditor();

    expect(within(dialog).queryByLabelText('帳戶')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/這筆記在其他成員的帳戶/)).toBeInTheDocument();
    // 轉出沿用他的帳戶、轉入是我的——這種交易後端會接受，但沒有人是那個意思。
    expect(within(dialog).queryByRole('button', { name: '轉帳' })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '儲存' }));

    const body = await patchedBody();
    expect(body).not.toHaveProperty('accountId');
  });

  it('deletes a transaction after the confirmation', async () => {
    const user = userEvent.setup();
    let deleted = false;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.includes('/transactions') && method === 'DELETE') {
        deleted = true;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.includes('/transactions')) {
        return Promise.resolve(
          jsonResponse(200, {
            items: deleted ? [] : [lunch],
            page: 1,
            limit: 20,
            total: deleted ? 0 : 1,
          }),
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

    render(<App />);

    await user.click(await screen.findByRole('button', { name: /^刪除2026/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/刪除後無法復原/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '刪除' }));

    // 列表自動重取，那一筆消失。
    expect(await screen.findByText(/還沒有任何交易/)).toBeInTheDocument();
  });
});
