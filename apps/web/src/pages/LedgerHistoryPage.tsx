import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageToolbarStart } from '../app/PageToolbar';
import { Icon } from '../components/Icon';
import { PageContent } from '../components/PageContent';
import { Pagination } from '../components/Pagination';
import { TransactionList } from '../features/transactions/TransactionList';
import { useTransactions } from '../features/transactions/use-transactions';
import { useLedger } from '../features/ledgers/use-ledgers';
import { ApiError } from '../lib/api-client';
import styles from './LedgerHistoryPage.module.css';

/**
 * 已退出共享帳本的歷史頁。帳本名稱與交易範圍都由 API 提供，頁面只負責唯讀呈現。
 */
export default function LedgerHistoryPage() {
  const { ledgerId } = useParams<{ ledgerId: string }>();
  const ledger = useLedger(ledgerId ?? null);

  if (ledger.isLoading) {
    return (
      <>
        <BackToLedgers />
        <PageContent>
          <PageHeader title="帳本" />
          <p className={styles.status}>載入中…</p>
        </PageContent>
      </>
    );
  }

  if (ledger.error || !ledger.data) {
    const notFound = ledger.error instanceof ApiError && ledger.error.statusCode === 404;
    return (
      <>
        <BackToLedgers />
        <PageContent>
          <PageHeader title="帳本" />
          <p className={styles.status}>
            {notFound ? '找不到這本帳本。' : '無法載入這本帳本，請稍後再試。'}
          </p>
        </PageContent>
      </>
    );
  }

  return (
    <>
      <BackToLedgers />
      <PageContent>
        <header className={styles.header}>
          <h2 className={styles.title}>{ledger.data.name}</h2>
          {ledger.data.left === true && <span className={styles.leftTag}>已退出</span>}
        </header>
        <LedgerHistoryTransactions key={ledger.data.id} ledgerId={ledger.data.id} />
      </PageContent>
    </>
  );
}

function LedgerHistoryTransactions({ ledgerId }: { ledgerId: string }) {
  const [page, setPage] = useState(1);
  const transactions = useTransactions(ledgerId, { page, limit: 20 });

  return (
    <section className={styles.listCard} aria-label="交易與結清">
      <TransactionList
        transactions={transactions.data?.items ?? []}
        isLoading={transactions.isLoading}
        error={transactions.error}
        emptyMessage="還沒有任何交易。"
        readOnly
        onEdit={() => undefined}
      />
      <Pagination
        page={transactions.data?.page ?? page}
        limit={transactions.data?.limit ?? 20}
        total={transactions.data?.total ?? 0}
        onChange={setPage}
      />
    </section>
  );
}

function BackToLedgers() {
  return (
    <PageToolbarStart>
      <Link className={styles.back} to="/ledgers" aria-label="回到帳本列表">
        <Icon name="chevronLeft" size={16} />
        帳本
      </Link>
    </PageToolbarStart>
  );
}

function PageHeader({ title }: { title: string }) {
  return (
    <header className={styles.loadingHeader}>
      <h2 className={styles.title}>{title}</h2>
    </header>
  );
}
