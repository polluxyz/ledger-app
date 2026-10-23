import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParseTransactionResponse, TransactionDraft } from '@ledger/shared';
import { ApiError, apiRequest } from '../lib/api-client';
import App from '../App';

vi.mock('../lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');
  return { ...actual, apiRequest: vi.fn() };
});

const requestApi = vi.mocked(apiRequest);

const personalLedger = {
  id: 'ledger-1',
  name: '日常',
  currency: 'TWD',
  kind: 'PERSONAL',
  archivedAt: null,
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
};
const sharedLedger = {
  ...personalLedger,
  id: 'ledger-2',
  name: '旅行基金',
  kind: 'SHARED',
  role: 'EDITOR',
};
const accounts = [
  { id: 'acc-cash', name: '現金', initialBalance: 0, balance: 0, isTemporary: false },
  { id: 'acc-bank', name: '銀行', initialBalance: 0, balance: 0, isTemporary: false },
];
const me = { id: 'person-me', name: 'Alice', userId: 'user-1', status: 'MEMBER' };
const other = { id: 'person-other', name: '小明', userId: 'user-2', status: 'MEMBER' };

let parseResponses: Array<ParseTransactionResponse | Error> = [];
let transactionResponses: Array<Record<string, unknown> | Error> = [];
let transactionRequests: Array<{ path: string; body: Record<string, unknown> }> = [];

function parseBody(options?: { body?: unknown }): Record<string, unknown> {
  return (options?.body ?? {}) as Record<string, unknown>;
}

function makeDraft(overrides: Partial<TransactionDraft> = {}): TransactionDraft {
  return {
    ledgerId: personalLedger.id,
    type: 'EXPENSE',
    amount: 6000,
    date: '2026-10-23',
    title: '早餐',
    categoryId: 'cat-food',
    accountId: 'acc-cash',
    toAccountId: null,
    ...overrides,
  };
}

function configureApi() {
  requestApi.mockImplementation((path: string, options?: { method?: string; body?: unknown }) => {
    const method = options?.method ?? 'GET';
    if (path === '/ai/parse-transaction' && method === 'POST') {
      const response = parseResponses.shift() ?? { drafts: [] };
      if (response instanceof Error) return Promise.reject(response);
      return Promise.resolve(response);
    }
    if (path.includes('/transactions') && method === 'POST') {
      transactionRequests.push({ path, body: parseBody(options) });
      const response = transactionResponses.shift() ?? {
        id: `txn-${transactionRequests.length}`,
      };
      if (response instanceof Error) return Promise.reject(response);
      return Promise.resolve(response);
    }
    if (path.includes('/transactions')) {
      return Promise.resolve({ items: [], page: 1, limit: 20, total: 0 });
    }
    if (path === '/accounts') return Promise.resolve(accounts);
    if (path === '/users/me')
      return Promise.resolve({ id: 'user-1', email: 'alice@example.test', name: 'Alice' });
    if (path.includes('/users/me/record-defaults')) {
      const ledgerId = new URLSearchParams(path.split('?')[1]).get('ledgerId');
      return Promise.resolve({ ledgerId, accountId: 'acc-cash' });
    }
    if (path.endsWith('/people')) return Promise.resolve([me, other]);
    if (path.includes('/categories')) {
      return Promise.resolve([
        {
          id: path.includes('ledger-2') ? 'cat-travel' : 'cat-food',
          name: path.includes('ledger-2') ? '交通' : '早餐',
          type: 'EXPENSE',
        },
      ]);
    }
    if (path === '/ledgers?includeArchived=true')
      return Promise.resolve([personalLedger, sharedLedger]);
    if (path === '/ledgers') return Promise.resolve([personalLedger, sharedLedger]);
    return Promise.resolve([]);
  });
}

describe('AI drafts on the transactions page', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    window.history.pushState({}, '', '/transactions');
    parseResponses = [];
    transactionResponses = [];
    transactionRequests = [];
    configureApi();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const WAIT = { timeout: 5000 };

  async function parseDrafts(user: ReturnType<typeof userEvent.setup>, drafts: TransactionDraft[]) {
    parseResponses.push({ drafts });
    const input = await screen.findByRole('textbox', { name: '用一句話記帳' }, WAIT);
    await user.type(input, '早餐 60 現金');
    await user.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(
      () =>
        expect(screen.getAllByRole('button', { name: /^編輯草稿/ })).toHaveLength(drafts.length),
      WAIT,
    );
  }

  it('W208 places the input above the details and appends returned drafts', async () => {
    const user = userEvent.setup();
    parseResponses.push({ drafts: [makeDraft()] });
    render(<App />);

    const input = await screen.findByRole('textbox', { name: '用一句話記帳' }, WAIT);
    const details = await screen.findByText(
      '還沒有任何交易，從上方新增第一筆吧。',
      undefined,
      WAIT,
    );
    expect(input.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.type(input, '早餐 60 現金');
    await user.click(screen.getByRole('button', { name: '送出' }));

    expect(await screen.findByRole('button', { name: '確認草稿：早餐' }, WAIT)).toBeInTheDocument();
    const parseCall = requestApi.mock.calls.find(([path]) => path === '/ai/parse-transaction');
    expect(parseCall?.[1]?.body).toMatchObject({
      ledgerId: personalLedger.id,
      text: '早餐 60 現金',
    });
  });

  it('W210 confirms one complete draft, removes it only on success, and discards without writing', async () => {
    const user = userEvent.setup();
    render(<App />);
    await parseDrafts(user, [makeDraft(), makeDraft({ title: '午餐', amount: 12000 })]);

    await user.click(screen.getByRole('button', { name: '移除草稿：午餐' }));
    expect(screen.queryByRole('button', { name: '編輯草稿：午餐' })).not.toBeInTheDocument();
    expect(transactionRequests).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: '確認草稿：早餐' }));
    await waitFor(
      () =>
        expect(screen.queryByRole('button', { name: '編輯草稿：早餐' })).not.toBeInTheDocument(),
      WAIT,
    );
    expect(transactionRequests).toHaveLength(1);
    expect(transactionRequests[0]?.path).toBe('/ledgers/ledger-1/transactions');
  });

  it('W210 keeps a failed single confirmation and shows its row error', async () => {
    const user = userEvent.setup();
    render(<App />);
    await parseDrafts(user, [makeDraft({ title: '早餐' })]);
    transactionResponses.push(new ApiError(400, 'VALIDATION_ERROR', 'private error detail'));

    await user.click(screen.getByRole('button', { name: '確認草稿：早餐' }));

    const draftRow = screen.getByRole('button', { name: '編輯草稿：早餐' }).closest('li');
    expect(await within(draftRow!).findByRole('alert')).toHaveTextContent('寫入失敗，請稍後再試。');
    expect(screen.getByRole('button', { name: '編輯草稿：早餐' })).toBeInTheDocument();
    expect(screen.queryByText('private error detail')).not.toBeInTheDocument();
  });

  it('W211 writes complete A, skips incomplete B, stops when C fails, and retry does not write A again', async () => {
    const user = userEvent.setup();
    render(<App />);
    await parseDrafts(user, [
      makeDraft({ title: 'A' }),
      makeDraft({ title: 'B', categoryId: null }),
      makeDraft({ title: 'C' }),
      makeDraft({ title: 'D' }),
    ]);
    transactionResponses = [{ id: 'txn-A' }, new ApiError(400, 'VALIDATION_ERROR', 'safe failure')];

    await user.click(screen.getByRole('button', { name: '全部確認' }));
    await waitFor(
      () => expect(screen.getByRole('alert')).toHaveTextContent('寫入失敗，請稍後再試。'),
      WAIT,
    );
    expect(screen.queryByRole('button', { name: '編輯草稿：A' })).not.toBeInTheDocument();
    const failedDraft = screen.getByRole('button', { name: '編輯草稿：C' }).closest('li');
    expect(within(failedDraft!).getByRole('alert')).toHaveTextContent('寫入失敗，請稍後再試。');
    for (const title of ['B', 'C', 'D']) {
      expect(screen.getByRole('button', { name: `編輯草稿：${title}` })).toBeInTheDocument();
    }
    expect(transactionRequests.map((request) => request.body.title)).toEqual(['A', 'C']);

    await user.click(screen.getByRole('button', { name: '全部確認' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '編輯草稿：B' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '編輯草稿：C' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '編輯草稿：D' })).not.toBeInTheDocument();
    }, WAIT);
    expect(transactionRequests.map((request) => request.body.title)).toEqual(['A', 'C', 'C', 'D']);
    expect(
      transactionRequests.every(
        ({ body }) => !('payerPersonId' in body) && !('ledgerSplit' in body),
      ),
    ).toBe(true);
  }, 15000);

  it('W212 keeps null fields blank, switches drafts, uses the draft ledger, and starts shared entries without a split', async () => {
    const user = userEvent.setup();
    render(<App />);
    const emptyDraft = makeDraft({
      title: null,
      amount: null,
      date: null,
      categoryId: null,
      accountId: null,
    });
    const sharedDraft = makeDraft({
      ledgerId: sharedLedger.id,
      title: '計程車',
      amount: 25000,
      date: '2026-10-22',
      categoryId: 'cat-travel',
      accountId: 'acc-bank',
    });
    const transferDraft = makeDraft({
      type: 'TRANSFER',
      title: '轉帳',
      amount: 10000,
      date: '2026-10-21',
      categoryId: null,
      accountId: 'acc-cash',
      toAccountId: 'acc-bank',
    });
    await parseDrafts(user, [emptyDraft, sharedDraft, transferDraft]);

    await user.click(screen.getByRole('button', { name: '編輯草稿：名稱未提供' }));
    const form = await screen.findByRole('group', { name: '新增一筆交易' }, WAIT);
    expect(within(form).getByLabelText('金額')).toHaveValue(null);
    expect(within(form).getByLabelText('日期')).toHaveValue('');
    expect(within(form).getByLabelText('帳戶')).toHaveValue('');
    expect(within(form).getByLabelText('名稱')).toHaveValue('');
    expect(within(form).getByRole('combobox', { name: '分類' })).toHaveAttribute(
      'aria-valuetext',
      '請選擇分類',
    );
    expect(screen.getByRole('button', { name: '確認草稿：名稱未提供' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '全部確認' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '編輯草稿：轉帳' }));
    const transferForm = await screen.findByRole('group', { name: '新增一筆交易' }, WAIT);
    expect(within(transferForm).getByRole('button', { name: '轉帳' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(transferForm).getByLabelText('金額')).toHaveValue(100);
    expect(within(transferForm).getByLabelText('日期')).toHaveValue('2026-10-21');
    expect(within(transferForm).getByLabelText('轉出帳戶')).toHaveValue('acc-cash');
    expect(within(transferForm).getByLabelText('轉入帳戶')).toHaveValue('acc-bank');

    await user.click(screen.getByRole('button', { name: '編輯草稿：計程車' }));
    const sharedForm = await screen.findByRole('group', { name: '新增一筆交易' }, WAIT);
    await waitFor(
      () => expect(within(sharedForm).getByLabelText('日期')).toHaveValue('2026-10-22'),
      WAIT,
    );
    expect(within(sharedForm).getByLabelText('金額')).toHaveValue(250);
    expect(within(sharedForm).getByLabelText('帳戶')).toHaveValue('acc-bank');
    expect(within(sharedForm).getByLabelText('名稱')).toHaveValue('計程車');
    expect(within(sharedForm).getByRole('combobox', { name: '分類' })).toHaveAttribute(
      'aria-valuetext',
      '交通',
    );
    expect(
      within(screen.getByRole('region', { name: '分帳' })).getByRole('checkbox', { name: '分帳' }),
    ).not.toBeChecked();

    await user.click(within(sharedForm).getByRole('button', { name: '新增' }));
    await waitFor(() => expect(transactionRequests).toHaveLength(1), WAIT);
    expect(transactionRequests[0]).toMatchObject({
      path: '/ledgers/ledger-2/transactions',
      body: {
        type: 'EXPENSE',
        amount: 25000,
        date: '2026-10-22T00:00:00.000Z',
        accountId: 'acc-bank',
      },
    });
    expect(transactionRequests[0]?.body).not.toHaveProperty('payerPersonId');
    expect(transactionRequests[0]?.body).not.toHaveProperty('ledgerSplit');
    expect(screen.queryByRole('button', { name: '編輯草稿：計程車' })).not.toBeInTheDocument();
  });

  it('W212 keeps a draft after closing and after a failed form write', async () => {
    const user = userEvent.setup();
    render(<App />);
    await parseDrafts(user, [makeDraft({ amount: 8000 })]);

    await user.click(screen.getByRole('button', { name: '編輯草稿：早餐' }));
    let form = await screen.findByRole('group', { name: '新增一筆交易' }, WAIT);
    await user.clear(within(form).getByLabelText('金額'));
    await user.type(within(form).getByLabelText('金額'), '99');
    await user.click(screen.getByRole('button', { name: '收起新增面板' }));
    expect(screen.getByRole('button', { name: '編輯草稿：早餐' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '編輯草稿：早餐' }));
    form = await screen.findByRole('group', { name: '新增一筆交易' }, WAIT);
    expect(within(form).getByLabelText('金額')).toHaveValue(80);
    transactionResponses.push(new ApiError(400, 'VALIDATION_ERROR', '安全錯誤'));
    await user.click(within(form).getByRole('button', { name: '新增' }));
    expect(await screen.findByText('安全錯誤', undefined, WAIT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '編輯草稿：早餐' })).toBeInTheDocument();
  });

  it('W214 keeps drafts only in page state and ignores a response that arrives after leaving the page', async () => {
    const user = userEvent.setup();
    let resolveParse: ((value: ParseTransactionResponse) => void) | undefined;
    requestApi.mockImplementation((path: string, options?: { method?: string; body?: unknown }) => {
      if (path === '/ai/parse-transaction') {
        return new Promise<ParseTransactionResponse>((resolve) => {
          resolveParse = resolve;
        });
      }
      return configureFallback(path, options);
    });
    const { unmount } = render(<App />);
    const input = await screen.findByRole('textbox', { name: '用一句話記帳' }, WAIT);
    await user.type(input, '晚餐 180 現金');
    await user.click(screen.getByRole('button', { name: '送出' }));
    await user.click(screen.getByRole('link', { name: '帳戶' }));
    resolveParse?.({ drafts: [makeDraft({ title: '晚餐' })] });
    await user.click(await screen.findByRole('link', { name: '交易' }, WAIT));
    expect(await screen.findByRole('textbox', { name: '用一句話記帳' }, WAIT)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '編輯草稿：晚餐' })).not.toBeInTheDocument();

    unmount();
    render(<App />);
    expect(await screen.findByRole('textbox', { name: '用一句話記帳' }, WAIT)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '編輯草稿：晚餐' })).not.toBeInTheDocument();
    expect(window.location.search).toBe('');
    expect(localStorage.getItem('ledger.aiDrafts')).toBeNull();
    expect(sessionStorage.getItem('ledger.aiDrafts')).toBeNull();
  });
});

function configureFallback(path: string, options?: { method?: string; body?: unknown }) {
  const method = options?.method ?? 'GET';
  if (path.includes('/transactions') && method === 'POST') {
    transactionRequests.push({ path, body: parseBody(options) });
    return Promise.resolve({ id: `txn-${transactionRequests.length}` });
  }
  if (path.includes('/transactions')) {
    return Promise.resolve({ items: [], page: 1, limit: 20, total: 0 });
  }
  if (path === '/accounts') return Promise.resolve(accounts);
  if (path.endsWith('/users/me'))
    return Promise.resolve({ id: 'user-1', email: 'alice@example.test', name: 'Alice' });
  if (path.includes('/users/me/record-defaults')) {
    const ledgerId = new URLSearchParams(path.split('?')[1]).get('ledgerId');
    return Promise.resolve({ ledgerId, accountId: 'acc-cash' });
  }
  if (path.endsWith('/people')) return Promise.resolve([me, other]);
  if (path.includes('/categories')) {
    return Promise.resolve([
      {
        id: path.includes('ledger-2') ? 'cat-travel' : 'cat-food',
        name: path.includes('ledger-2') ? '交通' : '早餐',
        type: 'EXPENSE',
      },
    ]);
  }
  if (path === '/ledgers?includeArchived=true' || path === '/ledgers') {
    return Promise.resolve([personalLedger, sharedLedger]);
  }
  return Promise.resolve([]);
}
