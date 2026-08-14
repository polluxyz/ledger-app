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
 * 金額前綴。轉帳刻意**不用正負號**：錢只是換了帳戶，既不是支出也不是收入，
 * 用「−」會讓人以為花掉了。三種型別各自給值，而不是「非支出即收入」的二分法
 * ——後者在 TRANSFER 出現後就是錯的。
 */
const AMOUNT_SIGN: Record<Transaction['type'], string> = {
  EXPENSE: '-',
  INCOME: '+',
  TRANSFER: '',
};

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
            {/* 分類為 null＝這是一筆轉帳（轉帳沒有分類）。 */}
            <span className={styles.category}>{transaction.category?.name ?? '轉帳'}</span>
            <span className={styles.meta}>
              {formatDate(transaction.date)}
              {/* 帳戶為 null＝別人的帳戶（已遮蔽），或這本帳本不與餘額連動。 */}
              {transaction.account && `・${transaction.account.name}`}
              {transaction.toAccount && ` → ${transaction.toAccount.name}`}
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
            {AMOUNT_SIGN[transaction.type]}${formatAmount(transaction.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}
