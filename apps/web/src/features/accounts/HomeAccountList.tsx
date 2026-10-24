import { useState } from 'react';
import type { Account } from '@ledger/shared';
import { formatMoney } from '../../lib/format';
import styles from './HomeAccountList.module.css';

interface HomeAccountListProps {
  accounts: readonly Account[];
}

/** 首頁帳戶列保留 API 順序，展開只改變可見列數與清單自身的版面。 */
export function HomeAccountList({ accounts }: HomeAccountListProps) {
  const [expanded, setExpanded] = useState(false);
  const visibleAccounts = accounts.filter(
    (account) => !account.isTemporary || account.hasTransactions,
  );
  const accountsToShow = expanded ? visibleAccounts : visibleAccounts.slice(0, 5);

  if (visibleAccounts.length === 0) {
    return <p className={styles.empty}>還沒有帳戶。</p>;
  }

  return (
    <>
      <ul className={`${styles.list} ${expanded ? styles.expandedList : ''}`} aria-label="帳戶">
        {accountsToShow.map((account) => {
          const name = account.isTemporary ? '臨時帳戶' : account.name;
          return (
            <li
              className={`${styles.item} ${expanded ? styles.expandedItem : ''}`}
              key={account.id}
            >
              <span className={styles.name}>{name}</span>
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
      {visibleAccounts.length > 5 && (
        <button
          className={styles.toggle}
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? '收起' : `全部 ${visibleAccounts.length} 個`}
        </button>
      )}
    </>
  );
}
