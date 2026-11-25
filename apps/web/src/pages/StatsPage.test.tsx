import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type {
  LedgerStatistics,
  LedgerSummary,
  StatisticsGroup,
  StatisticsPerspective,
  StatisticsTrend,
} from '@ledger/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActiveLedgerContext,
  type ActiveLedgerContextValue,
} from '../features/ledgers/active-ledger-context';
import { useHomeCategoryColors } from '../app/use-home-category-colors';
import { CATEGORY_CHART_COLORS } from '../features/statistics/charts/chart-colors';
import { ApiError } from '../lib/api-client';

vi.mock('../features/auth/use-current-user', () => ({
  useCurrentUser: () => ({ data: { id: 'user-me', name: '我' }, isSuccess: true }),
}));
import StatsPage from './StatsPage';

const statisticsApi = vi.hoisted(() => ({
  getStatistics: vi.fn<(path: string) => Promise<unknown>>(),
  getTrend: vi.fn<(path: string) => Promise<unknown>>(),
}));

vi.mock('../lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client')>();
  return {
    ...actual,
    apiRequest: <T,>(path: string, options?: Parameters<typeof actual.apiRequest>[1]) => {
      if (path.includes('/statistics/trend?')) {
        return statisticsApi.getTrend(path) as Promise<T>;
      }
      if (path.includes('/statistics?')) {
        return statisticsApi.getStatistics(path) as Promise<T>;
      }
      if (path.endsWith('/people')) {
        return Promise.resolve([
          { id: 'me', name: '我', userId: 'user-me' },
          { id: 'xiaomei', name: '小美', userId: 'user-xiaomei' },
        ]) as Promise<T>;
      }
      if (path === '/accounts') {
        return Promise.resolve([
          { id: 'cash', name: '現金' },
          { id: 'bank', name: '銀行' },
        ]) as Promise<T>;
      }
      if (path.endsWith('/categories')) {
        const ledgerId = path.split('/')[2];
        const ids = ledgerId === 'family' ? ['supplies', 'dinner'] : ['lunch', 'breakfast'];
        return Promise.resolve([
          { id: 'salary', name: '薪水', sortOrder: 0, type: 'INCOME' },
          ...ids
            .map((id, sortOrder) => ({
              id,
              sortOrder,
              name: { dinner: '晚餐', supplies: '日用品', lunch: '午餐', breakfast: '早餐' }[id],
              type: 'EXPENSE',
            }))
            .reverse(),
        ]) as Promise<T>;
      }
      return actual.apiRequest<T>(path, options);
    },
  };
});

const personalLedger: LedgerSummary = {
  id: 'daily',
  name: '日常',
  currency: 'TWD',
  kind: 'PERSONAL',
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  role: 'OWNER',
};

const familyLedger: LedgerSummary = {
  ...personalLedger,
  id: 'family',
  name: '家用',
  kind: 'SHARED',
};

const ledgers = [personalLedger, familyLedger];

const dinner: StatisticsGroup = {
  kind: 'CATEGORY',
  category: { id: 'dinner', name: '晚餐', icon: null },
  amount: 90_000,
  percentageBps: 7_500,
};

const supplies: StatisticsGroup = {
  kind: 'CATEGORY',
  category: { id: 'supplies', name: '日用品', icon: null },
  amount: 30_000,
  percentageBps: 2_500,
};

function totals(income: number, expense: number, net: number) {
  return { income, expense, net };
}

function statsFor(ledgerId: string, perspective: StatisticsPerspective): LedgerStatistics {
  const shared = ledgerId === familyLedger.id;
  const expenseGroups: StatisticsGroup[] = shared
    ? perspective === 'MINE'
      ? [{ ...dinner, amount: 45_000, percentageBps: 10_000 }]
      : [dinner, supplies]
    : [
        { kind: 'BAD_DEBT', category: null, amount: 50_000, percentageBps: 7_112 },
        {
          kind: 'CATEGORY',
          category: { id: 'lunch', name: '午餐', icon: null },
          amount: 12_000,
          percentageBps: 1_707,
        },
        {
          kind: 'CATEGORY',
          category: { id: 'breakfast', name: '早餐', icon: null },
          amount: 8_000,
          percentageBps: 1_138,
        },
        { kind: 'DIFFERENCE', category: null, amount: 300, percentageBps: 43 },
      ];

  const ledger = shared ? totals(20_000, 120_000, -100_000) : totals(0, 70_300, -70_300);
  const mine = shared ? totals(20_000, 45_000, -25_000) : totals(0, 70_300, -70_300);
  return {
    ledgerId,
    from: '2026-10-01',
    to: '2026-10-31',
    ledger,
    mine,
    totals: perspective === 'MINE' ? mine : ledger,
    expenseGroups,
    incomeGroups: [],
    people: shared
      ? [
          { personId: 'me', name: '我', isMe: true, expense: 45_000, income: 20_000 },
          { personId: 'xiaomei', name: '小美', isMe: false, expense: 75_000, income: 0 },
        ]
      : null,
  };
}

/** 統計頁使用真實 query hooks，但以 vi.mock 讓 API 回應穩定且不依賴後端。 */
describe('StatsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    statisticsApi.getStatistics.mockReset();
    statisticsApi.getTrend.mockReset();
    statisticsApi.getStatistics.mockImplementation((path) => {
      const url = new URL(path, 'http://localhost');
      const ledgerId = url.pathname.split('/')[2] ?? personalLedger.id;
      expect(url.searchParams.get('perspective')).toBe('LEDGER');
      return Promise.resolve(
        statsFor(ledgerId, url.searchParams.get('personIds') === 'me' ? 'MINE' : 'LEDGER'),
      );
    });
    statisticsApi.getTrend.mockImplementation((path) => {
      const url = new URL(path, 'http://localhost');
      const endMonth = url.searchParams.get('endMonth') ?? '2026-10';
      const monthCount = Number(url.searchParams.get('months') ?? 12);
      return Promise.resolve({
        ledgerId: familyLedger.id,
        averageIncome: null,
        averageExpense: null,
        averageMonthCount: 0,
        months: Array.from({ length: monthCount }, (_, index) => {
          const [year, month] = endMonth.split('-').map(Number);
          const date = new Date(Date.UTC(year ?? 2026, (month ?? 10) - monthCount + index, 1));
          return {
            month: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
            income: 0,
            expense: 0,
            net: 0,
            movingAverageIncome: null,
            movingAverageExpense: null,
            movingAverageMonthCount: 0,
          };
        }),
      } satisfies StatisticsTrend);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderPage(
    initialUrl: string,
    options: { initialLedgerId?: string; initialEntries?: string[]; initialIndex?: number } = {},
  ) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <LedgerFixture initialLedgerId={options.initialLedgerId ?? personalLedger.id}>
          <MemoryRouter
            initialEntries={options.initialEntries ?? [initialUrl]}
            initialIndex={options.initialIndex}
          >
            <LocationProbe />
            <Routes>
              <Route path="/stats" element={<StatsPage />} />
              <Route path="/transactions" element={<p>交易頁</p>} />
            </Routes>
          </MemoryRouter>
        </LedgerFixture>
      </QueryClientProvider>,
    );
  }

  it('uses the URL ledger, shows category summaries, and opens the related transactions', async () => {
    const user = userEvent.setup();
    renderPage('/stats?tab=cat&ledger=family&month=2026-10');

    const categoryList = await screen.findByRole('list', { name: '支出分類清單' });
    const summary = within(screen.getByRole('region', { name: '收支摘要' }));
    expect(
      within(screen.getByRole('group', { name: '作用中帳本' })).getByRole('button'),
    ).toHaveTextContent('家用');
    expect(summary.getByRole('definition', { name: '收入 $200' })).toBeInTheDocument();
    expect(summary.getByRole('definition', { name: '支出 $1,200' })).toBeInTheDocument();
    expect(summary.getByRole('definition', { name: '結餘 -$1,000' })).toBeInTheDocument();
    expect(
      within(categoryList).getByRole('button', { name: '晚餐，$900，75%' }),
    ).toBeInTheDocument();
    expect(
      within(categoryList).getByRole('button', { name: '日用品，$300，25%' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/stats?tab=cat&ledger=family&month=2026-10',
      ),
    );

    expect(screen.queryByRole('group', { name: '統計口徑' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '成員' })).not.toBeInTheDocument();
    const ledgerCategoryList = await screen.findByRole('list', { name: '支出分類清單' });
    await user.click(within(ledgerCategoryList).getByRole('button', { name: /晚餐，\$900，75%/ }));
    expect(screen.getByText('交易頁')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/transactions?ledger=family&type=EXPENSE&categoryId=dinner&from=2026-10-01&to=2026-10-31',
    );
    await user.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/stats?tab=cat&ledger=family&month=2026-10',
      ),
    );
    expect(await screen.findByRole('heading', { name: '統計' })).toBeInTheDocument();
  });

  it('pushes ledger changes and restores the previous ledger and summary on browser back', async () => {
    const user = userEvent.setup();
    const previous = '/stats?tab=cat&ledger=family&month=2026-09';
    const current = '/stats?tab=cat&ledger=family&month=2026-10';
    renderPage(current, {
      initialLedgerId: familyLedger.id,
      initialEntries: [previous, current],
      initialIndex: 1,
    });
    await screen.findByRole('list', { name: '支出分類清單' });

    const switcher = screen.getByRole('group', { name: '作用中帳本' });
    await user.click(within(switcher).getByRole('button'));
    await user.click(screen.getByRole('option', { name: /日常/ }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/stats?tab=cat&ledger=daily&month=2026-10',
      ),
    );
    expect(screen.getByRole('region', { name: '收支摘要' })).toHaveTextContent('-$703');

    await user.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(current));
    expect(await screen.findByRole('button', { name: /家用/ })).toBeInTheDocument();
    const summary = within(screen.getByRole('region', { name: '收支摘要' }));
    expect(summary.getByRole('definition', { name: '支出 $1,200' })).toBeInTheDocument();
    expect(summary.getByRole('definition', { name: '結餘 -$1,000' })).toBeInTheDocument();
  });

  it('supports tab, month, and category controls by keyboard and exposes precise amounts', async () => {
    const user = userEvent.setup();
    const initial = '/stats?tab=cat&ledger=family&month=2026-10';
    renderPage(initial, { initialLedgerId: familyLedger.id });

    const firstCategoryList = await screen.findByRole('list', { name: '支出分類清單' });
    const summary = within(screen.getByRole('region', { name: '收支摘要' }));
    expect(summary.getByRole('definition', { name: '收入 $200' })).toBeInTheDocument();
    expect(summary.getByRole('definition', { name: '支出 $1,200' })).toBeInTheDocument();
    expect(
      within(firstCategoryList).getByRole('button', { name: '晚餐，$900，75%' }),
    ).toBeInTheDocument();

    const trendTab = screen.getByRole('button', { name: '每月收支' });
    await focusWithTab(user, trendTab);
    await user.keyboard('{Enter}');
    await screen.findByRole('region', { name: '每月收支圖' });

    expect(screen.queryByRole('group', { name: '趨勢圖型' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('chart='));

    const septemberButton = screen.getByRole('button', {
      name: /2026年9月：收入/,
    });
    await focusWithTab(user, septemberButton);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('month=2026-09'));

    const backButton = screen.getByRole('button', { name: '返回' });
    await focusWithTab(user, backButton);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('month=2026-10'));
    await focusWithTab(user, backButton);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('tab=cat'));

    const categoryList = await screen.findByRole('list', { name: '支出分類清單' });
    const dinnerButton = within(categoryList).getByRole('button', {
      name: '晚餐，$900，75%',
    });
    await focusWithTab(user, dinnerButton);
    await user.keyboard('{Enter}');
    expect(screen.getByText('交易頁')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/transactions?ledger=family&type=EXPENSE&categoryId=dinner&from=2026-10-01&to=2026-10-31',
    );
  });

  it('keeps daily fixed groups and categories in backend order', async () => {
    renderPage('/stats?tab=cat&ledger=daily&month=2026-10');

    const list = await screen.findByRole('list', { name: '支出分類清單' });
    expect(
      within(screen.getByRole('group', { name: '作用中帳本' })).getByRole('button'),
    ).toHaveTextContent('日常');
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['呆帳$50071.12%', '午餐$12017.07%', '早餐$8011.38%', '結清差額$30.43%']);
    expect(within(list).queryByRole('button', { name: /呆帳/ })).not.toBeInTheDocument();
    expect(within(list).getByRole('button', { name: /午餐，\$120，17.07%/ })).toBeInTheDocument();
  });

  it('keeps statistical category colors unchanged by the home color preference', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');

    async function readCategoryColors(mode: 'color' | 'gold' | 'gray') {
      const preference = renderHook(() => useHomeCategoryColors());
      act(() => preference.result.current.choose(mode));
      expect(preference.result.current.mode).toBe(mode);

      const rendered = renderPage('/stats?tab=cat&ledger=family&month=2026-10');
      const list = await screen.findByRole('list', { name: '支出分類清單' });
      const colors = Array.from(list.querySelectorAll('[style*="--swatch-color"]')).map((swatch) =>
        (swatch as HTMLElement).style.getPropertyValue('--swatch-color'),
      );
      rendered.unmount();
      preference.unmount();
      return colors;
    }

    const colorMode = await readCategoryColors('color');
    expect(colorMode).toEqual([CATEGORY_CHART_COLORS.dark[1], CATEGORY_CHART_COLORS.dark[0]]);
    expect(await readCategoryColors('gold')).toEqual(colorMode);
    expect(await readCategoryColors('gray')).toEqual(colorMode);
  });

  it('never keeps the previous ledger chart while loading a new ledger', async () => {
    const user = userEvent.setup();
    let releaseDaily: ((value: unknown) => void) | undefined;
    statisticsApi.getStatistics.mockImplementation((path) => {
      const ledgerId = new URL(path, 'http://localhost').pathname.split('/')[2];
      if (ledgerId === personalLedger.id) {
        return new Promise((resolve) => {
          releaseDaily = resolve;
        });
      }
      return Promise.resolve(statsFor(ledgerId ?? familyLedger.id, 'LEDGER'));
    });
    renderPage('/stats?tab=cat&ledger=family&month=2026-10');
    await screen.findByRole('list', { name: '支出分類清單' });
    await user.click(within(screen.getByRole('group', { name: '作用中帳本' })).getByRole('button'));
    await user.click(screen.getByRole('option', { name: /日常/ }));

    await waitFor(() => expect(releaseDaily).toBeDefined());
    expect(screen.queryByText('晚餐')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: '收支摘要' })).queryByText('$1,200'),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(2);

    releaseDaily?.(statsFor(personalLedger.id, 'LEDGER'));
    const dailyGroups = await screen.findByRole('list', { name: '支出分類清單' });
    expect(within(dailyGroups).getByText('呆帳')).toBeInTheDocument();
  });

  it('normalizes a ledger id that is not in the user ledger list', async () => {
    renderPage('/stats?tab=cat&ledger=not-mine&month=2026-10');
    await screen.findByRole('list', { name: '支出分類清單' });

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/stats?tab=cat&ledger=daily&month=2026-10',
      ),
    );
    expect(
      within(screen.getByRole('group', { name: '作用中帳本' })).getByRole('button'),
    ).toHaveTextContent('日常');
  });

  it('ignores the old stored chart preference when switching directions and tabs', async () => {
    const user = userEvent.setup();
    localStorage.setItem('stats.chart', '{invalid');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderPage('/stats?tab=cat&ledger=family&month=2026-10');

    const expenses = await screen.findByRole('list', { name: '支出分類清單' });
    const categoryBars = within(expenses).getAllByTestId('statistics-list-bar');
    expect(categoryBars).toHaveLength(2);
    expect(categoryBars[0]).toHaveStyle({ width: '100%' });
    expect(categoryBars[1]).toHaveStyle({ width: `${(300 / 900) * 100}%` });
    const donut = screen.getByRole('region', { name: '支出分類圓餅圖' });
    const slices = donut.querySelectorAll('path');
    expect(categoryBars.map((bar) => bar.style.getPropertyValue('--bar-color'))).toEqual(
      [...slices].map((slice) => slice.getAttribute('stroke')),
    );
    expect(screen.queryByRole('group', { name: '分類圖型' })).not.toBeInTheDocument();

    await user.click(
      within(screen.getByRole('group', { name: '收支方向' })).getByRole('button', { name: '收入' }),
    );
    expect(screen.getByRole('region', { name: '收入分類圓餅圖' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '每月收支' }));
    await screen.findByRole('region', { name: '每月收支圖' });
    expect(statisticsApi.getStatistics).toHaveBeenCalledTimes(1);
    expect(getItem).not.toHaveBeenCalledWith('stats.chart');
    expect(setItem).not.toHaveBeenCalledWith('stats.chart', expect.anything());
  });

  it.each([
    ['cat', 'bar'],
    ['trend', 'table'],
  ])('replaces the old chart URL on %s', async (tab, chart) => {
    const user = userEvent.setup();
    const previous = '/stats?tab=cat&ledger=family&month=2026-09';
    const legacy = '/stats?tab=' + tab + '&chart=' + chart;
    renderPage(legacy, {
      initialLedgerId: familyLedger.id,
      initialEntries: [previous, legacy],
      initialIndex: 1,
    });
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('tab=' + tab);
      expect(screen.getByTestId('location')).not.toHaveTextContent('chart=');
    });
    await user.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(previous));
  });

  it.each([false, true])(
    'renders categories in viewport reading order (narrow: %s)',
    async (matches) => {
      vi.stubGlobal(
        'matchMedia',
        vi
          .fn()
          .mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
      );
      try {
        renderPage('/stats?tab=cat&ledger=family&month=2026-10');
        const list = await screen.findByRole('list', { name: '支出分類清單' });
        const chart = screen.getByRole('region', { name: '支出分類圓餅圖' });
        expect(list.compareDocumentPosition(chart)).toBe(
          matches ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING,
        );
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('requests twelve trend months, selects a month with browser history, and shows the range', async () => {
    const user = userEvent.setup();
    renderPage('/stats?tab=trend&ledger=family&from=2026-10-05&to=2026-10-20');

    const september = await screen.findByRole('button', {
      name: /2026年9月/,
    });
    expect(screen.getByText('2025 年 11 月 – 2026 年 10 月')).toBeInTheDocument();
    await waitFor(() => {
      expect(statisticsApi.getTrend).toHaveBeenCalled();
      const trendUrl = new URL(statisticsApi.getTrend.mock.calls[0]?.[0] ?? '', 'http://localhost');
      expect(trendUrl.searchParams.get('endMonth')).toBe('2026-10');
      expect(trendUrl.searchParams.get('months')).toBe('12');
    });

    await user.click(september);
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/stats?tab=trend&ledger=family&month=2026-09',
      ),
    );
    expect(await screen.findByText('2025 年 10 月 – 2026 年 9 月')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '返回' }));
    expect(await screen.findByTestId('location')).toHaveTextContent(
      '/stats?tab=trend&ledger=family&from=2026-10-05&to=2026-10-20',
    );
  });

  it('uses the selected month, year end, and custom end month for trend requests', async () => {
    const user = userEvent.setup();
    renderPage('/stats?tab=trend&ledger=family&month=2026-07');
    await screen.findByRole('region', { name: '每月收支圖' });

    await user.click(screen.getByRole('button', { name: '年' }));
    await waitFor(() =>
      expect(
        statisticsApi.getTrend.mock.calls.some(([path]) => {
          return new URL(path, 'http://localhost').searchParams.get('endMonth') === '2026-12';
        }),
      ).toBe(true),
    );

    await user.click(screen.getByRole('button', { name: '自訂' }));
    fireEvent.change(screen.getByLabelText('自訂起日'), { target: { value: '2026-10-05' } });
    fireEvent.change(screen.getByLabelText('自訂迄日'), { target: { value: '2026-10-20' } });
    await user.click(screen.getByRole('button', { name: '套用' }));
    await waitFor(() =>
      expect(
        statisticsApi.getTrend.mock.calls.some(([path]) => {
          return new URL(path, 'http://localhost').searchParams.get('endMonth') === '2026-10';
        }),
      ).toBe(true),
    );
    const trendRequests = statisticsApi.getTrend.mock.calls.map(([path]) =>
      new URL(path, 'http://localhost').searchParams.get('endMonth'),
    );
    expect(trendRequests).toContain('2026-07');
    expect(trendRequests).toContain('2026-12');
    expect(trendRequests).toContain('2026-10');
    expect(screen.getByTestId('location')).toHaveTextContent('from=2026-10-05&to=2026-10-20');
  });

  it('opens 每月收支 at tab=trend and passes the API averages to the chart', async () => {
    statisticsApi.getTrend.mockResolvedValueOnce({
      ledgerId: familyLedger.id,
      averageIncome: 532700,
      averageExpense: 234556,
      averageMonthCount: 3,
      months: [
        {
          month: '2026-07',
          income: 120000,
          expense: 80000,
          net: 40000,
          movingAverageIncome: 532700,
          movingAverageExpense: 234556,
          movingAverageMonthCount: 3,
        },
      ],
    });
    renderPage('/stats?tab=trend&ledger=family&month=2026-07');

    const chart = within(await screen.findByRole('region', { name: '每月收支圖' }));
    expect(screen.getByRole('button', { name: '每月收支' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('location')).toHaveTextContent('tab=trend');
    expect(chart.getByText('收入近 6 月均')).toBeVisible();
    expect(chart.getByText('支出近 6 月均')).toBeVisible();
  });

  const familyUrl = '/stats?tab=cat&ledger=family&month=2026-10';

  async function openFilters(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /^篩選/ }));
    return within(await screen.findByRole('dialog', { name: '篩選' }));
  }

  function urlFilters() {
    return new URL(screen.getByTestId('location').textContent ?? '', 'http://localhost')
      .searchParams;
  }

  it('applies all three groups and sends the same repeated filters to both queries', async () => {
    const user = userEvent.setup();
    renderPage(familyUrl);
    const panel = await openFilters(user);
    await panel.findByRole('checkbox', { name: '我' });
    const category = within(panel.getByRole('group', { name: '分類' }));
    expect(
      category.getAllByRole('checkbox').map((input) => input.parentElement?.textContent),
    ).toEqual(['日用品', '晚餐', '薪水', '未分類']);
    for (const name of ['我', '小美', '晚餐', '未分類', '現金', '銀行', '其他']) {
      await user.click(panel.getByRole('checkbox', { name }));
    }
    expect(urlFilters().has('personIds')).toBe(false);
    await user.click(panel.getByRole('button', { name: '套用' }));
    const funnel = screen.getByRole('button', { name: '篩選，已選 7 項' });
    expect(funnel).toHaveTextContent('7');
    expect(funnel).toHaveFocus();
    expect(screen.getByRole('list', { name: '已套用的篩選' }).children).toHaveLength(7);
    expect(urlFilters().getAll('personIds')).toEqual(['me', 'xiaomei']);
    expect(urlFilters().getAll('categoryIds')).toEqual(['dinner']);
    expect(urlFilters().getAll('accountIds')).toEqual(['cash', 'bank']);
    expect(urlFilters().get('includeUncategorized')).toBe('true');
    expect(urlFilters().get('includeOtherAccounts')).toBe('true');
    await waitFor(() => {
      for (const request of [statisticsApi.getStatistics, statisticsApi.getTrend]) {
        const params = new URL(request.mock.lastCall?.[0] ?? '', 'http://localhost').searchParams;
        expect(params.get('perspective')).toBe('LEDGER');
        for (const key of [
          'personIds',
          'categoryIds',
          'accountIds',
          'includeUncategorized',
          'includeOtherAccounts',
        ]) {
          expect(params.getAll(key)).toEqual(urlFilters().getAll(key));
        }
      }
    });
  });

  it('restores checked options from the URL, and pushes removal and clear actions to history', async () => {
    const user = userEvent.setup();
    renderPage(familyUrl + '&categoryIds=dinner&includeOtherAccounts=true');
    const panel = await openFilters(user);
    expect(await panel.findByRole('checkbox', { name: '晚餐' })).toBeChecked();
    expect(panel.getByRole('checkbox', { name: '其他' })).toBeChecked();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '篩選，已選 2 項' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: '移除其他' }));
    expect(urlFilters().has('includeOtherAccounts')).toBe(false);
    const reopened = await openFilters(user);
    await user.click(reopened.getByRole('button', { name: '清除全部' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '篩選' })).toHaveFocus();
    expect(urlFilters().has('categoryIds')).toBe(false);
    await user.click(screen.getByRole('button', { name: '返回' }));
    expect(urlFilters().get('categoryIds')).toBe('dinner');
    await user.click(screen.getByRole('button', { name: '返回' }));
    expect(urlFilters().get('includeOtherAccounts')).toBe('true');
  });

  it('hides the member group in personal ledgers and restores focus on outside click', async () => {
    const user = userEvent.setup();
    renderPage('/stats?ledger=daily&month=2026-10');
    const panel = await openFilters(user);
    expect(panel.queryByRole('group', { name: '成員' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '篩選' })).toHaveFocus();
  });

  it.each([
    ['statistics', 'categoryIds=stale&accountIds=cash', 'cash'],
    ['trend', 'categoryIds=dinner', null],
  ] as const)(
    'hides all amounts after %s returns 400 and replaces the URL on confirmation',
    async (endpoint, filters, remaining) => {
      const user = userEvent.setup();
      const request =
        endpoint === 'statistics' ? statisticsApi.getStatistics : statisticsApi.getTrend;
      const success = request.getMockImplementation()!;
      request.mockImplementation((path) => {
        if (new URL(path, 'http://localhost').searchParams.has('categoryIds')) {
          return Promise.reject(new ApiError(400, 'INVALID_FILTER', 'invalid'));
        }
        return success(path);
      });
      const previous = familyUrl.replace('2026-10', '2026-09');
      const current = familyUrl + '&' + filters;
      renderPage(current, { initialEntries: [previous, current], initialIndex: 1 });
      const clear = await screen.findByRole('button', { name: '清除失效條件' });
      expect(screen.getByRole('alert')).toHaveTextContent('部分篩選條件已失效');
      expect(screen.queryByRole('definition')).not.toBeInTheDocument();
      expect(screen.queryByRole('list', { name: '支出分類清單' })).not.toBeInTheDocument();
      expect(urlFilters().has('categoryIds')).toBe(true);
      await user.click(clear);
      expect(urlFilters().has('categoryIds')).toBe(false);
      expect(urlFilters().get('accountIds')).toBe(remaining);
      await screen.findByRole('definition', { name: '支出 $1,200' });
      await user.click(screen.getByRole('button', { name: '返回' }));
      expect(screen.getByTestId('location')).toHaveTextContent(previous);
    },
  );

  it('keeps the personal ledger owner filter when removing an invalid category', async () => {
    const user = userEvent.setup();
    const success = statisticsApi.getStatistics.getMockImplementation()!;
    statisticsApi.getStatistics.mockImplementation((path) =>
      path.includes('categoryIds=stale')
        ? Promise.reject(new ApiError(400, 'INVALID_FILTER', 'invalid'))
        : success(path),
    );
    renderPage('/stats?ledger=daily&month=2026-10&personIds=user-me&categoryIds=stale');
    await user.click(await screen.findByRole('button', { name: '清除失效條件' }));
    expect(urlFilters().get('personIds')).toBe('user-me');
    expect(urlFilters().has('categoryIds')).toBe(false);
  });

  it.each(['family', 'daily'])('replaces the old tab and perspective in %s', async (ledger) => {
    const user = userEvent.setup();
    const previous = familyUrl.replace('2026-10', '2026-09');
    const legacy = `/stats?tab=member&ledger=${ledger}&month=2026-10&perspective=MINE&chart=bar`;
    renderPage(legacy, { initialEntries: [previous, legacy], initialIndex: 1 });
    await waitFor(() => {
      const params = urlFilters();
      expect(params.get('tab')).toBe('cat');
      expect(params.has('perspective')).toBe(false);
      expect(params.has('chart')).toBe(false);
      expect(params.get('personIds')).toBe(ledger === 'family' ? 'me' : null);
    });
    await screen.findByRole('list', { name: '支出分類清單' });
    if (ledger === 'family') {
      await screen.findByRole('definition', { name: '支出 $450' });
    }
    await user.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(previous));
  });

  it.each(['personIds=me', 'accountIds=cash', 'includeOtherAccounts=true'])(
    'keeps categories on the stats page with %s',
    async (filter) => {
      const user = userEvent.setup();
      renderPage(familyUrl + '&' + filter);
      const list = within(await screen.findByRole('list', { name: '支出分類清單' }));
      expect(list.queryByRole('button')).not.toBeInTheDocument();
      await user.click(list.getByText('晚餐'));
      expect(screen.queryByText('交易頁')).not.toBeInTheDocument();
    },
  );

  it('keeps the category transaction link when only categories are filtered', async () => {
    const user = userEvent.setup();
    renderPage(familyUrl + '&categoryIds=dinner');
    const list = within(await screen.findByRole('list', { name: '支出分類清單' }));
    await user.click(list.getByRole('button', { name: /晚餐/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('categoryId=dinner');
    expect(screen.getByText('交易頁')).toBeInTheDocument();
  });

  it('keeps summary and category data visible when trend fails, and hides zero totals when statistics fail', async () => {
    statisticsApi.getTrend.mockRejectedValue(new Error('trend failed'));
    renderPage('/stats?tab=trend&ledger=family&month=2026-10');

    expect(await screen.findByRole('alert')).toHaveTextContent('每月收支暫時無法載入');
    expect(screen.getByText('$1,200')).toBeInTheDocument();

    statisticsApi.getStatistics.mockRejectedValue(new Error('statistics failed'));
    renderPage('/stats?tab=cat&ledger=family&month=2026-10');
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
  });
});

function LedgerFixture({
  initialLedgerId,
  children,
}: {
  initialLedgerId: string;
  children: ReactNode;
}) {
  const [activeLedgerId, setActiveLedgerId] = useState(initialLedgerId);
  const setActive = useCallback((ledgerId: string) => setActiveLedgerId(ledgerId), []);
  const ledger = ledgers.find((item) => item.id === activeLedgerId) ?? null;
  const value = useMemo<ActiveLedgerContextValue>(
    () => ({ ledger, ledgers, setActiveLedgerId: setActive, isLoading: false, error: null }),
    [ledger, setActive],
  );
  return <ActiveLedgerContext.Provider value={value}>{children}</ActiveLedgerContext.Provider>;
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <output data-testid="location">
        {location.pathname}
        {location.search}
      </output>
      <button
        type="button"
        onClick={() => {
          void navigate(-1);
        }}
      >
        返回
      </button>
    </div>
  );
}

async function focusWithTab(user: { tab: () => Promise<void> }, target: HTMLElement) {
  if (document.activeElement === target) {
    return;
  }
  for (let index = 0; index < 100; index += 1) {
    await user.tab();
    if (document.activeElement === target) {
      return;
    }
  }
  throw new Error('Tab sequence did not reach the requested control.');
}
