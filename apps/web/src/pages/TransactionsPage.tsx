import { useCallback, useEffect, useId, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import type { LedgerSummary, Transaction } from '@ledger/shared';
import { PageToolbarActions, PageToolbarStart } from '../app/PageToolbar';
import { useRightPanel } from '../app/right-panel-context';
import { Button } from '../components/Button';
import { FormError } from '../components/FormError';
import { Icon } from '../components/Icon';
import { PageContent } from '../components/PageContent';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { LedgerSwitcher } from '../features/ledgers/LedgerSwitcher';
import { useActiveLedger } from '../features/ledgers/use-active-ledger';
import { DebtHistoryView } from '../features/debts/DebtHistoryView';
import { DebtsView } from '../features/debts/DebtsView';
import { readOpenCounterpartyState } from '../features/linking/navigation';
import { SharedSettlementsView } from '../features/settlements/SharedSettlementsView';
import { readSettleIntentState } from '../features/settlements/settle-intent';
import {
  TransactionFilterDrawer,
  TransactionFilterToggle,
} from '../features/transactions/TransactionFilters';
import { TransactionList } from '../features/transactions/TransactionList';
import {
  TransactionWorkbench,
  type PanelTarget,
} from '../features/transactions/TransactionWorkbench';
import {
  EMPTY_FILTERS,
  hasAnyFilter,
  toListQuery,
  type TransactionFilters,
} from '../features/transactions/transaction-query';
import { useTransactions } from '../features/transactions/use-transactions';
import styles from './TransactionsPage.module.css';

/**
 * 交易頁（spec 2i SC-34.2）：2h 首頁的交易表格——篩選、依日期分組的列表、分頁、
 * 鉛筆與垃圾桶——原封不動搬到這裡，右側欄放新增／編輯表單。
 *
 * 這一層只負責找出「記進哪一本帳本」（由 `ActiveLedgerProvider` 決定），
 * 其餘交給 `LedgerTransactions`。
 *
 * `key={ledger.id}` 是刻意的：換一本帳本就換一組篩選條件、頁碼與編輯中的那一筆。
 * 用 key 讓 React 整個重建那棵子樹，比自己在 effect 裡把每個 state 歸零可靠——
 * 漏掉一個的症狀是「切到只有 3 筆的帳本卻停在第 5 頁」，畫面一片空白而看不出原因。
 *
 * 帳本還沒好的三種狀態（載入中／失敗／一本都沒有）走下面那條路。那時**不渲染**
 * `TransactionWorkbench`，右側欄沒有頁面登記，寬度自然是 0——沒有帳本就沒有地方
 * 可以記帳，留一張記不進去的表單只會讓人以為壞了。
 */
export default function TransactionsPage() {
  const { ledger, isLoading: ledgerLoading, error: ledgerError } = useActiveLedger();

  if (ledger) {
    return <LedgerTransactions key={ledger.id} ledger={ledger} />;
  }

  return (
    <PageContent>
      <PageHeader title="交易" />
      {ledgerLoading && <p className={styles.note}>載入中…</p>}
      {ledgerError && <FormError error={ledgerError} />}
      {!ledgerLoading && !ledgerError && (
        <section className={styles.card}>
          <p className={styles.note}>找不到任何帳本。</p>
        </section>
      )}
    </PageContent>
  );
}

/**
 * 交易頁只有明細與借還兩個檢視，子分頁只在借還檢視內選擇。
 */
type TransactionsView = 'details' | 'debts';
type DebtsTab = 'overview' | 'personal' | 'shared' | 'history';

/**
 * 一本帳本的交易列表。
 *
 * ## 為什麼 `editing` 放在這一層（D25）
 *
 * 列表在頁面裡、面板在右側欄（portal 過去），兩者只有這個共同的父層。點了哪一筆
 * 要傳給面板，所以 `editing` 只能放這裡。點一列或點鉛筆都做兩件事：設定 `editing`、
 * 呼叫 `open()` 把右側欄打開——使用者收起過面板時，點了卻沒反應是最糟的情況。
 *
 * 交易列表負責選取，編輯面板負責儲存與刪除；這一層只協調右側欄的目標與開合。
 */
function LedgerTransactions({ ledger }: { ledger: LedgerSummary }) {
  const { close, isOpen, open, requestFocus } = useRightPanel();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const settleIntent = readSettleIntentState(location.state);
  const [filters, setFilters] = useState<TransactionFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterPanelId = useId();
  const [page, setPage] = useState(1);
  // 檢視放在網址而非 state（spec 4.2）：重整要留在同一個檢視。
  const requestedView = searchParams.get('view');
  const requestedTab = searchParams.get('tab');
  const routeState: unknown = location.state;
  const routeToShared = requestedView === 'settle' || settleIntent !== null;
  const view: TransactionsView = requestedView === 'debts' || routeToShared ? 'debts' : 'details';
  const debtsTab: DebtsTab = routeToShared
    ? 'shared'
    : requestedTab === 'personal' || requestedTab === 'shared' || requestedTab === 'history'
      ? requestedTab
      : 'overview';
  const sharedSettleIntent =
    requestedView === 'debts' && requestedTab === 'shared' ? settleIntent : null;

  const transactions = useTransactions(ledger.id, toListQuery(filters, page));
  // 面板顯示的目標：新增表單（預設）、編輯一般交易或檢視債務詳情（plan §2.5）。
  const [panelTarget, setPanelTarget] = useState<PanelTarget>({ kind: 'new' });
  const [pendingCounterpartyId, setPendingCounterpartyId] = useState<string | null>(null);
  const [expandedCounterpartyId, setExpandedCounterpartyId] = useState<string | null>(null);

  // 舊的結清網址與一次性指示都進共享分頁；未指定子分頁時補上預設總覽。
  useEffect(() => {
    if (routeToShared) {
      if (requestedView !== 'debts' || requestedTab !== 'shared') {
        setSearchParams({ view: 'debts', tab: 'shared' }, { replace: true, state: routeState });
      }
      return;
    }
    if (
      requestedView === 'debts' &&
      requestedTab !== 'overview' &&
      requestedTab !== 'personal' &&
      requestedTab !== 'shared' &&
      requestedTab !== 'history'
    ) {
      setSearchParams({ view: 'debts', tab: 'overview' }, { replace: true, state: routeState });
    }
  }, [requestedTab, requestedView, routeState, routeToShared, setSearchParams]);

  /** 切換檢視寫回網址；「明細」時清掉參數，回到乾淨的 /transactions。 */
  function switchView(next: TransactionsView) {
    setSearchParams(next === 'details' ? {} : { view: 'debts', tab: 'overview' }, {
      state: { keepRightPanel: true },
    });
  }

  function switchDebtsTab(next: DebtsTab) {
    setSearchParams({ view: 'debts', tab: next }, { state: { keepRightPanel: true } });
  }

  /**
   * 換了篩選條件就回到第 1 頁。少了這件事，使用者會在「第 5 頁」看到空白，
   * 而畫面上沒有任何線索說明原因。
   */
  function handleFiltersChange(next: TransactionFilters) {
    setFilters(next);
    setPage(1);
  }

  function startEditing(transaction: Transaction) {
    if (transaction.settlement) {
      return;
    }
    setPanelTarget({ kind: 'transaction', transaction });
    open();
  }

  function fillAccount(transaction: Transaction) {
    setPanelTarget({ kind: 'fillAccount', transaction });
    open();
  }

  function startEditingDebtTransaction(transaction: Transaction) {
    setPanelTarget({ kind: 'debtTransaction', transaction });
    open();
  }

  /*
    從總覽或邀請頁帶來的對象 id 只要求切到借還檢視；清單載入後會在目前頁面有該對象時展開，
    並把導覽 state 清掉，避免重新整理或返回時重複處理。
  */
  const openCounterpartyId = readOpenCounterpartyState(location.state);
  const [handledCounterpartyLocationKey, setHandledCounterpartyLocationKey] = useState<
    string | null
  >(null);
  if (openCounterpartyId !== null && handledCounterpartyLocationKey !== location.key) {
    setHandledCounterpartyLocationKey(location.key);
    setPendingCounterpartyId(openCounterpartyId);
    setExpandedCounterpartyId(openCounterpartyId);
  }
  useEffect(() => {
    if (openCounterpartyId === null) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set('view', 'debts');
    next.set('tab', 'overview');
    setSearchParams(next, { replace: true, state: null });
  }, [location.key, openCounterpartyId, searchParams, setSearchParams]);

  const handleCounterpartyRequestHandled = useCallback(
    (counterpartyId: string, foundInCurrentPage: boolean) => {
      setPendingCounterpartyId((current) => (current === counterpartyId ? null : current));
      if (!foundInCurrentPage) {
        setExpandedCounterpartyId((current) => (current === counterpartyId ? null : current));
      }
    },
    [],
  );

  /*
   * 關閉只收起右側欄，不換內容（W57）：收起有滑出動畫，這時先換成新增表單，動畫裡滑出去
   * 的就會是「新增一筆交易」。每個打開右側欄的入口都會先設好自己的目標，所以留著舊內容
   * 不會在下次打開時露出來。
   */
  function closeWorkbench() {
    close();
  }

  /** 「＋ 新增交易」：回到新增表單，打開右側欄並把焦點送到金額欄（SC-35.3）。 */
  function startAdding() {
    setPanelTarget({ kind: 'new' });
    requestFocus();
  }

  function editSplit(splitId: string) {
    setPanelTarget({ kind: 'split', splitId });
    open();
  }

  const selectedTransactionId =
    isOpen && panelTarget.kind === 'transaction'
      ? panelTarget.transaction.id
      : isOpen && panelTarget.kind === 'debtTransaction'
        ? panelTarget.transaction.id
        : isOpen && panelTarget.kind === 'fillAccount'
          ? panelTarget.transaction.id
          : null;

  return (
    <>
      {/* 橫條左邊是作用中帳本（SC-38.2），右邊是這一頁的主要按鈕（SC-38.3）。 */}
      <PageToolbarStart>
        <LedgerSwitcher />
      </PageToolbarStart>
      <PageToolbarActions>
        {view === 'details' && (
          <Button onClick={startAdding}>
            <Icon name="plus" />
            新增交易
          </Button>
        )}
      </PageToolbarActions>

      <PageContent>
        <PageHeader title="交易" />

        {/*
          「明細／借還」的檢視切換（spec 4.2）。狀態在網址上，這裡只反映目前值。
          借還也是交易（錢進出帳戶），所以它住在交易頁，側欄不加項目（決策 W1）。
        */}
        {/* 檢視切換與漏斗同一列（3d T6）：漏斗只在明細時出現。 */}
        <div className={styles.toolbarRow}>
          <div className={styles.viewSwitch} role="group" aria-label="檢視">
            <button
              type="button"
              className={styles.viewSwitchButton}
              aria-pressed={view === 'details'}
              onClick={() => switchView('details')}
            >
              明細
            </button>
            <button
              type="button"
              className={styles.viewSwitchButton}
              aria-pressed={view === 'debts'}
              onClick={() => switchView('debts')}
            >
              借還
            </button>
          </div>
          {view === 'details' && (
            <TransactionFilterToggle
              filters={filters}
              expanded={filtersOpen}
              controlsId={filterPanelId}
              onToggle={() => setFiltersOpen((current) => !current)}
            />
          )}
        </div>

        {view === 'debts' && (
          <div
            className={`${styles.viewSwitch} ${styles.debtsTabs}`}
            role="group"
            aria-label="借還"
          >
            <button
              type="button"
              className={styles.viewSwitchButton}
              aria-pressed={debtsTab === 'overview'}
              onClick={() => switchDebtsTab('overview')}
            >
              總覽
            </button>
            <button
              type="button"
              className={styles.viewSwitchButton}
              aria-pressed={debtsTab === 'personal'}
              onClick={() => switchDebtsTab('personal')}
            >
              個人
            </button>
            <button
              type="button"
              className={styles.viewSwitchButton}
              aria-pressed={debtsTab === 'shared'}
              onClick={() => switchDebtsTab('shared')}
            >
              共享
            </button>
            <button
              type="button"
              className={styles.viewSwitchButton}
              aria-pressed={debtsTab === 'history'}
              onClick={() => switchDebtsTab('history')}
            >
              歷史
            </button>
          </div>
        )}

        {view === 'debts' ? (
          debtsTab === 'shared' ? (
            <SharedSettlementsView settleIntent={sharedSettleIntent} />
          ) : debtsTab === 'history' ? (
            <DebtHistoryView ledger={ledger} onEditSplit={editSplit} />
          ) : (
            <DebtsView
              ledger={ledger}
              mode={debtsTab}
              expandedCounterpartyId={expandedCounterpartyId}
              onExpandedChange={setExpandedCounterpartyId}
              openCounterpartyId={pendingCounterpartyId}
              onOpenRequestHandled={handleCounterpartyRequestHandled}
              onEditSplit={editSplit}
            />
          )
        ) : (
          // 篩選是獨立的一張卡片，列表與分頁收在下面那一張。
          <>
            <TransactionFilterDrawer
              open={filtersOpen}
              id={filterPanelId}
              ledgerId={ledger.id}
              filters={filters}
              onChange={handleFiltersChange}
            />

            <section className={styles.listCard}>
              <TransactionList
                transactions={transactions.data?.items ?? []}
                isLoading={transactions.isLoading}
                error={transactions.error}
                isFiltered={hasAnyFilter(filters)}
                onEdit={startEditing}
                onEditDebtTransaction={startEditingDebtTransaction}
                onFillAccount={fillAccount}
                // 右側欄正在編輯的那一筆要在列表上標出來，否則使用者看不出面板裡是哪一筆。
                // 收起後內容還留著（見 closeWorkbench），所以只在右側欄開著時標示。
                selectedId={selectedTransactionId}
              />

              <Pagination
                page={transactions.data?.page ?? page}
                limit={transactions.data?.limit ?? 20}
                total={transactions.data?.total ?? 0}
                onChange={setPage}
              />
            </section>
          </>
        )}
      </PageContent>

      <TransactionWorkbench ledger={ledger} target={panelTarget} onClose={closeWorkbench} />
    </>
  );
}
