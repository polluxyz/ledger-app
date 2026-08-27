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

  return (
    <div className={styles.layout}>
      {/* 左主欄：篩選、列表、分頁。帳本還沒好的三種狀態也都落在這裡。 */}
      <div className={styles.primary}>
        {ledgerLoading && <p className={styles.panelText}>載入中…</p>}
        {ledgerError && <FormError error={ledgerError} />}
        {!ledgerLoading && !ledgerError && !ledger && (
          <section className={styles.panel}>
            <p className={styles.panelText}>找不到任何帳本。</p>
          </section>
        )}
        {ledger && <LedgerTransactions key={ledger.id} ledger={ledger} />}
      </div>

      {/*
        右側欄：記帳表單與餘額。表單常駐而不是藏進彈窗——記帳是高頻動作，
        少一次點擊有感（2f · D2）。

        餘額列**不受帳本狀態影響**：帳戶屬於使用者、跨帳本共用，就算一本帳本都
        沒有，「我現在有多少錢」仍然該看得到。它只需要已登入，而這裡就在
        `isAuthenticated` 之下——hook 不能有條件呼叫，訪客渲染它就是一個註定
        401 的 `/accounts` 請求。
      */}
      <aside className={styles.rail}>
        {ledger && <TransactionForm key={ledger.id} ledger={ledger} />}
        <AccountBalances />
      </aside>
    </div>
  );
}

/**
 * 一本帳本的交易區：篩選、列表、分頁，以及編輯與刪除的彈窗。
 *
 * **新增表單不在這裡**——它被移到右側欄（2f · D2）。之所以搬得動，是因為
 * `TransactionForm` 只吃一個 `ledger` prop，與篩選、頁碼沒有任何共用狀態。
 * 它在那邊有自己的 `key={ledger.id}`，換帳本一樣會整個重建。
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
