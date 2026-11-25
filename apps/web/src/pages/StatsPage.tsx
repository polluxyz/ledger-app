import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { StatisticsGroup } from '@ledger/shared';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAccounts } from '../features/accounts/use-accounts';
import { useCurrentUser } from '../features/auth/use-current-user';
import { useLedgerPeople } from '../features/ledger-people/use-ledger-people';
import { ApiError } from '../lib/api-client';
import { Button } from '../components/Button';
import { PageContent } from '../components/PageContent';
import { PageHeader } from '../components/PageHeader';
import {
  ActiveLedgerContext,
  type ActiveLedgerContextValue,
} from '../features/ledgers/active-ledger-context';
import { LedgerSwitcher } from '../features/ledgers/LedgerSwitcher';
import { useActiveLedger } from '../features/ledgers/use-active-ledger';
import { useCategories } from '../features/categories/use-categories';
import { CategoryLegendList } from '../features/statistics/charts/CategoryLegendList';
import { DonutChart } from '../features/statistics/charts/DonutChart';
import { StatisticsTrendChart } from '../features/statistics/charts/StatisticsTrendChart';
import { useChartTheme } from '../features/statistics/charts/use-chart-theme';
import { createCategoryGroupColor } from '../features/statistics/charts/chart-colors';
import { StatisticsFilter, StatisticsFilterTags } from '../features/statistics/StatisticsFilter';
import {
  clearInvalidStatsFilters,
  countStatsFilters,
  EMPTY_STATS_FILTERS,
  type FilterLists,
  type StatsFilters,
} from '../features/statistics/statistics-filters';
import { useLedgerStatistics } from '../features/statistics/use-ledger-statistics';
import {
  getStatsPeriodEndMonth,
  getStatsPeriodRange,
  isValidCustomDateRange,
  parseStatsUrl,
  serializeStatsUrl,
  type StatsPeriod,
  type StatsTab,
  type StatsUrlState,
} from '../features/statistics/stats-url';
import { useStatisticsTrend } from '../features/statistics/use-statistics-trend';
import { formatMoney } from '../lib/format';
import styles from './StatsPage.module.css';

type Direction = 'expense' | 'income';

const TAB_LABELS: Record<StatsTab, string> = {
  cat: '分類',
  trend: '每月收支',
};

/**
 * 統計頁把網址當成可分享的頁面狀態，摘要與分類共用一份後端回應；趨勢另用
 * 一份查詢。收支方向只改呈現，舊網址的圖型參數會移除。
 */
export default function StatsPage() {
  const {
    ledger,
    ledgers,
    setActiveLedgerId,
    isLoading: ledgerLoading,
    error: ledgerError,
  } = useActiveLedger();
  const location = useLocation();
  const navigate = useNavigate();
  const [direction, setDirection] = useState<Direction>('expense');

  const urlLedgerId = new URLSearchParams(location.search).get('ledger')?.trim() || null;
  const urlLedger = urlLedgerId ? ledgers.find((item) => item.id === urlLedgerId) : undefined;
  const selectedLedger = urlLedger ?? ledger;

  const ledgerId = selectedLedger?.id ?? null;
  const shared = selectedLedger?.kind === 'SHARED';
  const people = useLedgerPeople(ledgerId, shared);
  const currentUser = useCurrentUser();
  const categories = useCategories(ledgerId);
  const accounts = useAccounts();
  const legacyMine = shared && new URLSearchParams(location.search).get('perspective') === 'MINE';
  const self =
    currentUser.data && people.data?.find((person) => person.userId === currentUser.data.id);
  const legacyUnavailable =
    legacyMine &&
    !self &&
    (currentUser.isError || people.isError || (currentUser.isSuccess && people.isSuccess));

  const state = useMemo<StatsUrlState>(() => {
    const { state } = parseStatsUrl(location.search, { defaultLedgerId: ledgerId });
    return {
      ...state,
      ledgerId,
      filters: legacyMine && self ? { ...state.filters, personIds: [self.id] } : state.filters,
    };
  }, [ledgerId, location.search, legacyMine, self]);
  const canonicalSearch = serializeStatsUrl(state);
  const lists: FilterLists = {
    personIds: shared ? people.data : currentUser.data ? [currentUser.data] : undefined,
    categoryIds: categories.data
      ?.slice()
      .sort(
        (left, right) =>
          left.type.localeCompare(right.type) ||
          left.sortOrder - right.sortOrder ||
          left.id.localeCompare(right.id),
      ),
    accountIds: accounts.data,
  };
  const periodRange = getStatsPeriodRange(state.period);
  const periodKey = statsPeriodKey(state.period);
  const [customRangeDraft, setCustomRangeDraft] = useState<{
    periodKey: string;
    range: { from: string; to: string };
  } | null>(null);
  const customRange =
    customRangeDraft?.periodKey === periodKey ? customRangeDraft.range : periodRange;
  const endMonth = getStatsPeriodEndMonth(state.period);
  const queryLedgerId = ledgerLoading || (legacyMine && !self) ? null : ledgerId;
  const hasFilters = countStatsFilters(state.filters) > 0;
  const statistics = useLedgerStatistics(queryLedgerId, {
    ...periodRange,
    ...state.filters,
    perspective: 'LEDGER',
  });
  // 有篩選時一併驗證趨勢查詢，任一端點拒絕條件都要隱藏金額。
  const trend = useStatisticsTrend(state.tab === 'trend' || hasFilters ? queryLedgerId : null, {
    endMonth,
    months: 12,
    ...state.filters,
    perspective: 'LEDGER',
  });
  const invalidFilters =
    legacyUnavailable ||
    (hasFilters && (isBadRequest(statistics.error) || isBadRequest(trend.error)));
  const waitingForFilters =
    (legacyMine && !self) || (hasFilters && (statistics.isLoading || trend.isLoading));
  const categoryLinks = !(
    state.filters.personIds.length ||
    state.filters.accountIds.length ||
    state.filters.includeOtherAccounts
  );
  const chartTheme = useChartTheme();

  useEffect(() => {
    if (!ledgerLoading && urlLedger && ledger?.id !== urlLedger.id) {
      setActiveLedgerId(urlLedger.id);
    }
  }, [ledger?.id, ledgerLoading, setActiveLedgerId, urlLedger]);

  useEffect(() => {
    if (legacyMine && !self) return;
    let search = canonicalSearch;
    if (ledgerLoading || !selectedLedger) {
      const params = new URLSearchParams(location.search);
      if (!params.has('chart')) return;
      params.delete('chart');
      search = params.toString();
      if (search) search = '?' + search;
    }
    if (location.search !== search) {
      void navigate(
        { pathname: location.pathname, search, hash: location.hash },
        { replace: true },
      );
    }
  }, [
    canonicalSearch,
    ledgerLoading,
    legacyMine,
    self,
    location.hash,
    location.pathname,
    location.search,
    navigate,
    selectedLedger,
  ]);

  function updateUrl(next: StatsUrlState, replace = false) {
    void navigate(
      { pathname: location.pathname, search: serializeStatsUrl(next), hash: location.hash },
      { replace },
    );
  }

  function changeFilters(filters: StatsFilters) {
    if (legacyMine && !self) return;
    updateUrl({ ...state, filters });
  }

  function removeInvalidFilters() {
    const filters = legacyUnavailable
      ? EMPTY_STATS_FILTERS
      : clearInvalidStatsFilters(state.filters, lists);
    updateUrl({ ...state, filters }, true);
  }

  function changePeriod(period: StatsPeriod) {
    if (legacyMine && !self) return;
    updateUrl({ ...state, period });
  }

  function selectTrendMonth(month: string) {
    changePeriod({ mode: 'month', month });
  }

  function selectCategory(group: StatisticsGroup) {
    if (!categoryLinks || group.kind !== 'CATEGORY' || !group.category) {
      return;
    }
    const params = new URLSearchParams({
      ledger: state.ledgerId ?? '',
      type: direction === 'expense' ? 'EXPENSE' : 'INCOME',
      categoryId: group.category.id,
      from: periodRange.from,
      to: periodRange.to,
    });
    void navigate(`/transactions?${params.toString()}`);
  }

  const setSwitcherLedger = useCallback(
    (ledgerId: string) => {
      setActiveLedgerId(ledgerId);
      void navigate({
        pathname: location.pathname,
        search: serializeStatsUrl({ ...state, ledgerId }),
      });
    },
    [location.pathname, navigate, setActiveLedgerId, state],
  );
  const switcherContext = useMemo<ActiveLedgerContextValue>(
    () => ({
      ledger: selectedLedger ?? null,
      ledgers,
      setActiveLedgerId: setSwitcherLedger,
      isLoading: ledgerLoading,
      error: ledgerError,
    }),
    [ledgerError, ledgerLoading, ledgers, selectedLedger, setSwitcherLedger],
  );

  if (ledgerLoading) {
    return (
      <PageContent>
        <PageHeader title="統計" />
        <p className={styles.status} role="status">
          載入中…
        </p>
      </PageContent>
    );
  }
  if (ledgerError) {
    return (
      <PageContent>
        <PageHeader title="統計" />
        <p className={styles.status} role="alert">
          帳本暫時無法載入
        </p>
      </PageContent>
    );
  }
  if (!selectedLedger) {
    return (
      <PageContent>
        <PageHeader title="統計" />
        <p className={styles.status}>找不到任何帳本。</p>
      </PageContent>
    );
  }

  const groups =
    direction === 'expense'
      ? (statistics.data?.expenseGroups ?? [])
      : (statistics.data?.incomeGroups ?? []);
  const categoryColorOf = createCategoryGroupColor(
    categories.data,
    direction === 'expense' ? 'EXPENSE' : 'INCOME',
    groups,
    chartTheme,
  );
  const totals = statistics.data?.totals;

  return (
    <PageContent>
      <PageHeader title="統計" />
      <section className={styles.filters} aria-label="統計篩選">
        <div className={styles.filterRow}>
          <ActiveLedgerContext.Provider value={switcherContext}>
            <LedgerSwitcher />
          </ActiveLedgerContext.Provider>
          <PeriodControls
            period={state.period}
            customRange={customRange}
            onCustomRangeChange={(range) => setCustomRangeDraft({ periodKey, range })}
            onChange={changePeriod}
          />
        </div>

        <section className={styles.summary} aria-label="收支摘要">
          {invalidFilters ? (
            <div>
              <p className={styles.status} role="alert">
                部分篩選條件已失效。
              </p>
              <Button type="button" variant="secondary" onClick={removeInvalidFilters}>
                清除失效條件
              </Button>
            </div>
          ) : statistics.error ? (
            <p className={styles.status} role="alert">
              統計暫時無法載入
            </p>
          ) : waitingForFilters || statistics.isLoading || !totals ? (
            <p className={styles.status} role="status">
              載入中…
            </p>
          ) : (
            <dl>
              <div>
                <dt>收入</dt>
                <dd aria-label={`收入 ${formatMoney(totals.income)}`}>
                  {formatMoney(totals.income)}
                </dd>
              </div>
              <div>
                <dt>支出</dt>
                <dd aria-label={`支出 ${formatMoney(totals.expense)}`}>
                  {formatMoney(totals.expense)}
                </dd>
              </div>
              <div className={styles.net}>
                <dt>結餘</dt>
                <dd aria-label={`結餘 ${formatMoney(totals.net)}`}>{formatMoney(totals.net)}</dd>
              </div>
            </dl>
          )}
        </section>
      </section>

      <div className={styles.stickyTabs}>
        <nav className={styles.tabs} aria-label="統計分頁">
          {(['cat', 'trend'] as const).map((tab) => (
            <button
              type="button"
              key={tab}
              aria-pressed={state.tab === tab}
              disabled={legacyMine && !self}
              onClick={() => updateUrl({ ...state, tab })}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </nav>
      </div>

      <section className={styles.panel} aria-label={TAB_LABELS[state.tab]}>
        <div className={styles.panelHeading}>
          {state.tab === 'cat' ? (
            <div className={styles.directionSwitch} role="group" aria-label="收支方向">
              <button
                type="button"
                aria-pressed={direction === 'expense'}
                onClick={() => setDirection('expense')}
              >
                支出
              </button>
              <button
                type="button"
                aria-pressed={direction === 'income'}
                onClick={() => setDirection('income')}
              >
                收入
              </button>
            </div>
          ) : (
            <p className={styles.monthRange}>
              {formatMonth(shiftMonth(endMonth, -11))} – {formatMonth(endMonth)}
            </p>
          )}
          {(!legacyMine || self) && (
            <StatisticsFilter
              key={ledgerId}
              filters={state.filters}
              showPeople={shared}
              lists={lists}
              onChange={changeFilters}
            />
          )}
        </div>
        <StatisticsFilterTags filters={state.filters} lists={lists} onChange={changeFilters} />
        {!invalidFilters && state.tab === 'cat' && (
          <>
            {statistics.error ? (
              <p className={styles.status} role="alert">
                統計暫時無法載入
              </p>
            ) : waitingForFilters || statistics.isLoading || !statistics.data ? (
              <p className={styles.status} role="status">
                載入中…
              </p>
            ) : (
              <ChartAndList
                chart={
                  <DonutChart
                    direction={direction}
                    totalAmount={statistics.data.totals[direction]}
                    title={direction === 'expense' ? '支出分類圓餅圖' : '收入分類圓餅圖'}
                    theme={chartTheme}
                    data={{
                      kind: 'groups',
                      items: groups,
                      colorOf: categoryColorOf,
                      onSelect: categoryLinks ? selectCategory : undefined,
                    }}
                  />
                }
                list={
                  <CategoryLegendList
                    items={groups}
                    direction={direction}
                    theme={chartTheme}
                    colorOf={categoryColorOf}
                    onSelect={categoryLinks ? selectCategory : undefined}
                  />
                }
              />
            )}
          </>
        )}

        {!invalidFilters && state.tab === 'trend' && (
          <>
            {trend.error ? (
              <p className={styles.status} role="alert">
                每月收支暫時無法載入
              </p>
            ) : waitingForFilters || trend.isLoading || !trend.data ? (
              <p className={styles.status} role="status">
                載入中…
              </p>
            ) : (
              <StatisticsTrendChart
                key={periodKey}
                months={trend.data.months}
                averageIncome={trend.data.averageIncome}
                averageExpense={trend.data.averageExpense}
                averageMonthCount={trend.data.averageMonthCount}
                selectedMonth={endMonth}
                showSelectedDetails={state.period.mode !== 'month'}
                onSelectMonth={selectTrendMonth}
              />
            )}
          </>
        )}
      </section>
    </PageContent>
  );
}

/** 依畫面重新排列元件，讓鍵盤順序跟著欄位位置。 */
function ChartAndList({ chart, list }: { chart: ReactNode; list: ReactNode }) {
  const [narrow, setNarrow] = useState(
    () => window.matchMedia?.('(max-width: 900px)').matches ?? false,
  );

  useEffect(() => {
    const viewport = window.matchMedia?.('(max-width: 900px)');
    if (!viewport) return;
    const sync = () => setNarrow(viewport.matches);
    viewport.addEventListener('change', sync);
    sync();
    return () => viewport.removeEventListener('change', sync);
  }, []);

  const chartColumn = <div key="chart">{chart}</div>;
  const listColumn = <div key="list">{list}</div>;
  return (
    <div className={styles.categoryLayout}>
      {narrow ? [chartColumn, listColumn] : [listColumn, chartColumn]}
    </div>
  );
}

interface PeriodControlsProps {
  period: StatsPeriod;
  customRange: { from: string; to: string };
  onCustomRangeChange: (range: { from: string; to: string }) => void;
  onChange: (period: StatsPeriod) => void;
}

function PeriodControls({
  period,
  customRange,
  onCustomRangeChange,
  onChange,
}: PeriodControlsProps) {
  const currentMonth = getStatsPeriodEndMonth(period);
  const currentYear = currentMonth.slice(0, 4);
  const mode = period.mode;

  function selectMode(nextMode: StatsPeriod['mode']) {
    if (nextMode === 'month') {
      onChange({ mode: 'month', month: currentMonth });
    } else if (nextMode === 'year') {
      onChange({ mode: 'year', year: currentYear });
    } else {
      const range = getStatsPeriodRange(period);
      onCustomRangeChange(range);
      if (isValidCustomDateRange(range.from, range.to)) {
        onChange({ mode: 'custom', ...range });
      }
    }
  }

  return (
    <div className={styles.periodControls}>
      <div className={styles.periodModes} role="group" aria-label="期間類型">
        <button type="button" aria-pressed={mode === 'month'} onClick={() => selectMode('month')}>
          月
        </button>
        <button type="button" aria-pressed={mode === 'year'} onClick={() => selectMode('year')}>
          年
        </button>
        <button type="button" aria-pressed={mode === 'custom'} onClick={() => selectMode('custom')}>
          自訂
        </button>
      </div>
      {mode === 'month' ? (
        <div className={styles.periodStepper} aria-label="月份">
          <button
            type="button"
            aria-label="上一個月"
            onClick={() => onChange({ mode: 'month', month: shiftMonth(currentMonth, -1) })}
          >
            ‹
          </button>
          <strong>{formatMonth(currentMonth)}</strong>
          <button
            type="button"
            aria-label="下一個月"
            onClick={() => onChange({ mode: 'month', month: shiftMonth(currentMonth, 1) })}
          >
            ›
          </button>
        </div>
      ) : mode === 'year' ? (
        <div className={styles.periodStepper} aria-label="年份">
          <button
            type="button"
            aria-label="上一年"
            onClick={() =>
              onChange({ mode: 'year', year: String(Number(currentYear) - 1).padStart(4, '0') })
            }
          >
            ‹
          </button>
          <strong>{currentYear} 年</strong>
          <button
            type="button"
            aria-label="下一年"
            onClick={() =>
              onChange({ mode: 'year', year: String(Number(currentYear) + 1).padStart(4, '0') })
            }
          >
            ›
          </button>
        </div>
      ) : (
        <form
          className={styles.customPeriod}
          onSubmit={(event) => {
            event.preventDefault();
            if (isValidCustomDateRange(customRange.from, customRange.to)) {
              onChange({ mode: 'custom', ...customRange });
            }
          }}
        >
          <label>
            起日
            <input
              aria-label="自訂起日"
              type="date"
              value={customRange.from}
              onChange={(event) =>
                onCustomRangeChange({ ...customRange, from: event.target.value })
              }
            />
          </label>
          <label>
            迄日
            <input
              aria-label="自訂迄日"
              type="date"
              value={customRange.to}
              onChange={(event) => onCustomRangeChange({ ...customRange, to: event.target.value })}
            />
          </label>
          <button
            type="submit"
            disabled={!isValidCustomDateRange(customRange.from, customRange.to)}
          >
            套用
          </button>
        </form>
      )}
    </div>
  );
}

function isBadRequest(error: unknown) {
  return error instanceof ApiError && error.statusCode === 400;
}

function shiftMonth(month: string, amount: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year ?? 2026, (monthNumber ?? 1) - 1 + amount, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatMonth(month: string): string {
  const [year, monthNumber] = month.split('-');
  return `${year} 年 ${Number(monthNumber)} 月`;
}

function statsPeriodKey(period: StatsPeriod): string {
  if (period.mode === 'month') {
    return `month:${period.month}`;
  }
  if (period.mode === 'year') {
    return `year:${period.year}`;
  }
  return `custom:${period.from}:${period.to}`;
}
