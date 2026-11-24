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
import {
  getChartColorForId,
  CATEGORY_CHART_COLORS,
} from '../features/statistics/charts/chart-colors';
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
      if (path.endsWith('/categories')) {
        const ledgerId = path.split('/')[2];
        const ids = ledgerId === 'family' ? ['supplies', 'dinner'] : ['lunch', 'breakfast'];
        return Promise.resolve(
          ids.map((id, sortOrder) => ({ id, sortOrder, type: 'EXPENSE' })),
        ) as Promise<T>;
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

  return {
    ledgerId,
    from: '2026-10-01',
    to: '2026-10-31',
    ledger: shared ? totals(20_000, 120_000, -100_000) : totals(0, 70_300, -70_300),
    mine: shared ? totals(20_000, 45_000, -25_000) : totals(0, 70_300, -70_300),
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
      const perspective = (url.searchParams.get('perspective') ??
        'LEDGER') as StatisticsPerspective;
      return Promise.resolve(statsFor(ledgerId, perspective));
    });
    statisticsApi.getTrend.mockImplementation((path) => {
      const url = new URL(path, 'http://localhost');
      const endMonth = url.searchParams.get('endMonth') ?? '2026-10';
      const monthCount = Number(url.searchParams.get('months') ?? 12);
      return Promise.resolve({
        ledgerId: familyLedger.id,
        months: Array.from({ length: monthCount }, (_, index) => {
          const [year, month] = endMonth.split('-').map(Number);
          const date = new Date(Date.UTC(year ?? 2026, (month ?? 10) - monthCount + index, 1));
          return {
            month: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
            income: 0,
            expense: 0,
            net: 0,
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

  it('uses the URL ledger, shows category summaries, and selects a category only in ledger perspective', async () => {
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
        '/stats?tab=cat&ledger=family&month=2026-10&perspective=LEDGER',
      ),
    );

    await user.click(screen.getByRole('button', { name: '我' }));
    const mineCategoryList = await screen.findByRole('list', { name: '支出分類清單' });
    expect(within(mineCategoryList).getByText('晚餐').parentElement).toHaveTextContent('$450100%');
    expect(within(mineCategoryList).queryByRole('button')).not.toBeInTheDocument();
    expect(
      within(mineCategoryList).queryByRole('button', { name: /日用品/ }),
    ).not.toBeInTheDocument();
    expect(summary.getByText('-$250')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '帳本' }));
    const ledgerCategoryList = await screen.findByRole('list', { name: '支出分類清單' });
    await user.click(within(ledgerCategoryList).getByRole('button', { name: /晚餐，\$900，75%/ }));
    expect(screen.getByText('交易頁')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/transactions?ledger=family&type=EXPENSE&categoryId=dinner&from=2026-10-01&to=2026-10-31',
    );
    await user.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/stats?tab=cat&ledger=family&month=2026-10&perspective=LEDGER',
      ),
    );
    expect(await screen.findByRole('heading', { name: '統計' })).toBeInTheDocument();
  });

  it('pushes ledger changes and restores the previous ledger and summary on browser back', async () => {
    const user = userEvent.setup();
    const previous = '/stats?tab=cat&ledger=family&month=2026-09&perspective=LEDGER';
    const current = '/stats?tab=cat&ledger=family&month=2026-10&perspective=LEDGER';
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
        '/stats?tab=cat&ledger=daily&month=2026-10&perspective=LEDGER',
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
    const initial = '/stats?tab=cat&ledger=family&month=2026-10&perspective=LEDGER';
    renderPage(initial, { initialLedgerId: familyLedger.id });

    const firstCategoryList = await screen.findByRole('list', { name: '支出分類清單' });
    const summary = within(screen.getByRole('region', { name: '收支摘要' }));
    expect(summary.getByRole('definition', { name: '收入 $200' })).toBeInTheDocument();
    expect(summary.getByRole('definition', { name: '支出 $1,200' })).toBeInTheDocument();
    expect(
      within(firstCategoryList).getByRole('button', { name: '晚餐，$900，75%' }),
    ).toBeInTheDocument();

    const trendTab = screen.getByRole('button', { name: '趨勢' });
    await focusWithTab(user, trendTab);
    await user.keyboard('{Enter}');
    await screen.findByRole('region', { name: '收支趨勢圖' });

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
        '/stats?tab=cat&ledger=daily&month=2026-10&perspective=LEDGER',
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
    await user.click(screen.getByRole('button', { name: '成員' }));
    const members = await screen.findByRole('list', { name: '成員收支' });
    expect(within(members).getAllByTestId('statistics-list-bar')).toHaveLength(2);
    expect(screen.queryByRole('group', { name: '成員圖型' })).not.toBeInTheDocument();
    expect(statisticsApi.getStatistics).toHaveBeenCalledTimes(1);
    expect(getItem).not.toHaveBeenCalledWith('stats.chart');
    expect(setItem).not.toHaveBeenCalledWith('stats.chart', expect.anything());
  });

  it.each([
    ['cat', 'bar'],
    ['member', 'bar'],
    ['trend', 'table'],
  ])('replaces the old chart URL on %s', async (tab, chart) => {
    const user = userEvent.setup();
    const previous = '/stats?tab=cat&ledger=family&month=2026-09&perspective=LEDGER';
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
    'renders categories and members in viewport reading order (narrow: %s)',
    async (matches) => {
      vi.stubGlobal(
        'matchMedia',
        vi
          .fn()
          .mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
      );
      try {
        const user = userEvent.setup();
        renderPage('/stats?tab=cat&ledger=family&month=2026-10');
        for (const [tab, listLabel, chartLabel] of [
          ['分類', '支出分類清單', '支出分類圓餅圖'],
          ['成員', '成員收支', '成員支出圓餅圖'],
        ] as const) {
          await user.click(screen.getByRole('button', { name: tab }));
          const list = await screen.findByRole('list', { name: listLabel });
          const chart = screen.getByRole('region', { name: chartLabel });
          const position = list.compareDocumentPosition(chart);
          expect(position).toBe(
            matches ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING,
          );
        }
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('changes which member amount is primary and keeps zero values visible', async () => {
    const user = userEvent.setup();
    renderPage('/stats?tab=member&ledger=family&month=2026-10');
    const members = await screen.findByRole('list', { name: '成員收支' });
    const member = within(members).getByRole('listitem', { name: '小美，支出 $750，收入 $0' });
    expect(member.querySelector('strong')).toHaveTextContent('$750');
    expect(member.querySelector('small')).toHaveTextContent('收入 $0');
    expect(within(member).getByTestId('statistics-list-bar')).toHaveStyle({ width: '100%' });
    await user.click(
      within(screen.getByRole('group', { name: '成員收支方向' })).getByRole('button', {
        name: '收入',
      }),
    );
    expect(member.querySelector('strong')).toHaveTextContent('$0');
    expect(member.querySelector('small')).toHaveTextContent('支出 $750');
    expect(within(member).getByTestId('statistics-list-bar')).toHaveStyle({ width: '0%' });
  });

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
        '/stats?tab=trend&ledger=family&month=2026-09&perspective=LEDGER',
      ),
    );
    expect(await screen.findByText('2025 年 10 月 – 2026 年 9 月')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '返回' }));
    expect(await screen.findByTestId('location')).toHaveTextContent(
      '/stats?tab=trend&ledger=family&from=2026-10-05&to=2026-10-20&perspective=LEDGER',
    );
  });

  it('uses the selected month, year end, and custom end month for trend requests', async () => {
    const user = userEvent.setup();
    renderPage('/stats?tab=trend&ledger=family&month=2026-07');
    await screen.findByRole('region', { name: '收支趨勢圖' });

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

  it('locks the member perspective, normalizes member URLs, and falls back to categories on a personal ledger', async () => {
    const user = userEvent.setup();
    renderPage('/stats?tab=member&ledger=family&month=2026-10&perspective=MINE');

    const memberList = await screen.findByRole('list', { name: '成員收支' });
    expect(within(memberList).getByText('我')).toBeInTheDocument();
    expect(
      within(memberList).getByRole('listitem', {
        name: '我，支出 $450，收入 $200',
      }),
    ).toBeInTheDocument();
    expect(within(memberList).getByText('$450')).toBeInTheDocument();
    expect(within(memberList).getByText('收入 $200')).toBeInTheDocument();
    expect(within(memberList).getByText('$750')).toBeInTheDocument();
    expect(within(memberList).getByText('收入 $0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '帳本' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '我' })).toBeDisabled();
    expect(screen.getByTestId('location')).toHaveTextContent(
      'tab=member&ledger=family&month=2026-10&perspective=LEDGER',
    );

    const switcher = screen.getByRole('group', { name: '作用中帳本' });
    await user.click(within(switcher).getByRole('button'));
    await user.click(screen.getByRole('option', { name: /日常/ }));
    expect(await screen.findByRole('button', { name: '分類' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('button', { name: '成員' })).not.toBeInTheDocument();
  });

  it('matches member bars to donut slices in both themes', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    renderPage('/stats?tab=member&ledger=family&month=2026-10');

    const members = await screen.findByRole('list', { name: '成員收支' });
    const me = within(members).getByRole('listitem', { name: '我，支出 $450，收入 $200' });
    const bar = within(me).getByTestId('statistics-list-bar');
    const donut = screen.getByRole('img', { name: /成員支出圓餅圖/ });
    const slice = donut.querySelector('path');

    expect(bar).toHaveStyle({ width: '60%' });
    expect(bar.style.getPropertyValue('--bar-color')).toBe(getChartColorForId('me', 'dark'));
    expect(slice).toHaveAttribute('stroke', getChartColorForId('me', 'dark'));

    document.documentElement.setAttribute('data-theme', 'light');
    await waitFor(() => {
      const color = getChartColorForId('me', 'light');
      expect(bar.style.getPropertyValue('--bar-color')).toBe(color);
      expect(slice).toHaveAttribute('stroke', color);
    });
  });

  it('keeps summary and category data visible when trend fails, and hides zero totals when statistics fail', async () => {
    statisticsApi.getTrend.mockRejectedValue(new Error('trend failed'));
    renderPage('/stats?tab=trend&ledger=family&month=2026-10');

    expect(await screen.findByRole('alert')).toHaveTextContent('趨勢暫時無法載入');
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
