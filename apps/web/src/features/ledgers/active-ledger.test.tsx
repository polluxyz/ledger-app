import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

/**
 * 作用中帳本的挑選規則（Slice 2 Step 2）。
 *
 * 重點全在「存下來的 id 失效時會怎樣」。這種錯不會拋例外、不會讓別的測試變紅，
 * 只會讓首頁停在一片空白，所以每一種失效情形都各給一條測試。
 *
 * 從真實的 App 出發、只換掉 fetch，比照 `AccountBalances.test.tsx`。
 */
describe('Active ledger selection', () => {
  const fetchMock = vi.fn();

  const personal = {
    id: 'led-1',
    name: '個人帳本',
    currency: 'TWD',
    tracksBalance: true,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    role: 'OWNER',
  };
  const family = { ...personal, id: 'led-2', name: '家庭帳本' };

  const ACTIVE_KEY = 'ledger.activeLedgerId';

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

  /** 交易端點回一筆帶帳本名稱的備註，好從畫面上看出「現在用的是哪一本」。 */
  function routeFetch(ledgers: unknown[]) {
    fetchMock.mockImplementation((url: string) => {
      const target = String(url);
      if (target.includes('/ledgers/') && target.includes('/transactions')) {
        const ledgerId = target.split('/ledgers/')[1]?.split('/')[0] ?? '';
        return Promise.resolve(
          jsonResponse(200, {
            items: [
              {
                id: `tx-${ledgerId}`,
                type: 'EXPENSE',
                amount: '100',
                occurredAt: '2026-08-01T00:00:00.000Z',
                note: `記在 ${ledgerId}`,
                categoryId: null,
                categoryName: null,
                accountId: null,
                accountName: null,
                creatorId: 'u1',
                creatorName: '我',
                createdAt: '2026-08-01T00:00:00.000Z',
                updatedAt: '2026-08-01T00:00:00.000Z',
              },
            ],
            page: 1,
            limit: 20,
            total: 1,
          }),
        );
      }
      if (target.includes('/ledgers')) {
        return Promise.resolve(jsonResponse(200, ledgers));
      }
      return Promise.resolve(jsonResponse(200, []));
    });
  }

  function signIn() {
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
  }

  it('uses the stored ledger when it is still valid', async () => {
    signIn();
    localStorage.setItem(ACTIVE_KEY, 'led-2');
    routeFetch([personal, family]);

    render(<App />);

    expect(await screen.findByText('記在 led-2')).toBeInTheDocument();
  });

  it('falls back to the first ledger when the stored id is gone', async () => {
    signIn();
    localStorage.setItem(ACTIVE_KEY, 'led-deleted');
    routeFetch([personal, family]);

    render(<App />);

    expect(await screen.findByText('記在 led-1')).toBeInTheDocument();
    // 退回之後要把新的選擇記起來，下次進站才不會又走一次退回。
    expect(localStorage.getItem(ACTIVE_KEY)).toBe('led-1');
  });

  it('falls back when the stored ledger has been archived', async () => {
    signIn();
    localStorage.setItem(ACTIVE_KEY, 'led-2');
    // 已封存的帳本不會出現在預設清單裡，所以「被封存」與「被刪掉」走同一個分支。
    routeFetch([personal]);

    render(<App />);

    expect(await screen.findByText('記在 led-1')).toBeInTheDocument();
    expect(localStorage.getItem(ACTIVE_KEY)).toBe('led-1');
  });

  it('takes the first ledger when nothing was stored', async () => {
    signIn();
    routeFetch([personal, family]);

    render(<App />);

    expect(await screen.findByText('記在 led-1')).toBeInTheDocument();
  });

  it('shows the empty state instead of crashing when there are no ledgers', async () => {
    signIn();
    localStorage.setItem(ACTIVE_KEY, 'led-1');
    routeFetch([]);

    render(<App />);

    expect(await screen.findByText('找不到任何帳本。')).toBeInTheDocument();
    // 沒有帳本可選時不該覆寫既有的偏好——那個 id 也許只是暫時取不到。
    expect(localStorage.getItem(ACTIVE_KEY)).toBe('led-1');
  });

  it('never asks for ledgers while signed out', () => {
    routeFetch([personal]);

    render(<App />);

    const requested = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requested.some((url) => url.includes('/ledgers'))).toBe(false);
  });
});
