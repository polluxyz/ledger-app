import { useState } from 'react';
import type { LedgerSummary, Transaction } from '@ledger/shared';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FormError } from '../components/FormError';
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
 * - **已登入**：顯示自己的記帳畫面（交易列表與新增表單於 Slice 0 後半實作）。
 *
 * 統計卡片在登入後標示為「即將推出」：正確的數字必須由後端彙總端點提供，
 * 拿前端當頁的交易自行加總會是錯的（只算得到那一頁），也違反單一後端原則。
 */
export default function HomePage() {
  const { isAuthenticated } = useAuth();
  // null = 彈窗關閉；登入 / 註冊共用同一個彈窗，只是預設顯示哪張表單不同。
  const [authDialog, setAuthDialog] = useState<AuthDialogMode | null>(null);

  return (
    <>
      <div className={styles.stats}>
        <Stat label="本月支出" authenticated={isAuthenticated} />
        <Stat label="本月收入" authenticated={isAuthenticated} />
        <Stat label="結餘" authenticated={isAuthenticated} />
      </div>

      {/*
        餘額列只在已登入時渲染。這不只是版面問題：hook 不能有條件呼叫，元件一旦
        掛上去就會打 `/accounts`，訪客沒有 token，那會是一個註定 401 的請求。
      */}
      {isAuthenticated && <AccountBalances />}

      {isAuthenticated ? (
        <LedgerView />
      ) : (
        <section className={styles.panel}>
          <p className={styles.panelText}>登入後即可開始記帳，並在這裡看到你的收支。</p>
          <div className={styles.actions}>
            <Button onClick={() => setAuthDialog('login')}>登入</Button>
            <Button variant="secondary" onClick={() => setAuthDialog('register')}>
              註冊
            </Button>
          </div>
        </section>
      )}

      {/* 登入成功後彈窗關閉，本頁就地換成已登入狀態——使用者不會被跳走。 */}
      <AuthDialog mode={authDialog} onClose={() => setAuthDialog(null)} />
    </>
  );
}

/**
 * 已登入者的記帳畫面。這一層只負責找出「記進哪一本帳本」
 * （由 ActiveLedgerProvider 決定，Slice 2 Step 2），其餘交給 `LedgerTransactions`。
 *
 * `key={ledger.id}` 是刻意的：換一本帳本就換一組篩選條件與頁碼。用 key 讓 React
 * 整個重建那棵子樹，比自己在 effect 裡把每個 state 歸零可靠——漏掉一個的症狀是
 * 「切到只有 3 筆的帳本卻停在第 5 頁」，畫面一片空白而看不出原因。
 */
function LedgerView() {
  const { ledger, isLoading: ledgerLoading, error: ledgerError } = useActiveLedger();

  if (ledgerLoading) {
    return <p className={styles.panelText}>載入中…</p>;
  }
  if (ledgerError) {
    return <FormError error={ledgerError} />;
  }
  if (!ledger) {
    return (
      <section className={styles.panel}>
        <p className={styles.panelText}>找不到任何帳本。</p>
      </section>
    );
  }

  return <LedgerTransactions key={ledger.id} ledger={ledger} />;
}

/**
 * 一本帳本的記帳畫面：新增表單、篩選、列表、分頁，以及編輯與刪除的彈窗。
 *
 * 兩個彈窗的**資料流留在這一層**（比照 `AccountsPage`）：`TransactionDialog` 與
 * `ConfirmDialog` 只負責呈現與回報操作，mutation、載入中與錯誤都在這裡。
 */
function LedgerTransactions({ ledger }: { ledger: LedgerSummary }) {
  const [filters, setFilters] = useState<TransactionFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);

  const transactions = useTransactions(ledger.id, toListQuery(filters, page));
  const deleteTransaction = useDeleteTransaction(ledger.id);

  // null = 彈窗關閉；交易物件 = 正在編輯 / 準備刪除的那一筆。
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
      <TransactionForm ledger={ledger} />

      <TransactionFilterBar ledgerId={ledger.id} filters={filters} onChange={handleFiltersChange} />

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

      <TransactionDialog ledger={ledger} transaction={editing} onClose={() => setEditing(null)} />

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

/**
 * 單張統計卡片。未登入時顯示 0（空狀態示意）；已登入時顯示「即將推出」，
 * 等後端彙總端點完成後再點亮。
 */
function Stat({ label, authenticated }: { label: string; authenticated: boolean }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={`${styles.statValue} ${authenticated ? styles.pending : ''}`}>
        {authenticated ? '即將推出' : '$0'}
      </span>
    </div>
  );
}
