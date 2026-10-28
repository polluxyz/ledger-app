import type { Account } from '@ledger/shared';
import { formatMoney } from '../../lib/format';
import styles from './HomeAccountList.module.css';

interface HomeAccountListProps {
  accounts: readonly Account[];
}

/** 首頁帳戶列保留 API 順序，並依可見帳戶數決定清單自身的欄數。 */
export function HomeAccountList({ accounts }: HomeAccountListProps) {
  const visibleAccounts = accounts.filter(
    (account) => !account.isTemporary || account.hasTransactions,
  );

  if (visibleAccounts.length === 0) {
    return <p className={styles.empty}>還沒有帳戶。</p>;
  }

  return (
    <ul
      className={`${styles.list} ${visibleAccounts.length >= 6 ? styles.multiColumnList : ''}`}
      aria-label="帳戶"
    >
      {visibleAccounts.map((account) => {
        const name = account.isTemporary ? '臨時帳戶' : account.name;
        return (
          <li className={styles.item} key={account.id}>
            <span className={styles.name} title={name}>
              {name}
            </span>
            <span
              className={`${styles.balance} ${account.balance < 0 ? styles.negative : ''}`}
              aria-label={`${name}餘額`}
            >
              {formatMoney(account.balance)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
