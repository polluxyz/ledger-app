import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  BalanceTrend,
  LedgerSummary,
  MarkedTransaction,
  StatisticsTotals,
  Transaction,
} from '@ledger/shared';
import { useRightPanel } from '../app/right-panel-context';
import { Button } from '../components/Button';
import { FormError } from '../components/FormError';
import { Icon } from '../components/Icon';
import { PageContent } from '../components/PageContent';
import { PageHeader } from '../components/PageHeader';
import { AccountBalances } from '../features/accounts/AccountBalances';
import { BalanceTrendChart } from '../features/statistics/BalanceTrendChart';
import { useBalanceTrend } from '../features/statistics/use-balance-trend';
import { useLedgerStatistics } from '../features/statistics/use-ledger-statistics';
import { AuthDialog, type AuthDialogMode } from '../features/auth/AuthDialog';
import { useAuth } from '../features/auth/use-auth';
import { LedgerSwitcher } from '../features/ledgers/LedgerSwitcher';
import { useActiveLedger } from '../features/ledgers/use-active-ledger';
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

/** dashboard 的「最近交易」要幾筆（spec 2i §4.7）。排序與截斷都由後端負責。 */
const RECENT_LIMIT = 5;

/**
 * 首頁，有兩種狀態：
 *
 * - **未登入**：顯示介面預覽——統計卡片是純粹的空狀態（固定 0，不做任何計算），
 *   讓人先看懂這個 app 長什麼樣，再引導去登入 / 註冊。不保存任何訪客資料，
 *   因此前端毋須實作任何業務邏輯。
 * - **已登入**：dashboard（spec 2i SC-34.1）——統計卡、最近 5 筆交易、帳戶餘額。
 *   完整的交易表格（篩選、分頁、刪除）搬到 `/transactions`。
 *
 * 登入後的資產與收支摘要都只呈現後端回傳的數字；最近交易、帳戶餘額與標註卡沿用
 * 各自的領域 hook，不在首頁重算任何帳務資料。
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
 * 已登入者的 dashboard。這一層只負責找出「記進哪一本帳本」
 * （由 `ActiveLedgerProvider` 決定），其餘交給 `Dashboard`。
 *
 * `key={ledger.id}` 是刻意的：換一本帳本就換一組「編輯中的那一筆」。用 key 讓
 * React 整個重建那棵子樹，比自己在 effect 裡把每個 state 歸零可靠。
 *
 * 帳本還沒好的三種狀態（載入中 / 失敗 / 一本都沒有）走下面那條路。它們仍然看得到
 * **帳戶餘額**，因為餘額不受帳本狀態影響：帳戶屬於使用者、跨帳本共用，就算一本
 * 帳本都沒有，「我現在有多少錢」仍然該看得到。那時不渲染 `TransactionWorkbench`，
 * 右側欄沒有頁面登記，寬度自然是 0——沒有帳本就沒有地方可以記帳。
 */
function LedgerView() {
  const {
    ledger,
    setActiveLedgerId,
    isLoading: ledgerLoading,
    error: ledgerError,
  } = useActiveLedger();
  // 帳戶跨帳本共用；hook 留在切帳本時不會卸載的這一層，資產圖不會因帳本 id 改變而重抓。
  const balanceTrend = useBalanceTrend();
  const [pendingMarkedTransaction, setPendingMarkedTransaction] =
    useState<MarkedTransaction | null>(null);
  const clearPendingMarkedTransaction = useCallback(() => setPendingMarkedTransaction(null), []);
  const switchToMarkedLedger = useCallback(
    (transaction: MarkedTransaction) => {
      setPendingMarkedTransaction(transaction);
      setActiveLedgerId(transaction.ledger.id);
    },
    [setActiveLedgerId],
  );

  if (ledger) {
    return (
      <Dashboard
        key={ledger.id}
        ledger={ledger}
        pendingMarkedTransaction={pendingMarkedTransaction}
        onPendingMarkedTransactionHandled={clearPendingMarkedTransaction}
        onSwitchToMarkedLedger={switchToMarkedLedger}
        balanceTrendMonths={balanceTrend.data?.months}
        balanceTrendLoading={balanceTrend.isLoading}
        balanceTrendError={balanceTrend.error}
      />
    );
  }

  return (
    <PageContent>
      <PageHeader title="總覽" />
      <BalanceTrendChart
        months={balanceTrend.data?.months}
        isLoading={balanceTrend.isLoading}
        error={balanceTrend.error}
      />
      <PendingCard />
      {ledgerLoading && <p className={styles.note}>載入中…</p>}
      {ledgerError && <FormError error={ledgerError} />}
      {!ledgerLoading && !ledgerError && (
        <section className={styles.card}>
          <p className={styles.note}>找不到任何帳本。</p>
        </section>
      )}
      <div className={styles.cards}>
        <AccountBalances />
      </div>
    </PageContent>
  );
}

/**
 * dashboard 本體（spec 2i §4.7）：頁首、資產趨勢、三張收支卡與既有摘要卡。
 * 資產資料由外層持有，換帳本時 dashboard 子樹會重建，但不會重抓資產趨勢。
 *
 * `editing` 放在這一層的理由與交易頁相同（D25）：最近交易在頁面裡、編輯面板在
 * 右側欄（portal 過去），兩者只有這個共同的父層。
 */
interface DashboardProps {
  ledger: LedgerSummary;
  pendingMarkedTransaction: MarkedTransaction | null;
  onPendingMarkedTransactionHandled: () => void;
  onSwitchToMarkedLedger: (transaction: MarkedTransaction) => void;
  balanceTrendMonths: BalanceTrend['months'] | undefined;
  balanceTrendLoading: boolean;
  balanceTrendError: unknown;
}

function Dashboard({
  ledger,
  pendingMarkedTransaction,
  onPendingMarkedTransactionHandled,
  onSwitchToMarkedLedger,
  balanceTrendMonths,
  balanceTrendLoading,
  balanceTrendError,
}: DashboardProps) {
  const { close, isOpen, open, requestFocus } = useRightPanel();
  const [panelTarget, setPanelTarget] = useState<PanelTarget>(() =>
    pendingMarkedTransaction?.ledger.id === ledger.id
      ? editTargetOf(pendingMarkedTransaction)
      : { kind: 'new' },
  );
  const [markedExpanded, setMarkedExpanded] = useState(false);

  // 排序與「只要 5 筆」都交給後端，前端不做任何排序、截斷或加總。
  const recent = useTransactions(ledger.id, { page: 1, limit: RECENT_LIMIT });
  const marked = useMarkedTransactions(markedExpanded);
  const setTransactionMark = useSetTransactionMark();
  const markedTransactions = marked.data?.items?.filter((item) => item.ledger != null) ?? [];

  function startEditing(transaction: Transaction) {
    setPanelTarget(editTargetOf(transaction));
    // 使用者收起過右側欄時，點了一筆卻沒反應是最糟的情況。
    open();
  }

  function fillAccount(transaction: Transaction) {
    setPanelTarget({ kind: 'fillAccount', transaction });
    open();
  }

  function startCopying(transaction: Transaction) {
    setPanelTarget({ kind: 'copy', transaction });
    open();
  }

  function startDeleting(transaction: Transaction) {
    setPanelTarget({ kind: 'transaction', transaction, initialDeleteOpen: true });
    open();
  }

  function toggleMark(transaction: Transaction, sourceLedgerId = ledger.id) {
    setTransactionMark.mutate({
      ledgerId: sourceLedgerId,
      transactionId: transaction.id,
      currentlyMarked: transaction.marked,
    });
  }

  function startEditingMarked(transaction: Transaction) {
    const markedTransaction = marked.data?.items.find((item) => item.id === transaction.id);
    if (!markedTransaction) return;
    if (markedTransaction.ledger.id !== ledger.id) {
      onSwitchToMarkedLedger(markedTransaction);
      return;
    }
    startEditing(transaction);
  }

  useEffect(() => {
    if (pendingMarkedTransaction?.ledger.id !== ledger.id) return;
    open();
    onPendingMarkedTransactionHandled();
  }, [ledger.id, onPendingMarkedTransactionHandled, open, pendingMarkedTransaction]);

  /*
   * 關閉只收起右側欄，不清掉正在編輯的那一筆（W57）：收起有滑出動畫，這時換成新增表單，
   * 動畫裡滑出去的就會是「新增一筆交易」。打開右側欄的入口都會先設好要顯示的內容。
   */
  function closeWorkbench() {
    close();
  }

  /** 「＋ 新增交易」：回到新增表單，打開右側欄並把焦點送到金額欄（SC-35.3）。 */
  function startAdding() {
    setPanelTarget({ kind: 'new' });
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

  return (
    <>
      {/*
        帳本切換與「＋ 新增交易」在標題同一排的右邊（開發者 2026-10-07）：最上排
        的橫條清空留給之後的 AI 功能，記進哪一本帳本就近放在記帳的按鈕旁邊。
      */}
      <PageContent>
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
        <BalanceTrendChart
          months={balanceTrendMonths}
          isLoading={balanceTrendLoading}
          error={balanceTrendError}
        />
        <LedgerStatsRow ledger={ledger} />
        <PendingCard />

        <div className={styles.cards}>
          {marked.data && marked.data.total > 0 && markedTransactions.length > 0 && (
            <MarkedTransactionsCard
              transactions={markedTransactions}
              total={marked.data.total}
              expanded={markedExpanded}
              onExpand={() => setMarkedExpanded(true)}
              selectedId={selectedId}
              onSelect={startEditingMarked}
              onFillAccount={fillAccount}
              onToggleMark={toggleMark}
            />
          )}
          <RecentTransactions
            transactions={recent.data?.items ?? []}
            isLoading={recent.isLoading}
            error={recent.error}
            selectedId={selectedId}
            onSelect={startEditing}
            onFillAccount={fillAccount}
            onCopy={startCopying}
            onDelete={startDeleting}
            onToggleMark={(transaction) => toggleMark(transaction)}
          />
          <AccountBalances />
        </div>
      </PageContent>

      <TransactionWorkbench ledger={ledger} target={panelTarget} onClose={closeWorkbench} />
    </>
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

/**
 * 「最近交易」卡（SC-34.1、假設 8）。
 *
 * 最近交易沿用交易頁的單列元件，版面與名稱規則只有一份；這裡只保留摘要卡的
 * 載入、錯誤與空狀態，並由呼叫端提供五筆資料。
 */
function RecentTransactions({
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
  return (
    <section className={styles.dataCard} aria-labelledby="recent-transactions">
      <div className={styles.cardHead}>
        <h2 className={styles.cardHeading} id="recent-transactions">
          最近交易
        </h2>
        {/* 四種狀態下都留著這個入口：交易載不出來時，使用者至少走得到交易頁。 */}
        <Link className={styles.cardLink} to="/transactions">
          查看全部
        </Link>
      </div>

      <RecentBody
        transactions={transactions}
        isLoading={isLoading}
        error={error}
        selectedId={selectedId}
        onSelect={onSelect}
        onFillAccount={onFillAccount}
        onCopy={onCopy}
        onDelete={onDelete}
        onToggleMark={onToggleMark}
      />
    </section>
  );
}

/** 載入中 / 失敗 / 沒有交易 / 有資料，四種呈現。 */
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
  // 失敗時不用紅框：這是 dashboard 的一張卡，記帳表單並沒有壞掉，
  // 一塊紅框會讓人以為整頁掛了。
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
  onExpand: () => void;
  selectedId: string | null;
  onSelect: (transaction: Transaction) => void;
  onFillAccount: (transaction: Transaction) => void;
  onToggleMark: (transaction: Transaction, ledgerId?: string) => void;
}

/** 所有帳本的標註交易；點「再 N 筆」後由 hook 逐頁載入全部資料。 */
function MarkedTransactionsCard({
  transactions,
  total,
  expanded,
  onExpand,
  selectedId,
  onSelect,
  onFillAccount,
  onToggleMark,
}: MarkedTransactionsCardProps) {
  const ledgerNames = new Map(transactions.map((item) => [item.id, item.ledger.name]));
  const ledgerIds = new Map(transactions.map((item) => [item.id, item.ledger.id]));

  return (
    <section
      className={`${styles.dataCard} ${styles.markedCard}`}
      aria-labelledby="marked-transactions"
    >
      <div className={styles.cardHead}>
        <h2 className={styles.cardHeading} id="marked-transactions">
          標註
        </h2>
      </div>
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

/** 目前帳本與台灣時間當月的摘要；數字全由統計端點提供。 */
function LedgerStatsRow({ ledger }: { ledger: LedgerSummary }) {
  const period = currentTaiwanMonthRange();
  const statistics = useLedgerStatistics(ledger.id, { ...period, perspective: 'LEDGER' });

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

/** 組成目前台灣月份的起迄日，供統計 API 與後續導覽共用。 */
function currentTaiwanMonthRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;

  if (!year || !month) {
    throw new Error('無法取得台灣時區的目前月份。');
  }

  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
  };
}
