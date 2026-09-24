import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LedgerSummary, Transaction } from '@ledger/shared';
import { PageToolbarActions, PageToolbarStart } from '../app/PageToolbar';
import { useRightPanel } from '../app/right-panel-context';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FormError } from '../components/FormError';
import { Icon } from '../components/Icon';
import { PageContent } from '../components/PageContent';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { LedgerSwitcher } from '../features/ledgers/LedgerSwitcher';
import { useActiveLedger } from '../features/ledgers/use-active-ledger';
import { DebtsView } from '../features/debts/DebtsView';
import { TransactionFilterBar } from '../features/transactions/TransactionFilters';
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
import { useDeleteTransaction, useTransactions } from '../features/transactions/use-transactions';
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
 * 檢視切換的兩個值。狀態放在網址查詢參數（`?view=debts`）：重整後停在同一個
 * 檢視，也能直接把借還檢視的網址分享出去（spec 4.2、SC-W9）。
 */
type TransactionsView = 'details' | 'debts';

/**
 * 一本帳本的交易列表。
 *
 * ## 為什麼 `editing` 放在這一層（D25）
 *
 * 列表在頁面裡、面板在右側欄（portal 過去），兩者只有這個共同的父層。點了哪一筆
 * 要傳給面板，所以 `editing` 只能放這裡。點一列或點鉛筆都做兩件事：設定 `editing`、
 * 呼叫 `open()` 把右側欄打開——使用者收起過面板時，點了卻沒反應是最糟的情況。
 *
 * 兩個彈窗的**資料流留在這一層**（比照 `AccountsPage`）：`ConfirmDialog` 只負責
 * 呈現與回報操作，mutation、載入中與錯誤都在這裡。
 */
function LedgerTransactions({ ledger }: { ledger: LedgerSummary }) {
  const { open, requestFocus } = useRightPanel();
  const [filters, setFilters] = useState<TransactionFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  // 檢視放在網址而非 state（spec 4.2）：重整要留在同一個檢視。
  const [searchParams, setSearchParams] = useSearchParams();
  const view: TransactionsView = searchParams.get('view') === 'debts' ? 'debts' : 'details';

  const transactions = useTransactions(ledger.id, toListQuery(filters, page));
  const deleteTransaction = useDeleteTransaction(ledger.id);

  // 面板顯示的目標：新增表單（預設）、編輯一般交易或檢視債務詳情（plan §2.5）。
  const [panelTarget, setPanelTarget] = useState<PanelTarget>({ kind: 'new' });
  const [removing, setRemoving] = useState<Transaction | null>(null);

  /** 切換檢視寫回網址；「明細」時清掉參數，回到乾淨的 /transactions。 */
  function switchView(next: TransactionsView) {
    setSearchParams(next === 'debts' ? { view: 'debts' } : {}, { state: { keepRightPanel: true } });
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
    setPanelTarget({ kind: 'transaction', transaction });
    open();
  }

  function openCounterparty(counterpartyId: string) {
    setPanelTarget({ kind: 'counterparty', counterpartyId });
    open();
  }

  /** 往來帳的「記一筆」回到借還表單，預帶對象並把面板焦點移入表單。 */
  function recordEntry(name: string) {
    setPanelTarget({ kind: 'new', debtCounterparty: name });
    requestFocus();
  }

  /** 「＋ 新增交易」：回到新增表單，打開右側欄並把焦點送到金額欄（SC-35.3）。 */
  function startAdding() {
    setPanelTarget({ kind: 'new' });
    requestFocus();
  }

  function closeRemove() {
    setRemoving(null);
    // 清掉上一次的失敗，下次開啟才不會殘留紅字。
    deleteTransaction.reset();
  }

  function confirmRemove() {
    if (removing) {
      // 失敗時**不關彈窗**，錯誤由 ConfirmDialog 就地顯示——關掉的話使用者只會
      // 看到「什麼都沒發生」。
      deleteTransaction.mutate(removing.id, { onSuccess: closeRemove });
    }
  }

  return (
    <>
      {/* 橫條左邊是作用中帳本（SC-38.2），右邊是這一頁的主要按鈕（SC-38.3）。 */}
      <PageToolbarStart>
        <LedgerSwitcher />
      </PageToolbarStart>
      <PageToolbarActions>
        <Button onClick={startAdding}>
          <Icon name="plus" />
          新增交易
        </Button>
      </PageToolbarActions>

      <PageContent>
        <PageHeader title="交易" />

        {/*
          「明細／借還」的檢視切換（spec 4.2）。狀態在網址上，這裡只反映目前值。
          借還也是交易（錢進出帳戶），所以它住在交易頁，側欄不加項目（決策 W1）。
        */}
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

        {view === 'debts' ? (
          // 借還檢視不吃帳本（債務屬於使用者），整組換掉而不是疊在明細之上。
          <DebtsView onSelectCounterparty={openCounterparty} />
        ) : (
          // 篩選、列表、分頁是同一份資料的三個面，收進同一張卡片才看得出來。
          <section className={styles.listCard}>
            <TransactionFilterBar
              ledgerId={ledger.id}
              filters={filters}
              onChange={handleFiltersChange}
            />

            <TransactionList
              transactions={transactions.data?.items ?? []}
              isLoading={transactions.isLoading}
              error={transactions.error}
              isFiltered={hasAnyFilter(filters)}
              onEdit={startEditing}
              onRemove={setRemoving}
              onOpenCounterparty={openCounterparty}
              // 右側欄正在編輯的那一筆要在列表上標出來，否則使用者看不出面板裡是哪一筆。
              selectedId={panelTarget.kind === 'transaction' ? panelTarget.transaction.id : null}
            />

            <Pagination
              page={transactions.data?.page ?? page}
              limit={transactions.data?.limit ?? 20}
              total={transactions.data?.total ?? 0}
              onChange={setPage}
            />
          </section>
        )}
      </PageContent>

      <TransactionWorkbench
        ledger={ledger}
        target={panelTarget}
        onClose={() => setPanelTarget({ kind: 'new' })}
        onRecordEntry={recordEntry}
        onCounterpartyDeleted={() => setPanelTarget({ kind: 'new' })}
      />

      {/*
        刪除確認刻意留在版面之外：它是 modal，不屬於任何一欄，也不該被內容的
        最大寬度或捲動容器影響。
      */}
      <ConfirmDialog
        open={removing !== null}
        title="刪除交易"
        // 後端是軟刪除（資料列保留供稽核），但畫面上沒有還原的路，對使用者而言
        // 就是回不去。文案要照實說。
        message="確定要刪除這筆交易嗎？刪除後無法復原。"
        confirmLabel="刪除"
        error={deleteTransaction.error}
        isPending={deleteTransaction.isPending}
        onConfirm={confirmRemove}
        onCancel={closeRemove}
      />
    </>
  );
}
