import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

/**
 * 頁首的帳本切換器（Slice 2 Step 4）。
 *
 * 三件事要釘住：封存帳本不能被切過去、切換後首頁真的換了一本、只有一本時不畫下拉。
 */
describe('Ledger switcher', () => {
  const fetchMock = vi.fn();

  const personal = {
    id: 'led-1',
    name: '個人帳本',
    currency: 'TWD',
    kind: 'PERSONAL',
    tracksBalance: true,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    role: 'OWNER',
  };
  const family = { ...personal, id: 'led-2', name: '家庭帳本', kind: 'SHARED' };

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

  /** 交易端點回一筆帶帳本 id 的備註，好從畫面上看出現在用的是哪一本。 */
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

  it('switches which ledger the home page records into', async () => {
    routeFetch([personal, family]);
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByText('記在 led-1')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('作用中帳本'), 'led-2');

    // query key 帶著 ledgerId，所以換一本就自然重取，不必手動失效。
    expect(await screen.findByText('記在 led-2')).toBeInTheDocument();
    await waitFor(() => {
      expect(localStorage.getItem('ledger.activeLedgerId')).toBe('led-2');
    });
  });

  it('never offers an archived ledger', async () => {
    // `/ledgers` 預設就不含封存的，切換器直接沿用那份清單，不必自己再過濾。
    routeFetch([personal, family]);
    render(<App />);

    const select = await screen.findByLabelText('作用中帳本');
    const options = Array.from(select.querySelectorAll('option')).map(
      (option) => option.textContent,
    );
    expect(options).toEqual(['個人帳本', '家庭帳本']);
  });

  it('shows a plain name instead of a dropdown when there is only one ledger', async () => {
    routeFetch([personal]);

    render(<App />);

    // 一個永遠只有一個選項的下拉只會誤導人。
    expect(await screen.findByText('個人帳本')).toBeInTheDocument();
    expect(screen.queryByLabelText('作用中帳本')).not.toBeInTheDocument();
  });

  it('stays out of the header while signed out', () => {
    localStorage.removeItem('ledger.accessToken');
    routeFetch([personal, family]);

    render(<App />);

    expect(screen.queryByLabelText('作用中帳本')).not.toBeInTheDocument();
  });
});
