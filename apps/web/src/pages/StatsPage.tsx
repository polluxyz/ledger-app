import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StatisticsGroup, StatisticsPerson, StatisticsPerspective } from '@ledger/shared';
import { useLocation, useNavigate } from 'react-router-dom';
import { PageContent } from '../components/PageContent';
import { PageHeader } from '../components/PageHeader';
import {
  ActiveLedgerContext,
  type ActiveLedgerContextValue,
} from '../features/ledgers/active-ledger-context';
import { LedgerSwitcher } from '../features/ledgers/LedgerSwitcher';
import { useActiveLedger } from '../features/ledgers/use-active-ledger';
import { CategoryLegendList } from '../features/statistics/charts/CategoryLegendList';
import {
  ChartTypeSwitch,
  type ChartTypeOption,
} from '../features/statistics/charts/ChartTypeSwitch';
import { DonutChart } from '../features/statistics/charts/DonutChart';
import { HorizontalBarChart } from '../features/statistics/charts/HorizontalBarChart';
import { TrendBarChart } from '../features/statistics/charts/TrendBarChart';
import { TrendLineChart } from '../features/statistics/charts/TrendLineChart';
import { TrendTable } from '../features/statistics/charts/TrendTable';
import type { ChartTheme } from '../features/statistics/charts/chart-colors';
import type { ChartType } from '../features/statistics/charts/chart-types';
import { useLedgerStatistics } from '../features/statistics/use-ledger-statistics';
import {
  getStatsPeriodEndMonth,
  getStatsPeriodRange,
  isValidCustomDateRange,
  parseStatsUrl,
  readStatsChartPreferences,
  saveStatsChartPreference,
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
  trend: '趨勢',
  member: '成員',
};

const CHART_OPTIONS: Record<StatsTab, readonly ChartTypeOption[]> = {
  cat: [
    { value: 'donut', label: '圓餅' },
    { value: 'bar', label: '長條' },
  ],
  trend: [
    { value: 'bar', label: '長條' },
    { value: 'line', label: '折線' },
    { value: 'table', label: '表格' },
  ],
  member: [
    { value: 'bar', label: '長條' },
    { value: 'donut', label: '圓餅' },
  ],
};

/**
 * 統計頁把網址當成可分享的頁面狀態，摘要、分類與成員共用一份後端回應；趨勢另用
 * 一份查詢。圖型與收支方向只改呈現，不加入 query key 或 localStorage 中的帳務資料。
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

  const state = useMemo<StatsUrlState>(() => {
    const parsed = parseStatsUrl(location.search, {
      ledgerKind: selectedLedger?.kind ?? 'PERSONAL',
      defaultLedgerId: selectedLedger?.id ?? ledger?.id ?? null,
    });
    return {
      ...parsed.state,
      ledgerId: selectedLedger?.id ?? null,
    };
  }, [ledger?.id, location.search, selectedLedger?.id, selectedLedger?.kind]);
  const canonicalSearch = serializeStatsUrl(state);
  const periodRange = getStatsPeriodRange(state.period);
  const periodKey = statsPeriodKey(state.period);
  const [customRangeDraft, setCustomRangeDraft] = useState<{
    periodKey: string;
    range: { from: string; to: string };
  } | null>(null);
  const customRange =
    customRangeDraft?.periodKey === periodKey ? customRangeDraft.range : periodRange;
  const endMonth = getStatsPeriodEndMonth(state.period);
  const effectivePerspective: StatisticsPerspective =
    state.tab === 'member' ? 'LEDGER' : state.perspective;
  const statistics = useLedgerStatistics(state.ledgerId, {
    ...periodRange,
    perspective: effectivePerspective,
  });
  const trend = useStatisticsTrend(state.tab === 'trend' ? state.ledgerId : null, {
    endMonth,
    months: 12,
    perspective: effectivePerspective,
  });
  const chartTheme = useChartTheme();

  useEffect(() => {
    if (!ledgerLoading && urlLedger && ledger?.id !== urlLedger.id) {
      setActiveLedgerId(urlLedger.id);
    }
  }, [ledger?.id, ledgerLoading, setActiveLedgerId, urlLedger]);

  useEffect(() => {
    if (ledgerLoading || !selectedLedger || location.search === canonicalSearch) {
      return;
    }
    void navigate({ pathname: location.pathname, search: canonicalSearch }, { replace: true });
  }, [
    canonicalSearch,
    ledgerLoading,
    location.pathname,
    location.search,
    navigate,
    selectedLedger,
  ]);

  function updateUrl(next: StatsUrlState, replace = false) {
    void navigate({ pathname: location.pathname, search: serializeStatsUrl(next) }, { replace });
  }

  function changeTab(tab: StatsTab) {
    const preferences = readStatsChartPreferences();
    updateUrl({
      ...state,
      tab,
      perspective: tab === 'member' ? 'LEDGER' : state.perspective,
      chart: preferences[tab],
    });
  }

  function changeChart(chart: ChartType) {
    saveStatsChartPreference(state.tab, chart);
    updateUrl({ ...state, chart }, true);
  }

  function changePeriod(period: StatsPeriod) {
    updateUrl({ ...state, period });
  }

  function changeLedgerPerspective(perspective: StatisticsPerspective) {
    updateUrl({ ...state, perspective });
  }

  function selectTrendMonth(month: string) {
    changePeriod({ mode: 'month', month });
  }

  function selectCategory(group: StatisticsGroup) {
    if (effectivePerspective !== 'LEDGER' || group.kind !== 'CATEGORY' || !group.category) {
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

  const totals = statistics.data
    ? effectivePerspective === 'LEDGER'
      ? statistics.data.ledger
      : statistics.data.mine
    : undefined;
  const groups =
    direction === 'expense'
      ? (statistics.data?.expenseGroups ?? [])
      : (statistics.data?.incomeGroups ?? []);
  const people = statistics.data?.people ?? [];
  const selectedAmount = direction === 'expense' ? totals?.expense : totals?.income;

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
          {selectedLedger.kind === 'SHARED' && (
            <div className={styles.switch} role="group" aria-label="統計口徑">
              <button
                type="button"
                aria-pressed={effectivePerspective === 'LEDGER'}
                disabled={state.tab === 'member'}
                onClick={() => changeLedgerPerspective('LEDGER')}
              >
                帳本
              </button>
              <button
                type="button"
                aria-pressed={effectivePerspective === 'MINE'}
                disabled={state.tab === 'member'}
                onClick={() => changeLedgerPerspective('MINE')}
              >
                我
              </button>
            </div>
          )}
        </div>

        <section className={styles.summary} aria-label="收支摘要">
          {statistics.error ? (
            <p className={styles.status} role="alert">
              統計暫時無法載入
            </p>
          ) : statistics.isLoading || !totals ? (
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
              <div>
                <dt>結餘</dt>
                <dd aria-label={`結餘 ${formatMoney(totals.net)}`}>{formatMoney(totals.net)}</dd>
              </div>
            </dl>
          )}
        </section>
      </section>

      <nav className={styles.tabs} aria-label="統計分頁">
        {(selectedLedger.kind === 'SHARED'
          ? (['cat', 'trend', 'member'] as const)
          : (['cat', 'trend'] as const)
        ).map((tab) => (
          <button
            type="button"
            key={tab}
            aria-pressed={state.tab === tab}
            onClick={() => changeTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </nav>

      <section className={styles.panel} aria-label={TAB_LABELS[state.tab]}>
        {state.tab === 'cat' && (
          <>
            <div className={styles.panelHeading}>
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
              <ChartTypeSwitch
                label="分類圖型"
                options={CHART_OPTIONS.cat}
                value={state.chart}
                onChange={changeChart}
              />
            </div>
            {statistics.error ? (
              <p className={styles.status} role="alert">
                統計暫時無法載入
              </p>
            ) : statistics.isLoading || !statistics.data ? (
              <p className={styles.status} role="status">
                載入中…
              </p>
            ) : (
              <div className={styles.categoryLayout}>
                {state.chart === 'donut' ? (
                  <DonutChart
                    direction={direction}
                    totalAmount={selectedAmount ?? 0}
                    title={direction === 'expense' ? '支出分類圓餅圖' : '收入分類圓餅圖'}
                    theme={chartTheme}
                    data={{
                      kind: 'groups',
                      items: groups,
                      onSelect: effectivePerspective === 'LEDGER' ? selectCategory : undefined,
                    }}
                  />
                ) : (
                  <HorizontalBarChart
                    direction={direction}
                    title={direction === 'expense' ? '支出分類長條圖' : '收入分類長條圖'}
                    theme={chartTheme}
                    data={{
                      kind: 'groups',
                      items: groups,
                      onSelect: effectivePerspective === 'LEDGER' ? selectCategory : undefined,
                    }}
                  />
                )}
                <CategoryLegendList
                  items={groups}
                  direction={direction}
                  theme={chartTheme}
                  onSelect={effectivePerspective === 'LEDGER' ? selectCategory : undefined}
                />
              </div>
            )}
          </>
        )}

        {state.tab === 'trend' && (
          <>
            <div className={styles.panelHeading}>
              <p className={styles.monthRange}>
                {formatMonth(shiftMonth(endMonth, -11))} – {formatMonth(endMonth)}
              </p>
              <ChartTypeSwitch
                label="趨勢圖型"
                options={CHART_OPTIONS.trend}
                value={state.chart}
                onChange={changeChart}
              />
            </div>
            {trend.error ? (
              <p className={styles.status} role="alert">
                趨勢暫時無法載入
              </p>
            ) : trend.isLoading || !trend.data ? (
              <p className={styles.status} role="status">
                載入中…
              </p>
            ) : state.chart === 'bar' ? (
              <TrendBarChart
                months={trend.data.months}
                selectedMonth={endMonth}
                onSelectMonth={selectTrendMonth}
              />
            ) : state.chart === 'line' ? (
              <TrendLineChart
                months={trend.data.months}
                selectedMonth={endMonth}
                onSelectMonth={selectTrendMonth}
              />
            ) : (
              <TrendTable months={trend.data.months} />
            )}
          </>
        )}

        {state.tab === 'member' && (
          <>
            <div className={styles.panelHeading}>
              <div className={styles.directionSwitch} role="group" aria-label="成員收支方向">
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
              <ChartTypeSwitch
                label="成員圖型"
                options={CHART_OPTIONS.member}
                value={state.chart}
                onChange={changeChart}
              />
            </div>
            {statistics.error ? (
              <p className={styles.status} role="alert">
                統計暫時無法載入
              </p>
            ) : statistics.isLoading || !statistics.data ? (
              <p className={styles.status} role="status">
                載入中…
              </p>
            ) : (
              <>
                <div className={styles.categoryLayout}>
                  {state.chart === 'donut' ? (
                    <DonutChart
                      direction={direction}
                      totalAmount={
                        direction === 'expense'
                          ? statistics.data.ledger.expense
                          : statistics.data.ledger.income
                      }
                      title={direction === 'expense' ? '成員支出圓餅圖' : '成員收入圓餅圖'}
                      theme={chartTheme}
                      data={{
                        kind: 'people',
                        items: people,
                        denominator:
                          direction === 'expense'
                            ? statistics.data.ledger.expense
                            : statistics.data.ledger.income,
                      }}
                    />
                  ) : (
                    <HorizontalBarChart
                      direction={direction}
                      title={direction === 'expense' ? '成員支出長條圖' : '成員收入長條圖'}
                      theme={chartTheme}
                      data={{ kind: 'people', items: people }}
                    />
                  )}
                </div>
                <MemberTotals people={people} />
              </>
            )}
          </>
        )}
      </section>
    </PageContent>
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

function MemberTotals({ people }: { people: readonly StatisticsPerson[] }) {
  return (
    <ul className={styles.memberTotals} aria-label="成員收支">
      {people.map((person) => (
        <li
          key={person.personId}
          aria-label={`${person.name}，支出 ${formatMoney(person.expense)}，收入 ${formatMoney(person.income)}`}
        >
          <strong>{person.name}</strong>
          <span>支出 {formatMoney(person.expense)}</span>
          <span>收入 {formatMoney(person.income)}</span>
        </li>
      ))}
      {people.length === 0 && <li className={styles.status}>沒有資料</li>}
    </ul>
  );
}

function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(readChartTheme);

  useEffect(() => {
    const root = document.documentElement;
    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
    const update = () => setTheme(readChartTheme());
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    media?.addEventListener?.('change', update);
    return () => {
      observer.disconnect();
      media?.removeEventListener?.('change', update);
    };
  }, []);

  return theme;
}

function readChartTheme(): ChartTheme {
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'light' || explicit === 'dark') {
    return explicit;
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
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
