import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Account, BalanceTrend } from '@ledger/shared';
import { Link } from 'react-router-dom';
import { formatMoney } from '../../lib/format';
import { HomeAccountList } from './HomeAccountList';
import styles from './AssetCard.module.css';

type QueryState<T> = Pick<UseQueryResult<T, Error>, 'data' | 'error' | 'isLoading'>;

export interface AssetCardProps {
  totalQuery: QueryState<BalanceTrend>;
  accountsQuery: QueryState<Account[]>;
  categorySection?: ReactNode;
}

/** 首頁資產卡只呈現各 query 的回應，總額直接採用資產趨勢最後一個月。 */
export function AssetCard({ totalQuery, accountsQuery, categorySection }: AssetCardProps) {
  const total = totalQuery.data?.months.at(-1)?.total;

  return (
    <section className={styles.card} aria-labelledby="home-asset-heading">
      <header className={styles.header}>
        <h2 className={styles.heading} id="home-asset-heading">
          資產
        </h2>
        <Link className={styles.manage} to="/accounts">
          管理
        </Link>
      </header>

      <div className={styles.overview}>
        <div className={styles.total} aria-labelledby="home-asset-total-label">
          <h3 className={styles.totalLabel} id="home-asset-total-label">
            總額
          </h3>
          {totalQuery.isLoading ? (
            <p className={styles.status} role="status">
              載入中…
            </p>
          ) : totalQuery.error ? (
            <p className={styles.status} role="status">
              總額暫時無法載入
            </p>
          ) : total === undefined ? (
            <p className={styles.status} role="status">
              —
            </p>
          ) : (
            <p className={styles.amount} aria-label={`總額 ${formatMoney(total)}`}>
              {formatMoney(total)}
            </p>
          )}
        </div>

        {categorySection != null && <div className={styles.categories}>{categorySection}</div>}
      </div>

      <div className={styles.accounts}>
        <h3 className={styles.accountsHeading}>帳戶</h3>
        {accountsQuery.isLoading ? (
          <p className={styles.status} role="status">
            載入中…
          </p>
        ) : accountsQuery.error ? (
          <p className={styles.status} role="status">
            帳戶暫時無法載入
          </p>
        ) : (
          <HomeAccountList accounts={accountsQuery.data ?? []} />
        )}
      </div>
    </section>
  );
}
