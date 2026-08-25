import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

/**
 * 帳戶頁的流程測試（SC-14）：從真實的 App 出發，只把 fetch 換成 mock。
 *
 * 重點放在「失敗之後畫面變成什麼樣」——成功路徑很難寫錯，錯誤路徑才是使用者
 * 真的會卡住的地方：名稱重複、帳戶已被交易引用、帳戶被刪光。
 */
describe('Accounts page', () => {
  const fetchMock = vi.fn();

  const cash = { id: 'acc-1', name: '現金', initialBalance: 0, balance: 3800 };
  const card = { id: 'acc-2', name: '信用卡', initialBalance: -12000, balance: -12000 };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    window.history.pushState({}, '', '/accounts');
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

  /** 依路徑與方法回應；`write` 可覆寫 POST / PATCH / DELETE 的結果。 */
  function routeFetch(options: { accounts?: unknown[]; write?: () => Response } = {}) {
    const accounts = options.accounts ?? [cash, card];
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.includes('/accounts') && method !== 'GET') {
        return Promise.resolve(options.write?.() ?? jsonResponse(201, cash));
      }
      if (url.includes('/accounts')) {
        return Promise.resolve(jsonResponse(200, accounts));
      }
      return Promise.resolve(jsonResponse(200, []));
    });
  }

  const dialog = () => within(screen.getByRole('dialog'));

  it('lists accounts with their balances, negatives marked', async () => {
    routeFetch();

    render(<App />);

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('現金')).toBeInTheDocument();
    expect(within(items[0]!).getByText('$3,800')).toBeInTheDocument();
    // 信用卡欠款是負的，且要一眼看得出來。
    const balance = within(items[1]!).getByLabelText('信用卡餘額');
    expect(balance).toHaveTextContent('-12,000');
    expect(balance.className).toMatch(/negative/);
  });

  it('tells the user to keep an account when the list is empty', async () => {
    routeFetch({ accounts: [] });

    render(<App />);

    expect(await screen.findByText(/至少保留一個帳戶才能記帳/)).toBeInTheDocument();
  });

  it('creates an account and closes the dialog', async () => {
    const user = userEvent.setup();
    routeFetch();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '新增帳戶' }));
    await user.type(dialog().getByLabelText('名稱'), '國泰世華');
    await user.click(dialog().getByRole('button', { name: '新增' }));

    // 成功就關閉；列表由 react-query 自動重取。
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    const posted = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
    );
    const body = JSON.parse((posted?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.name).toBe('國泰世華');
  });

  it('renames without offering the initial balance', async () => {
    const user = userEvent.setup();
    routeFetch({ write: () => jsonResponse(200, { ...cash, name: '零錢包' }) });

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '編輯現金' }));

    // 初始餘額是建立當下的歷史事實，編輯時不該出現——顯示它等於暗示可以改。
    expect(dialog().queryByLabelText('初始餘額')).not.toBeInTheDocument();

    await user.clear(dialog().getByLabelText('名稱'));
    await user.type(dialog().getByLabelText('名稱'), '零錢包');
    await user.click(dialog().getByRole('button', { name: '儲存' }));

    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    const patched = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    const body = JSON.parse((patched?.[1] as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    // 只送名稱。多送 initialBalance 會被後端退回 400。
    expect(body).toEqual({ name: '零錢包' });
  });

  it('never shows the initial balance in the list', async () => {
    routeFetch();

    render(<App />);

    // 現金的初始餘額是 0、信用卡是 -12000，兩者都不該出現在列表上。
    const items = await screen.findAllByRole('listitem');
    expect(within(items[0]!).queryByText(/初始/)).not.toBeInTheDocument();
    expect(within(items[1]!).queryByText(/初始/)).not.toBeInTheDocument();
  });

  it('keeps the dialog open and shows why when the name is taken', async () => {
    const user = userEvent.setup();
    routeFetch({
      write: () =>
        jsonResponse(409, {
          statusCode: 409,
          errorCode: 'ACCOUNT_NAME_TAKEN',
          message: 'An account with this name already exists.',
        }),
    });

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '新增帳戶' }));
    await user.type(dialog().getByLabelText('名稱'), '現金');
    await user.click(dialog().getByRole('button', { name: '新增' }));

    // 彈窗留著、輸入留著——關掉的話使用者剛打的字就沒了，也多半沒看到錯誤。
    expect(await dialog().findByRole('alert')).toHaveTextContent('already exists');
    expect(dialog().getByLabelText('名稱')).toHaveValue('現金');
  });

  it('sends nothing when the delete is cancelled', async () => {
    const user = userEvent.setup();
    routeFetch();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '刪除現金' }));
    await user.click(dialog().getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const wrote = fetchMock.mock.calls.some(
      (call) => (call[1] as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(wrote).toBe(false);
  });

  it('explains a rejected delete and leaves the account in place', async () => {
    const user = userEvent.setup();
    routeFetch({
      write: () =>
        jsonResponse(409, {
          statusCode: 409,
          errorCode: 'ACCOUNT_IN_USE',
          message: 'Cannot delete an account that transactions reference.',
        }),
    });

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '刪除現金' }));
    await user.click(dialog().getByRole('button', { name: '刪除' }));

    // 409 是按下確認之後才發生的，所以訊息必須留在彈窗裡。
    expect(await dialog().findByRole('alert')).toHaveTextContent('transactions reference');
    expect(screen.getByText('現金')).toBeInTheDocument();
  });
});

/**
 * 任務 4.4：帳戶被刪光時，記帳表單不能是一個「送出必定 400」的空下拉。
 */
describe('Transaction form without any account', () => {
  const fetchMock = vi.fn();

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

  it('points the user at the accounts page instead of an empty select', async () => {
    const ledger = {
      id: 'ledger-1',
      name: '我的帳本',
      currency: 'TWD',
      tracksBalance: true,
      archivedAt: null,
      role: 'OWNER',
    };
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/accounts')) {
        return Promise.resolve(jsonResponse(200, []));
      }
      if (url.includes('/transactions')) {
        return Promise.resolve(jsonResponse(200, { items: [], page: 1, limit: 20, total: 0 }));
      }
      if (url.includes('/categories')) {
        return Promise.resolve(jsonResponse(200, []));
      }
      return Promise.resolve(jsonResponse(200, [ledger]));
    });

    render(<App />);

    expect(await screen.findByText(/記帳前要先有一個帳戶/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '前往新增帳戶' })).toHaveAttribute('href', '/accounts');
    // 沒有帳戶下拉，也就沒有「選不到東西還能按送出」的狀態。
    expect(screen.queryByLabelText('帳戶')).not.toBeInTheDocument();
  });
});
