import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

/**
 * 首頁的帳戶餘額列（SC-14 的「餘額看得見」那一半）。
 *
 * 從真實的 App 出發，只把 fetch 換成 mock。四種狀態各一條：有資料、載入中、
 * 失敗、零帳戶——後三種正是使用者真的會遇到、而畫面最容易做錯的情況。
 */
describe('Account balances on the home page', () => {
  const fetchMock = vi.fn();

  const cash = { id: 'acc-1', name: '現金', initialBalance: 0, balance: 3800 };
  const card = { id: 'acc-2', name: '信用卡', initialBalance: -12000, balance: -12000 };

  beforeEach(() => {
    localStorage.clear();
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

  /** `accounts` 可換成別的回應（含錯誤或永不結束的 promise）。 */
  function routeFetch(
    accounts: () => Promise<Response> = () => Promise.resolve(jsonResponse(200, [cash, card])),
  ) {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/accounts')) {
        return accounts();
      }
      // 帳本 / 交易 / 分類都回空的，本檔只關心餘額列。
      return Promise.resolve(jsonResponse(200, []));
    });
  }

  function signIn() {
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
  }

  /** 餘額列自成一個 region，查詢限定在它裡面，才不會誤抓到交易表單的帳戶下拉。 */
  const balances = () => within(screen.getByRole('region', { name: '帳戶餘額' }));

  it('shows every account with its balance, negatives marked', async () => {
    signIn();
    routeFetch();

    render(<App />);

    expect(await balances().findByText('現金')).toBeInTheDocument();
    expect(balances().getByLabelText('現金餘額')).toHaveTextContent('$3,800');

    const owed = balances().getByLabelText('信用卡餘額');
    expect(owed).toHaveTextContent('-12,000');
    expect(owed.className).toMatch(/negative/);
  });

  it('never asks for accounts while signed out', () => {
    routeFetch();

    render(<App />);

    expect(screen.queryByRole('region', { name: '帳戶餘額' })).not.toBeInTheDocument();
    const requested = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requested.some((url) => url.includes('/accounts'))).toBe(false);
  });

  it('holds the space while loading', () => {
    signIn();
    // 永不結束的 promise：畫面停在載入中。
    routeFetch(() => new Promise<Response>(() => {}));

    render(<App />);

    expect(balances().getByText('載入中…')).toBeInTheDocument();
  });

  it('stays quiet when the balances fail to load', async () => {
    signIn();
    // 用 4xx：providers 對 4xx 不重試，測試不必等 retry 的延遲。
    routeFetch(() =>
      Promise.resolve(
        jsonResponse(403, { statusCode: 403, message: '沒有權限', error: 'Forbidden' }),
      ),
    );

    render(<App />);

    expect(await balances().findByText('餘額暫時無法載入')).toBeInTheDocument();
    // 沒有紅色錯誤框：記帳表單好好的，不該讓人以為整頁壞了。
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // 出錯了也還走得到帳戶頁。
    expect(balances().getByRole('link', { name: '管理' })).toHaveAttribute('href', '/accounts');
  });

  it('points a user with no accounts at the accounts page', async () => {
    signIn();
    routeFetch(() => Promise.resolve(jsonResponse(200, [])));

    render(<App />);

    expect(await balances().findByRole('link', { name: '新增第一個帳戶' })).toHaveAttribute(
      'href',
      '/accounts',
    );
  });
});
