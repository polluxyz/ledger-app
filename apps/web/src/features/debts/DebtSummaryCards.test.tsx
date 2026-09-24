import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebtSummary } from '@ledger/shared';
import { DebtSummaryCards } from './DebtSummaryCards';

/**
 * 淨額卡片的兩件事：正負號換成正確的文字（「欠我」／「我欠」，spec 4.2），以及
 * 沒有未結清債務時的空狀態。
 *
 * 金額一律來自 API（W9），所以測資裡的 `net` 就是畫面上該出現的數字，唯一的
 * 「計算」是把負號從數字搬進文字——那正是要驗的行為。策略：mock fetch（比照
 * `use-transactions.test.tsx`），元件與 hook 一起跑，斷言畫出來的字串。
 */
describe('DebtSummaryCards', () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ledger.accessToken', 'jwt-abc');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderCards() {
    return render(
      <QueryClientProvider client={queryClient}>
        <DebtSummaryCards />
      </QueryClientProvider>,
    );
  }

  function mockSummary(body: DebtSummary) {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/debts/summary')) {
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.reject(new Error(`未預期的請求：${url}`));
    });
  }

  it('labels positive net as 欠我 and negative net as 我欠, with the absolute amount', async () => {
    mockSummary({
      items: [
        { counterpartyName: '小明', counterpartyUserId: null, net: 5000 },
        { counterpartyName: '阿華', counterpartyUserId: null, net: -1200 },
      ],
    });

    renderCards();

    expect(await screen.findByText('小明')).toBeInTheDocument();
    // 正負號換成文字，數字取絕對值——「我欠 -$1,200」會變成雙重否定。
    expect(screen.getByText('欠我 $5,000')).toBeInTheDocument();
    expect(screen.getByText('我欠 $1,200')).toBeInTheDocument();
  });

  it('writes a zero net as 淨額 $0 rather than 我欠 $0', async () => {
    mockSummary({ items: [{ counterpartyName: '小明', counterpartyUserId: null, net: 0 }] });

    renderCards();

    expect(await screen.findByText('淨額 $0')).toBeInTheDocument();
  });

  it('says there is nothing outstanding when the summary is empty', async () => {
    mockSummary({ items: [] });

    renderCards();

    expect(await screen.findByText('目前沒有未結清的借還')).toBeInTheDocument();
  });
});
