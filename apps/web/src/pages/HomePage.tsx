import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { FormError } from '../components/FormError';
import { useAuth } from '../features/auth/use-auth';
import { useCurrentLedger } from '../features/ledgers/use-ledgers';
import { TransactionForm } from '../features/transactions/TransactionForm';
import { TransactionList } from '../features/transactions/TransactionList';
import { useTransactions } from '../features/transactions/use-transactions';
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
  const { isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <header className={styles.header}>
        <h1 className={styles.title}>記帳系統</h1>
        {isAuthenticated && (
          <Button variant="secondary" onClick={logout}>
            登出
          </Button>
        )}
      </header>

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
            <Button onClick={() => void navigate('/login')}>登入</Button>
            <Button variant="secondary" onClick={() => void navigate('/register')}>
              註冊
            </Button>
          </div>
        </section>
      )}
    </>
  );
}

/**
 * 已登入者的記帳畫面：新增表單 + 交易列表。
 *
 * Slice 0 固定使用第一本帳本（註冊時自動建立的個人帳本）；帳本切換屬 Slice 1。
 */
function LedgerView() {
  const { ledger, isLoading: ledgerLoading, error: ledgerError } = useCurrentLedger();
  const transactions = useTransactions(ledger?.id ?? null);

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

  return (
    <>
      <TransactionForm ledgerId={ledger.id} />
      <TransactionList
        transactions={transactions.data?.items ?? []}
        isLoading={transactions.isLoading}
        error={transactions.error}
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
