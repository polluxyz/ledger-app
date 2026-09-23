import { useState } from 'react';
import type { LedgerSummary, Transaction } from '@ledger/shared';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FormError } from '../components/FormError';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { AccountBalances } from '../features/accounts/AccountBalances';
import { AuthDialog, type AuthDialogMode } from '../features/auth/AuthDialog';
import { useAuth } from '../features/auth/use-auth';
import { useActiveLedger } from '../features/ledgers/use-active-ledger';
import { TransactionDialog } from '../features/transactions/TransactionDialog';
import { TransactionFilterBar } from '../features/transactions/TransactionFilters';
import { TransactionForm } from '../features/transactions/TransactionForm';
import { TransactionList } from '../features/transactions/TransactionList';
import {
  EMPTY_FILTERS,
  hasAnyFilter,
  toListQuery,
  type TransactionFilters,
} from '../features/transactions/transaction-query';
import { useDeleteTransaction, useTransactions } from '../features/transactions/use-transactions';
import styles from './HomePage.module.css';

/**
 * 首頁，有兩種狀態：
 *
 * - **未登入**：顯示介面預覽——統計卡片是純粹的空狀態（固定 0，不做任何計算），
 *   讓人先看懂這個 app 長什麼樣，再引導去登入 / 註冊。不保存任何訪客資料，
 *   因此前端毋須實作任何業務邏輯。
 * - **已登入**：左邊是交易列表、右邊是常駐的工作面板（phase-2h · D8/D9）。
 *
 * 統計卡片在登入後標示為「即將推出」：正確的數字必須由後端彙總端點提供，
 * 拿前端當頁的交易自行加總會是錯的（只算得到那一頁），也違反單一後端原則。
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
      <StatsRow authenticated={false} />

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
 * 已登入者的記帳畫面。這一層只負責找出「記進哪一本帳本」
 * （由 ActiveLedgerProvider 決定，Slice 2 Step 2），其餘交給 `LedgerWorkbench`。
 *
 * `key={ledger.id}` 是刻意的：換一本帳本就換一組篩選條件、頁碼與編輯中的那一筆。
 * 用 key 讓 React 整個重建那棵子樹，比自己在 effect 裡把每個 state 歸零可靠——
 * 漏掉一個的症狀是「切到只有 3 筆的帳本卻停在第 5 頁」，畫面一片空白而看不出原因。
 *
 * 帳本還沒好的三種狀態（載入中 / 失敗 / 一本都沒有）走下面那條路。它們仍然用
 * 同一個兩欄版面，因為**餘額不受帳本狀態影響**：帳戶屬於使用者、跨帳本共用，
 * 就算一本帳本都沒有，「我現在有多少錢」仍然該看得到。
 */
function LedgerView() {
  const { ledger, isLoading: ledgerLoading, error: ledgerError } = useActiveLedger();

  if (ledger) {
    return <LedgerWorkbench key={ledger.id} ledger={ledger} />;
  }

  return (
    <div className={styles.layout}>
      <div className={styles.primary}>
        <StatsRow authenticated />
        {ledgerLoading && <p className={styles.note}>載入中…</p>}
        {ledgerError && <FormError error={ledgerError} />}
        {!ledgerLoading && !ledgerError && (
          <section className={styles.card}>
            <p className={styles.note}>找不到任何帳本。</p>
          </section>
        )}
      </div>
      <aside className={styles.panel}>
        <AccountBalances />
      </aside>
    </div>
  );
}

/**
 * 一本帳本的工作台：左欄是頁首、統計卡與交易列表，右欄是常駐面板。
 *
 * ## 為什麼編輯狀態放在這一層（D9）
 *
 * 面板要顯示「新增」還是「編輯」，取決於列表上點了哪一筆。列表在左欄、面板在
 * 右欄，兩者只有這個共同的父層，`editing` 只能放這裡。
 *
 * **新增表單與編輯面板互斥**（D9 的警告）：兩張表單的欄位標籤一模一樣，同時
 * 存在的話 `getByLabelText('金額')` 會對到兩個，測試與螢幕閱讀器都分不出來。
 *
 * `key={editing.id}` 讓編輯中直接點另一列時表單整個重建——少了它，React 會沿用
 * 同一個元件實例，欄位仍留著上一筆的值。
 *
 * 兩個彈窗的**資料流留在這一層**（比照 `AccountsPage`）：`TransactionDialog` 與
 * `ConfirmDialog` 只負責呈現與回報操作，mutation、載入中與錯誤都在這裡。
 */
function LedgerWorkbench({ ledger }: { ledger: LedgerSummary }) {
  const [filters, setFilters] = useState<TransactionFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);

  const transactions = useTransactions(ledger.id, toListQuery(filters, page));
  const deleteTransaction = useDeleteTransaction(ledger.id);

  // null = 面板顯示新增表單 / 確認彈窗關閉；交易物件 = 正在編輯 / 準備刪除的那一筆。
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [removing, setRemoving] = useState<Transaction | null>(null);

  /**
   * 換了篩選條件就回到第 1 頁。少了這件事，使用者會在「第 5 頁」看到空白，
   * 而畫面上沒有任何線索說明原因。
   */
  function handleFiltersChange(next: TransactionFilters) {
    setFilters(next);
    setPage(1);
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
      <div className={styles.layout}>
        <div className={styles.primary}>
          <PageHeader
            title="總覽"
            context={
              <>
                <Icon name="book" size={14} />
                {ledger.name}・{ledger.kind === 'PERSONAL' ? '私人帳本' : '共享帳本'}
              </>
            }
          />

          <StatsRow authenticated />

          {/* 篩選、列表、分頁是同一份資料的三個面，收進同一張卡片才看得出來。 */}
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
              onEdit={setEditing}
              onRemove={setRemoving}
            />

            <Pagination
              page={transactions.data?.page ?? page}
              limit={transactions.data?.limit ?? 20}
              total={transactions.data?.total ?? 0}
              onChange={setPage}
            />
          </section>
        </div>

        <aside className={styles.panel}>
          {editing === null ? (
            <TransactionForm ledger={ledger} />
          ) : (
            <TransactionDialog
              key={editing.id}
              ledger={ledger}
              transaction={editing}
              onClose={() => setEditing(null)}
            />
          )}
          <AccountBalances />
        </aside>
      </div>

      {/*
        刪除確認刻意留在版面之外：它是 modal，不屬於任何一欄，而且窄螢幕編輯時
        左欄會被 CSS 整個隱藏（D10），放在裡面會跟著消失。
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

/** 三張「即將推出」的統計卡（phase-2h · D5：原樣保留，只換樣式）。 */
function StatsRow({ authenticated }: { authenticated: boolean }) {
  return (
    <div className={styles.stats}>
      <Stat label="本月支出" authenticated={authenticated} />
      <Stat label="本月收入" authenticated={authenticated} />
      <Stat label="結餘" authenticated={authenticated} />
    </div>
  );
}

/**
 * 單張統計卡片。未登入時顯示 0（空狀態示意）；已登入時顯示「即將推出」，
 * 等後端彙總端點完成後再點亮。
 */
function Stat({ label, authenticated }: { label: string; authenticated: boolean }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{authenticated ? '即將推出' : '$0'}</span>
    </div>
  );
}
