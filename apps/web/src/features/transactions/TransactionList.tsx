import type { Transaction } from '@ledger/shared';
import { FormError } from '../../components/FormError';
import { formatAmount, formatDate } from '../../lib/format';
import styles from './TransactionList.module.css';

interface TransactionListProps {
  transactions: Transaction[];
  isLoading: boolean;
  error: unknown;
}

/**
 * 交易列表。順序完全依後端給的（日期新→舊），前端不重新排序也不加總——
 * 那些都是後端的職責。
 */
export function TransactionList({ transactions, isLoading, error }: TransactionListProps) {
  if (isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }
  if (error) {
    return <FormError error={error} />;
  }
  if (transactions.length === 0) {
    return <p className={styles.empty}>還沒有任何交易，從上方新增第一筆吧。</p>;
  }

  return (
    <ul className={styles.list}>
      {transactions.map((transaction) => (
        <li className={styles.item} key={transaction.id}>
          <div className={styles.main}>
            <span className={styles.category}>{transaction.category.name}</span>
            <span className={styles.meta}>
              {formatDate(transaction.date)}
              {transaction.paymentMethod && `・${transaction.paymentMethod.name}`}
            </span>
            {transaction.note && (
              <span className={`${styles.meta} ${styles.note}`}>{transaction.note}</span>
            )}
          </div>
          <span
            className={`${styles.amount} ${
              transaction.type === 'EXPENSE' ? styles.expense : styles.income
            }`}
          >
            {transaction.type === 'EXPENSE' ? '-' : '+'}${formatAmount(transaction.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}
