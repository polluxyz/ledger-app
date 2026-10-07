import { useEffect, useId, useMemo, useState } from 'react';
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
import { useCurrentUser } from '../features/auth/use-current-user';
import { DebtsView } from '../features/debts/DebtsView';
import { useLedgerPeople } from '../features/ledger-people/use-ledger-people';
import { readOpenCounterpartyState } from '../features/linking/navigation';
import { SettlementView } from '../features/settlements/SettlementView';
import {
  readSettleIntentState,
  SETTLE_INTENT_STATE_KEY,
} from '../features/settlements/settle-intent';
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
  const {
    ledger,
    ledgers,
    isLoading: ledgerLoading,
    error: ledgerError,
    setActiveLedgerId,
  } = useActiveLedger();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const settleIntent = readSettleIntentState(location.state);
  const [handledSettleLocationKey, setHandledSettleLocationKey] = useState<string | null>(null);
  const settleIntentLedgerId = settleIntent?.ledgerId ?? null;
  const settleIntentPersonId = settleIntent?.personId ?? null;
  const settleIntentAmount = settleIntent?.amount ?? null;
  const settleIntentState = useMemo(
    () =>
      settleIntentLedgerId !== null && settleIntentPersonId !== null && settleIntentAmount !== null
        ? {
            [SETTLE_INTENT_STATE_KEY]: {
              ledgerId: settleIntentLedgerId,
              personId: settleIntentPersonId,
              amount: settleIntentAmount,
            },
          }
        : null,
    [settleIntentAmount, settleIntentLedgerId, settleIntentPersonId],
  );

  // 清單載入後才判斷目標帳本是否可切換，避免把尚未回來的資料誤判成「不在清單」。
  if (
    settleIntentLedgerId !== null &&
    !ledgerLoading &&
    ledgerError === null &&
    handledSettleLocationKey !== location.key
  ) {
    setHandledSettleLocationKey(location.key);
  }

  useEffect(() => {
    if (
      settleIntentLedgerId === null ||
      ledgerLoading ||
      ledgerError !== null ||
      handledSettleLocationKey !== location.key
    ) {
      return;
    }

    const targetLedger = ledgers.find((item) => item.id === settleIntentLedgerId);
    if (!targetLedger || targetLedger.kind !== 'SHARED') {
      // state 裡的帳本已不可用時整個忽略該指示，連 `?view=settle` 也一併移除。
      const next = new URLSearchParams(searchParams);
      next.delete('view');
      setSearchParams(next, { replace: true, state: { keepRightPanel: true } });
      return;
    }

    // 先切換作用中帳本，等 context 真的換過來後再切結清檢視，避免面板對錯帳本。
    if (ledger?.id !== settleIntentLedgerId) {
      setActiveLedgerId(settleIntentLedgerId);
      return;
    }

    if (searchParams.get('view') !== 'settle') {
      const next = new URLSearchParams(searchParams);
      next.set('view', 'settle');
      setSearchParams(next, { replace: true, state: settleIntentState ?? {} });
    }
  }, [
    handledSettleLocationKey,
    ledger?.id,
    ledgerError,
    ledgerLoading,
    ledgers,
    location.key,
    searchParams,
    setActiveLedgerId,
    setSearchParams,
    settleIntentState,
    settleIntentLedgerId,
  ]);

  const intentTarget = ledgers.find((item) => item.id === settleIntentLedgerId);
  const intentTargetExists = intentTarget?.kind === 'SHARED';
  const waitingForIntentLedger =
    settleIntentLedgerId !== null &&
    !ledgerError &&
    (ledgerLoading ||
      !intentTargetExists ||
      ledger?.id !== settleIntentLedgerId ||
      searchParams.get('view') !== 'settle');

  if (waitingForIntentLedger) {
    return (
      <PageContent>
        <PageHeader title="交易" />
        <p className={styles.note}>載入中…</p>
      </PageContent>
    );
  }

  if (settleIntentLedgerId !== null && ledgerError) {
    return (
      <PageContent>
        <PageHeader title="交易" />
        <FormError error={ledgerError} />
      </PageContent>
    );
  }

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
 * 檢視切換的兩個值。狀態放在網址查詢參數（`?view=debts`）：重整後停在同一個
 * 檢視，也能直接把借還檢視的網址分享出去（spec 4.2、SC-W9）。
 */
type TransactionsView = 'details' | 'debts' | 'settle';

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
  const currentUser = useCurrentUser();
  const ledgerPeople = useLedgerPeople(
    ledger.id,
    ledger.kind === 'SHARED' && settleIntent?.ledgerId === ledger.id,
  );
  const [filters, setFilters] = useState<TransactionFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterPanelId = useId();
  const [page, setPage] = useState(1);
  // 檢視放在網址而非 state（spec 4.2）：重整要留在同一個檢視。
  const requestedView = searchParams.get('view');
  const view: TransactionsView =
    requestedView === 'debts'
      ? 'debts'
      : ledger.kind === 'SHARED' && requestedView === 'settle'
        ? 'settle'
        : 'details';

  const transactions = useTransactions(ledger.id, toListQuery(filters, page));
  // 面板顯示的目標：新增表單（預設）、編輯一般交易或檢視債務詳情（plan §2.5）。
  const [panelTarget, setPanelTarget] = useState<PanelTarget>({ kind: 'new' });

  // 個人帳本沒有結清檢視；直接進入舊連結時移除無效參數，回到明細。
  useEffect(() => {
    if (ledger.kind === 'PERSONAL' && requestedView === 'settle') {
      setSearchParams({}, { replace: true, state: { keepRightPanel: true } });
    }
  }, [ledger.kind, requestedView, setSearchParams]);

  /** 切換檢視寫回網址；「明細」時清掉參數，回到乾淨的 /transactions。 */
  function switchView(next: TransactionsView) {
    setSearchParams(next === 'details' ? {} : { view: next }, { state: { keepRightPanel: true } });
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
      setPanelTarget({ kind: 'settlement', settlement: transaction });
      open();
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

  function openCounterparty(counterpartyId: string) {
    setPanelTarget({ kind: 'counterparty', counterpartyId });
    open();
  }

  /*
    從總覽或邀請頁過來、要直接打開某人的往來帳（phase-3b2-web W41，見
    features/linking/navigation.ts）。打開後把 state 換掉，重新整理或回上一頁就不會再開一次。

    換掉 state 是一次 replace 導覽，會換 location key；帶 keepRightPanel 讓右側欄把開啟記號
    搬過去（RightPanelProvider 的 W15 機制），否則剛打開就被收起。用 passive effect：它在
    RightPanelProvider 的 layout effect 之後才跑，不會被「換頁就收起」蓋掉。

    面板內容在 render 期間就換（React 的「依 props 調整 state」寫法，以 location key 防止
    重複），effect 只負責打開右側欄與換掉 state 這兩件外部的事。
  */
  const openCounterpartyId = readOpenCounterpartyState(location.state);
  const [handledLocationKey, setHandledLocationKey] = useState<string | null>(null);
  if (openCounterpartyId !== null && handledLocationKey !== location.key) {
    setHandledLocationKey(location.key);
    setPanelTarget({ kind: 'counterparty', counterpartyId: openCounterpartyId });
  }
  useEffect(() => {
    if (openCounterpartyId === null) {
      return;
    }
    open();
    setSearchParams((current) => current, { replace: true, state: { keepRightPanel: true } });
  }, [open, openCounterpartyId, setSearchParams]);

  const settleIntentReady =
    settleIntent?.ledgerId === ledger.id &&
    requestedView === 'settle' &&
    !ledgerPeople.isLoading &&
    !currentUser.isLoading;
  const settleIntentPersonId = settleIntent?.personId;
  const settleIntentAmount = settleIntent?.amount;
  const currentPerson = ledgerPeople.data?.find((person) => person.userId === currentUser.data?.id);
  const settlePrefill = useMemo(() => {
    if (
      !settleIntentReady ||
      !currentPerson ||
      settleIntentPersonId === undefined ||
      settleIntentAmount === undefined ||
      settleIntentAmount === 0
    ) {
      return null;
    }
    return {
      fromPersonId: settleIntentAmount > 0 ? settleIntentPersonId : currentPerson.id,
      toPersonId: settleIntentAmount > 0 ? currentPerson.id : settleIntentPersonId,
      amount: Math.abs(settleIntentAmount),
    };
  }, [currentPerson, settleIntentAmount, settleIntentPersonId, settleIntentReady]);
  const [handledSettleLocationKey, setHandledSettleLocationKey] = useState<string | null>(null);
  if (settleIntentReady && handledSettleLocationKey !== location.key) {
    setHandledSettleLocationKey(location.key);
    if (settlePrefill) {
      setPanelTarget({ kind: 'settlement', prefill: settlePrefill });
    }
  }
  useEffect(() => {
    if (!settleIntentReady || handledSettleLocationKey !== location.key) {
      return;
    }
    if (settlePrefill) {
      open();
    }
    setSearchParams((current) => current, { replace: true, state: { keepRightPanel: true } });
  }, [
    handledSettleLocationKey,
    location.key,
    open,
    setSearchParams,
    settleIntentReady,
    settlePrefill,
  ]);

  /** 往來帳的「記一筆」回到借還表單，預帶對象並把面板焦點移入表單。 */
  function recordEntry(name: string) {
    setPanelTarget({ kind: 'new', debtCounterparty: name });
    requestFocus();
  }

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

  /** 結清檢視的主按鈕開一張空白結清表單。 */
  function startAddingSettlement() {
    setPanelTarget({ kind: 'settlement' });
    open();
  }

  function openSuggestedSettlement(
    prefill: NonNullable<Extract<PanelTarget, { kind: 'settlement' }>['prefill']>,
  ) {
    setPanelTarget({ kind: 'settlement', prefill });
    open();
  }

  const selectedTransactionId =
    isOpen && panelTarget.kind === 'transaction'
      ? panelTarget.transaction.id
      : isOpen && panelTarget.kind === 'debtTransaction'
        ? panelTarget.transaction.id
        : isOpen && panelTarget.kind === 'fillAccount'
          ? panelTarget.transaction.id
          : isOpen && panelTarget.kind === 'settlement'
            ? (panelTarget.settlement?.id ?? null)
            : null;

  return (
    <>
      {/* 橫條左邊是作用中帳本（SC-38.2），右邊是這一頁的主要按鈕（SC-38.3）。 */}
      <PageToolbarStart>
        <LedgerSwitcher />
      </PageToolbarStart>
      <PageToolbarActions>
        {view === 'settle' ? (
          ledger.role !== 'VIEWER' &&
          ledger.archivedAt === null && (
            <Button onClick={startAddingSettlement}>
              <Icon name="plus" />
              新增結清
            </Button>
          )
        ) : (
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
            {ledger.kind === 'SHARED' && (
              <button
                type="button"
                className={styles.viewSwitchButton}
                aria-pressed={view === 'settle'}
                onClick={() => switchView('settle')}
              >
                結清
              </button>
            )}
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

        {view === 'debts' ? (
          // 借還檢視不吃帳本（債務屬於使用者），整組換掉而不是疊在明細之上。
          <DebtsView onSelectCounterparty={openCounterparty} />
        ) : view === 'settle' ? (
          <SettlementView ledger={ledger} onSettle={openSuggestedSettlement} />
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

      <TransactionWorkbench
        ledger={ledger}
        target={panelTarget}
        onClose={closeWorkbench}
        onRecordEntry={recordEntry}
      />
    </>
  );
}
