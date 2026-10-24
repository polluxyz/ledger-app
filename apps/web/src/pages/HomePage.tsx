import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { Link } from 'react-router-dom';
import type {
  LedgerSummary,
  MarkedTransaction,
  StatisticsGroup,
  StatisticsTotals,
  Transaction,
} from '@ledger/shared';
import { useRightPanel } from '../app/right-panel-context';
import { homeCategoryColor, useHomeCategoryColors } from '../app/use-home-category-colors';
import { Button } from '../components/Button';
import { FormError } from '../components/FormError';
import { Icon } from '../components/Icon';
import { PageContent } from '../components/PageContent';
import { PageHeader } from '../components/PageHeader';
import { AccountsQueryProvider, useAccounts } from '../features/accounts/use-accounts';
import { AssetCard } from '../features/accounts/AssetCard';
import { useCounterparties } from '../features/debts/use-debts';
import { DebtsCard } from '../features/debts/DebtsCard';
import { useLedgerGroups } from '../features/ledger-people/use-ledger-pointers';
import { AuthDialog, type AuthDialogMode } from '../features/auth/AuthDialog';
import { useAuth } from '../features/auth/use-auth';
import { LedgerSwitcher } from '../features/ledgers/LedgerSwitcher';
import { useActiveLedger } from '../features/ledgers/use-active-ledger';
import { BalanceTrendChart } from '../features/statistics/BalanceTrendChart';
import { HomeCategorySection } from '../features/statistics/HomeCategorySection';
import { useChartTheme } from '../features/statistics/charts/use-chart-theme';
import { currentTaiwanMonthRange } from '../features/statistics/stats-url';
import { useBalanceTrend } from '../features/statistics/use-balance-trend';
import { useLedgerStatistics } from '../features/statistics/use-ledger-statistics';
import {
  TransactionWorkbench,
  type PanelTarget,
} from '../features/transactions/TransactionWorkbench';
import { TransactionList } from '../features/transactions/TransactionList';
import { useTransactions } from '../features/transactions/use-transactions';
import { useMarkedTransactions, useSetTransactionMark } from '../features/transactions/use-marks';
import { PendingCard } from '../features/linking/PendingCard';
import { formatMoney } from '../lib/format';
import styles from './HomePage.module.css';

/** 首頁最近交易由後端排序與截斷，前端只指定要看的五筆。 */
const RECENT_LIMIT = 5;

type HomeActivityTab = 'recent' | 'marked';
type MarkedActionIntent = 'edit' | 'fillAccount';

interface PendingMarkedAction {
  transaction: MarkedTransaction;
  intent: MarkedActionIntent;
}

/**
 * 首頁把帳本摘要、最近交易、標註與資產卡組在一起；數字、分類與排序都直接呈現 API 回應。
 * 只有登入首頁提供帳戶 query context，讓右側表單和待處理卡共用同一份使用者帳戶資料。
 */
export default function HomePage() {
  const { isAuthenticated } = useAuth();
  // null = 彈窗關閉；登入 / 註冊共用同一個彈窗，只是預設顯示哪張表單不同。
  const [authDialog, setAuthDialog] = useState<AuthDialogMode | null>(null);

  if (isAuthenticated) {
    return <LedgerView />;
  }

  return (
    <>
      <GuestStatsRow />

      <section className={`${styles.card} ${styles.guest}`}>
        <p className={styles.note}>登入後即可開始記帳，並在這裡看到你的收支。</p>
        <div className={styles.actions}>
          <Button onClick={() => setAuthDialog('login')}>登入</Button>
          <Button variant="secondary" onClick={() => setAuthDialog('register')}>
            註冊
          </Button>
        </div>
      </section>

      {/* 登入成功後彈窗關閉，本頁就地換成已登入狀態——使用者不會被跳走。 */}
      <AuthDialog mode={authDialog} onClose={() => setAuthDialog(null)} />
    </>
  );
}

/**
 * 登入後維持帳戶、借還、標註與資產趨勢 query；切帳本只換帳本相關資料。
 * 帳戶 query 在 Provider 外建立，首頁的表單與待處理卡因此共用同一個 observer。
 */
function LedgerView() {
  const {
    ledger,
    setActiveLedgerId,
    isLoading: ledgerLoading,
    error: ledgerError,
  } = useActiveLedger();
  const accountsQuery = useAccounts();
  const balanceTrendQuery = useBalanceTrend();
  const counterpartiesQuery = useCounterparties({ nonZero: true, limit: 5 });
  const unpointedLedgersQuery = useLedgerGroups({ unpointed: true });
  const [markedExpanded, setMarkedExpanded] = useState(false);
  const markedQuery = useMarkedTransactions(markedExpanded);
  const [activityTab, setActivityTab] = useState<HomeActivityTab>('recent');
  const [pendingMarkedAction, setPendingMarkedAction] = useState<PendingMarkedAction | null>(null);
  const recentTabRef = useRef<HTMLButtonElement>(null);
  const markedTabRef = useRef<HTMLButtonElement>(null);
  const hasMarkedTab = Boolean(markedQuery.error) || (markedQuery.data?.total ?? 0) > 0;

  const clearPendingMarkedAction = useCallback(() => setPendingMarkedAction(null), []);
  const switchToMarkedLedger = useCallback(
    (transaction: MarkedTransaction, intent: MarkedActionIntent) => {
      setPendingMarkedAction({ transaction, intent });
      setActiveLedgerId(transaction.ledger.id);
    },
    [setActiveLedgerId],
  );

  const page = ledger ? (
    <Dashboard
      ledger={ledger}
      accountsQuery={accountsQuery}
      balanceTrendQuery={balanceTrendQuery}
      counterpartiesQuery={counterpartiesQuery}
      unpointedLedgersQuery={unpointedLedgersQuery}
      markedQuery={markedQuery}
      markedExpanded={markedExpanded}
      onExpandMarked={() => setMarkedExpanded(true)}
      activityTab={activityTab}
      onActivityTabChange={setActivityTab}
      hasMarkedTab={hasMarkedTab}
      recentTabRef={recentTabRef}
      markedTabRef={markedTabRef}
      pendingMarkedAction={pendingMarkedAction}
      onPendingMarkedActionHandled={clearPendingMarkedAction}
      onSwitchToMarkedLedger={switchToMarkedLedger}
    />
  ) : (
    <PageContent>
      <PageHeader title="總覽" />
      <div className={styles.trendOnly}>
        <BalanceTrendChart
          months={balanceTrendQuery.data?.months}
          isLoading={balanceTrendQuery.isLoading}
          error={balanceTrendQuery.error}
          className={styles.trendChart}
        />
      </div>
      {/* 等帳本查詢完成後再掛載，避免切入首頁時重抓待處理資料。 */}
      {!ledgerLoading && <PendingCard />}
      {ledgerLoading && <p className={styles.note}>載入中…</p>}
      {ledgerError && <FormError error={ledgerError} />}
      {!ledgerLoading && !ledgerError && (
        <section className={styles.card}>
          <p className={styles.note}>找不到任何帳本。</p>
        </section>
      )}
      <h2 className={styles.myHeading}>我的</h2>
      <div className={styles.cards}>
        <AssetCard totalQuery={balanceTrendQuery} accountsQuery={accountsQuery} />
        <DebtsCard
          counterpartiesQuery={counterpartiesQuery}
          unpointedLedgersQuery={unpointedLedgersQuery}
          showAllLink={false}
        />
      </div>
    </PageContent>
  );

  return <AccountsQueryProvider query={accountsQuery}>{page}</AccountsQueryProvider>;
}

/** 首頁區域以 LedgerView 持有的 query 與狀態組裝，切帳本不會重建個人資料或待處理表單。 */
interface DashboardProps {
  ledger: LedgerSummary;
  accountsQuery: ReturnType<typeof useAccounts>;
  balanceTrendQuery: ReturnType<typeof useBalanceTrend>;
  counterpartiesQuery: ReturnType<typeof useCounterparties>;
  unpointedLedgersQuery: ReturnType<typeof useLedgerGroups>;
  markedQuery: ReturnType<typeof useMarkedTransactions>;
  markedExpanded: boolean;
  onExpandMarked: () => void;
  activityTab: HomeActivityTab;
  onActivityTabChange: (tab: HomeActivityTab) => void;
  hasMarkedTab: boolean;
  recentTabRef: RefObject<HTMLButtonElement | null>;
  markedTabRef: RefObject<HTMLButtonElement | null>;
  pendingMarkedAction: PendingMarkedAction | null;
  onPendingMarkedActionHandled: () => void;
  onSwitchToMarkedLedger: (transaction: MarkedTransaction, intent: MarkedActionIntent) => void;
}

function Dashboard({
  ledger,
  accountsQuery,
  balanceTrendQuery,
  counterpartiesQuery,
  unpointedLedgersQuery,
  markedQuery,
  markedExpanded,
  onExpandMarked,
  activityTab,
  onActivityTabChange,
  hasMarkedTab,
  recentTabRef,
  markedTabRef,
  pendingMarkedAction,
  onPendingMarkedActionHandled,
  onSwitchToMarkedLedger,
}: DashboardProps) {
  const { close, isOpen, open, requestFocus } = useRightPanel();
  const period = currentTaiwanMonthRange();
  const statistics = useLedgerStatistics(ledger.id, { ...period, perspective: 'LEDGER' });
  const { mode: storedMode } = useHomeCategoryColors();
  const mode = storedMode;
  const chartTheme = useChartTheme();
  const [panelTargetState, setPanelTargetState] = useState(() => ({
    ledgerId: ledger.id,
    target: targetForPendingAction(pendingMarkedAction, ledger.id),
  }));

  // 這一層不再依帳本 key 重建；在 render 時同步清掉舊目標，避免 A→B→A 還原舊表單。
  if (panelTargetState.ledgerId !== ledger.id) {
    setPanelTargetState({
      ledgerId: ledger.id,
      target: targetForPendingAction(pendingMarkedAction, ledger.id),
    });
  }
  const panelTarget =
    panelTargetState.ledgerId === ledger.id
      ? panelTargetState.target
      : targetForPendingAction(pendingMarkedAction, ledger.id);

  const recent = useTransactions(ledger.id, { page: 1, limit: RECENT_LIMIT });
  const setTransactionMark = useSetTransactionMark();
  const markedTransactions = markedQuery.data?.items ?? [];

  function setCurrentPanelTarget(target: PanelTarget) {
    setPanelTargetState({ ledgerId: ledger.id, target });
  }

  function startEditing(transaction: Transaction) {
    setCurrentPanelTarget(editTargetOf(transaction));
    // 使用者收起過右側欄時，點了一筆卻沒反應是最糟的情況。
    open();
  }

  function fillAccount(transaction: Transaction) {
    setCurrentPanelTarget({ kind: 'fillAccount', transaction });
    open();
  }

  function startCopying(transaction: Transaction) {
    setCurrentPanelTarget({ kind: 'copy', transaction });
    open();
  }

  function startDeleting(transaction: Transaction) {
    setCurrentPanelTarget({ kind: 'transaction', transaction, initialDeleteOpen: true });
    open();
  }

  function toggleMark(transaction: Transaction, sourceLedgerId = ledger.id) {
    setTransactionMark.mutate(
      {
        ledgerId: sourceLedgerId,
        transactionId: transaction.id,
        currentlyMarked: transaction.marked,
      },
      {
        onSuccess: () => {
          if (activityTab !== 'marked' || !transaction.marked || markedQuery.data?.total !== 1)
            return;
          onActivityTabChange('recent');
          recentTabRef.current?.focus();
        },
      },
    );
  }

  function startMarkedAction(transaction: Transaction, intent: MarkedActionIntent) {
    const markedTransaction = markedTransactions.find((item) => item.id === transaction.id);
    if (!markedTransaction) return;
    if (markedTransaction.ledger.id !== ledger.id) {
      onSwitchToMarkedLedger(markedTransaction, intent);
      return;
    }
    if (intent === 'fillAccount') {
      fillAccount(transaction);
    } else {
      startEditing(transaction);
    }
  }

  useEffect(() => {
    if (pendingMarkedAction?.transaction.ledger.id !== ledger.id) return;
    // 依跨帳本流程先寫入表單目標，再清掉待處理動作，避免切帳本後落回新增表單。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPanelTargetState({
      ledgerId: ledger.id,
      target: targetForPendingAction(pendingMarkedAction, ledger.id),
    });
    open();
    onPendingMarkedActionHandled();
  }, [ledger.id, onPendingMarkedActionHandled, open, pendingMarkedAction]);

  /*
   * 關閉只收起右側欄，不清掉正在編輯的那一筆（W57）：收起有滑出動畫，這時換成新增表單，
   * 動畫裡滑出去的就會是「新增一筆交易」。打開右側欄的入口都會先設好要顯示的內容。
   */
  function closeWorkbench() {
    close();
  }

  /** 「＋ 新增交易」：回到新增表單，打開右側欄並把焦點送到金額欄（SC-35.3）。 */
  function startAdding() {
    setCurrentPanelTarget({ kind: 'new' });
    requestFocus();
  }

  const selectedId = !isOpen
    ? null
    : panelTarget.kind === 'transaction' ||
        panelTarget.kind === 'debtTransaction' ||
        panelTarget.kind === 'fillAccount'
      ? panelTarget.transaction.id
      : panelTarget.kind === 'settlement'
        ? (panelTarget.settlement?.id ?? null)
        : null;

  function focusActivityTab(tab: HomeActivityTab) {
    onActivityTabChange(tab);
    (tab === 'recent' ? recentTabRef : markedTabRef).current?.focus();
  }

  function moveActivityTab(event: KeyboardEvent<HTMLButtonElement>, current: HomeActivityTab) {
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusActivityTab(event.key === 'Home' || !hasMarkedTab ? 'recent' : 'marked');
      return;
    }
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = hasMarkedTab ? (current === 'recent' ? 'marked' : 'recent') : 'recent';
    focusActivityTab(next);
  }

  const statisticsData = statistics.data;
  const categorySection =
    statisticsData?.ledger && statisticsData.mine ? (
      <HomeCategorySection
        expenseGroups={statisticsData.expenseGroups}
        ledgerName={ledger.kind === 'SHARED' ? ledger.name : null}
        statisticsHref={`/stats?tab=cat&ledger=${encodeURIComponent(ledger.id)}&month=${period.from.slice(0, 7)}`}
        colorOf={(group: StatisticsGroup) => homeCategoryColor(group, mode, chartTheme)}
      />
    ) : undefined;

  return (
    <>
      <PageContent>
        <div className={styles.dashboard}>
          <PageHeader
            title="總覽"
            actions={
              <>
                <LedgerSwitcher />
                <Button onClick={startAdding}>
                  <Icon name="plus" />
                  新增交易
                </Button>
              </>
            }
          />
          <LedgerStatsRow ledger={ledger} statistics={statistics} period={period} />
          <PendingCard />

          <div className={styles.activityAndTrend}>
            <ActivityCard
              activityTab={activityTab}
              onActivityTabChange={onActivityTabChange}
              hasMarkedTab={hasMarkedTab}
              recentTabRef={recentTabRef}
              markedTabRef={markedTabRef}
              onTabKeyDown={moveActivityTab}
              markedQuery={markedQuery}
              markedTransactions={markedTransactions}
              markedExpanded={markedExpanded}
              onExpandMarked={onExpandMarked}
              recentTransactions={recent.data?.items ?? []}
              recentLoading={recent.isLoading || recent.isPlaceholderData}
              recentError={recent.error}
              onSelectRecent={startEditing}
              onFillRecent={fillAccount}
              onCopyRecent={startCopying}
              onDeleteRecent={startDeleting}
              onToggleRecentMark={(transaction) => toggleMark(transaction)}
              onSelectMarked={(transaction) => startMarkedAction(transaction, 'edit')}
              onFillMarked={(transaction) => startMarkedAction(transaction, 'fillAccount')}
              onToggleMarked={(transaction, ledgerId) => toggleMark(transaction, ledgerId)}
              selectedId={selectedId}
            />
            <BalanceTrendChart
              months={balanceTrendQuery.data?.months}
              isLoading={balanceTrendQuery.isLoading}
              error={balanceTrendQuery.error}
              className={styles.trendChart}
            />
          </div>

          <h2 className={styles.myHeading}>我的</h2>
          <div className={styles.cards}>
            <AssetCard
              totalQuery={balanceTrendQuery}
              accountsQuery={accountsQuery}
              categorySection={categorySection}
            />
            <DebtsCard
              counterpartiesQuery={counterpartiesQuery}
              unpointedLedgersQuery={unpointedLedgersQuery}
              showAllLink
            />
          </div>
        </div>
      </PageContent>

      <TransactionWorkbench ledger={ledger} target={panelTarget} onClose={closeWorkbench} />
    </>
  );
}

interface ActivityCardProps {
  activityTab: HomeActivityTab;
  onActivityTabChange: (tab: HomeActivityTab) => void;
  hasMarkedTab: boolean;
  recentTabRef: RefObject<HTMLButtonElement | null>;
  markedTabRef: RefObject<HTMLButtonElement | null>;
  onTabKeyDown: (event: KeyboardEvent<HTMLButtonElement>, current: HomeActivityTab) => void;
  markedQuery: ReturnType<typeof useMarkedTransactions>;
  markedTransactions: MarkedTransaction[];
  markedExpanded: boolean;
  onExpandMarked: () => void;
  recentTransactions: Transaction[];
  recentLoading: boolean;
  recentError: unknown;
  selectedId: string | null;
  onSelectRecent: (transaction: Transaction) => void;
  onFillRecent: (transaction: Transaction) => void;
  onCopyRecent: (transaction: Transaction) => void;
  onDeleteRecent: (transaction: Transaction) => void;
  onToggleRecentMark: (transaction: Transaction) => void;
  onSelectMarked: (transaction: Transaction) => void;
  onFillMarked: (transaction: Transaction) => void;
  onToggleMarked: (transaction: Transaction, ledgerId?: string) => void;
}

/** 「最近｜標註」共用一張卡，分頁與焦點留在 LedgerView，不隨帳本切換重設。 */
function ActivityCard({
  activityTab,
  onActivityTabChange,
  hasMarkedTab,
  recentTabRef,
  markedTabRef,
  onTabKeyDown,
  markedQuery,
  markedTransactions,
  markedExpanded,
  onExpandMarked,
  recentTransactions,
  recentLoading,
  recentError,
  selectedId,
  onSelectRecent,
  onFillRecent,
  onCopyRecent,
  onDeleteRecent,
  onToggleRecentMark,
  onSelectMarked,
  onFillMarked,
  onToggleMarked,
}: ActivityCardProps) {
  const visibleTab: HomeActivityTab = hasMarkedTab ? activityTab : 'recent';

  return (
    <section className={styles.dataCard} aria-label="最近與標註">
      <div className={styles.activityHeader}>
        <div className={styles.activityTabs} role="tablist" aria-label="最近與標註">
          <button
            ref={recentTabRef}
            id="home-recent-tab"
            type="button"
            role="tab"
            aria-selected={visibleTab === 'recent'}
            aria-controls="home-activity-panel"
            tabIndex={visibleTab === 'recent' ? 0 : -1}
            className={visibleTab === 'recent' ? styles.activeTab : styles.tab}
            onClick={() => onActivityTabChange('recent')}
            onKeyDown={(event) => onTabKeyDown(event, 'recent')}
          >
            最近
          </button>
          {hasMarkedTab && (
            <button
              ref={markedTabRef}
              id="home-marked-tab"
              type="button"
              role="tab"
              aria-selected={visibleTab === 'marked'}
              aria-controls="home-activity-panel"
              tabIndex={visibleTab === 'marked' ? 0 : -1}
              className={visibleTab === 'marked' ? styles.activeTab : styles.tab}
              onClick={() => onActivityTabChange('marked')}
              onKeyDown={(event) => onTabKeyDown(event, 'marked')}
            >
              標註{markedQuery.data?.total ? ` ${markedQuery.data.total}` : ''}
            </button>
          )}
        </div>
        {visibleTab === 'recent' && (
          <Link className={styles.cardLink} to="/transactions">
            查看全部
          </Link>
        )}
      </div>

      <div
        id="home-activity-panel"
        role="tabpanel"
        aria-labelledby={visibleTab === 'recent' ? 'home-recent-tab' : 'home-marked-tab'}
        tabIndex={0}
      >
        {visibleTab === 'recent' ? (
          <section className={styles.activityContent} aria-labelledby="recent-transactions">
            <h2 className={styles.cardHeading} id="recent-transactions">
              最近交易
            </h2>
            <RecentBody
              transactions={recentTransactions}
              isLoading={recentLoading}
              error={recentError}
              selectedId={selectedId}
              onSelect={onSelectRecent}
              onFillAccount={onFillRecent}
              onCopy={onCopyRecent}
              onDelete={onDeleteRecent}
              onToggleMark={onToggleRecentMark}
            />
          </section>
        ) : (
          <MarkedTransactionsCard
            transactions={markedTransactions}
            total={markedQuery.data?.total ?? 0}
            expanded={markedExpanded}
            isLoading={markedQuery.isLoading}
            error={markedQuery.error}
            onExpand={onExpandMarked}
            selectedId={selectedId}
            onSelect={onSelectMarked}
            onFillAccount={onFillMarked}
            onToggleMark={onToggleMarked}
          />
        )}
      </div>
    </section>
  );
}

interface RecentTransactionsProps {
  transactions: Transaction[];
  isLoading: boolean;
  error: unknown;
  /** 右側欄正在編輯的那一筆，該列標成選取中。 */
  selectedId: string | null;
  onSelect: (transaction: Transaction) => void;
  onFillAccount: (transaction: Transaction) => void;
  onCopy: (transaction: Transaction) => void;
  onDelete: (transaction: Transaction) => void;
  onToggleMark: (transaction: Transaction) => void;
}

/** 最近交易沿用交易頁的單列元件，這裡只負責載入、錯誤與空狀態。 */
function RecentBody({
  transactions,
  isLoading,
  error,
  selectedId,
  onSelect,
  onFillAccount,
  onCopy,
  onDelete,
  onToggleMark,
}: RecentTransactionsProps) {
  if (isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }
  // 失敗時不用紅框：記帳表單沒有壞掉，一塊紅框會讓人以為整頁掛了。
  if (error) {
    return <p className={styles.status}>交易暫時無法載入</p>;
  }
  if (transactions.length === 0) {
    return <p className={styles.status}>還沒有任何交易，從右邊記下第一筆吧。</p>;
  }

  return (
    <TransactionList
      transactions={transactions.slice(0, RECENT_LIMIT)}
      isLoading={false}
      error={null}
      variant="recent"
      selectedId={selectedId}
      onEdit={onSelect}
      onEditDebtTransaction={onSelect}
      onFillAccount={onFillAccount}
      onCopy={onCopy}
      onDelete={onDelete}
      onToggleMark={onToggleMark}
    />
  );
}

interface MarkedTransactionsCardProps {
  transactions: MarkedTransaction[];
  total: number;
  expanded: boolean;
  isLoading: boolean;
  error: unknown;
  onExpand: () => void;
  selectedId: string | null;
  onSelect: (transaction: Transaction) => void;
  onFillAccount: (transaction: Transaction) => void;
  onToggleMark: (transaction: Transaction, ledgerId?: string) => void;
}

/** 所有帳本的標註交易；點「再 N 筆」後由 hook 依 API 上限逐頁載入。 */
function MarkedTransactionsCard({
  transactions,
  total,
  expanded,
  isLoading,
  error,
  onExpand,
  selectedId,
  onSelect,
  onFillAccount,
  onToggleMark,
}: MarkedTransactionsCardProps) {
  const ledgerNames = new Map(transactions.map((item) => [item.id, item.ledger.name]));
  const ledgerIds = new Map(transactions.map((item) => [item.id, item.ledger.id]));

  if (isLoading) {
    return (
      <section className={styles.activityContent} aria-label="標註">
        <p className={styles.status} role="status">
          載入中…
        </p>
      </section>
    );
  }
  if (error) {
    return (
      <section className={styles.activityContent} aria-label="標註">
        <p className={styles.status} role="alert">
          標註暫時無法載入
        </p>
      </section>
    );
  }

  return (
    <section className={styles.activityContent} aria-label="標註">
      <TransactionList
        transactions={transactions}
        isLoading={false}
        error={null}
        selectedId={selectedId}
        onEdit={onSelect}
        onEditDebtTransaction={onSelect}
        onFillAccount={onFillAccount}
        onToggleMark={onToggleMark}
        ledgerNames={ledgerNames}
        ledgerIds={ledgerIds}
      />
      {!expanded && total > 10 && (
        <button type="button" className={styles.moreMarked} onClick={onExpand}>
          再 {total - 10} 筆
        </button>
      )}
    </section>
  );
}

function targetForPendingAction(action: PendingMarkedAction | null, ledgerId: string): PanelTarget {
  if (action?.transaction.ledger.id !== ledgerId) return { kind: 'new' };
  return action.intent === 'fillAccount'
    ? { kind: 'fillAccount', transaction: action.transaction }
    : editTargetOf(action.transaction);
}

function editTargetOf(transaction: Transaction): PanelTarget {
  return transaction.settlement
    ? { kind: 'settlement', settlement: transaction }
    : transaction.debt
      ? { kind: 'debtTransaction', transaction }
      : { kind: 'transaction', transaction };
}

/** 訪客首頁保留固定 0 的介面示意，不觸發需要登入的統計或資產端點。 */
function GuestStatsRow() {
  return (
    <div className={styles.stats}>
      <GuestStat label="本月支出" />
      <GuestStat label="本月收入" />
      <GuestStat label="結餘" />
    </div>
  );
}

/** 未登入的示意卡沒有連結，也不會顯示成實際帳務資料。 */
function GuestStat({ label }: { label: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>$0</span>
    </div>
  );
}

/** 目前帳本與台灣時間當月的摘要；數字全由共用的統計 query 提供。 */
function LedgerStatsRow({
  ledger,
  statistics,
  period,
}: {
  ledger: LedgerSummary;
  statistics: ReturnType<typeof useLedgerStatistics>;
  period: ReturnType<typeof currentTaiwanMonthRange>;
}) {
  if (statistics.error) {
    return (
      <div className={styles.statsMessage} role="alert">
        統計暫時無法載入
      </div>
    );
  }

  if (statistics.isLoading || !statistics.data) {
    return (
      <div className={styles.statsMessage} role="status">
        載入中…
      </div>
    );
  }

  // 回應格式不符契約時視為載入錯誤，不能讓整頁崩潰或顯示出假的 0。
  const ledgerTotals = statistics.data.ledger;
  const mineTotals = statistics.data.mine;
  if (!ledgerTotals || !mineTotals) {
    return (
      <div className={styles.statsMessage} role="alert">
        統計暫時無法載入
      </div>
    );
  }

  const shared = ledger.kind === 'SHARED';
  const month = period.from.slice(0, 7);

  return (
    <div className={styles.stats} aria-label="本月收支">
      <StatLink
        label="本月支出"
        amount={ledgerTotals.expense}
        mine={mineTotals.expense}
        shared={shared}
        ledgerId={ledger.id}
        month={month}
      />
      <StatLink
        label="本月收入"
        amount={ledgerTotals.income}
        mine={mineTotals.income}
        shared={shared}
        ledgerId={ledger.id}
        month={month}
      />
      <StatLink
        label="結餘"
        amount={ledgerTotals.net}
        mine={mineTotals.net}
        shared={shared}
        ledgerId={ledger.id}
        month={month}
      />
    </div>
  );
}

/** 每張卡只格式化回傳金額，並將目前帳本與月份帶到統計頁。 */
function StatLink({
  label,
  amount,
  mine,
  shared,
  ledgerId,
  month,
}: {
  label: string;
  amount: StatisticsTotals['expense'];
  mine: StatisticsTotals['expense'];
  shared: boolean;
  ledgerId: string;
  month: string;
}) {
  return (
    <Link
      className={styles.stat}
      to={`/stats?tab=cat&ledger=${encodeURIComponent(ledgerId)}&month=${month}`}
    >
      <span className={styles.statLabel}>{label}</span>
      <strong className={styles.statValue}>{formatMoney(amount)}</strong>
      {shared && <span className={styles.statMine}>我 {formatMoney(mine)}</span>}
    </Link>
  );
}
