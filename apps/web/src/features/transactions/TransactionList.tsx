import type { Transaction } from '@ledger/shared';
import { FormError } from '../../components/FormError';
import { formatAmount, formatDate } from '../../lib/format';
import styles from './TransactionList.module.css';

interface TransactionListProps {
  transactions: Transaction[];
  isLoading: boolean;
  error: unknown;
  onEdit: (transaction: Transaction) => void;
  onRemove: (transaction: Transaction) => void;
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
 * 一列的口語描述，給編輯／刪除鈕當無障礙名稱用。
 *
 * 列表上每一列的按鈕文字都是「編輯」「刪除」，光靠文字分不出是哪一筆——
 * 螢幕閱讀器的使用者會聽到一串一模一樣的按鈕。加上日期與分類才指得明確。
 */
function describe(transaction: Transaction): string {
  return `${formatDate(transaction.date)} 的${transaction.category?.name ?? '轉帳'}`;
}

/**
 * 交易列表。順序完全依後端給的（日期新→舊），前端不重新排序也不加總——
 * 那些都是後端的職責。
 */
export function TransactionList({
  transactions,
  isLoading,
  error,
  onEdit,
  onRemove,
}: TransactionListProps) {
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
          <div className={styles.right}>
            <span
              className={`${styles.amount} ${
                transaction.type === 'EXPENSE' ? styles.expense : styles.income
              }`}
            >
              {AMOUNT_SIGN[transaction.type]}${formatAmount(transaction.amount)}
            </span>
            {/* 共享帳本裡任何 editor 都能改任何一筆（後端的決策 8），所以每一列
                都有入口。真正的權限在後端把關，這裡不做任何判斷。 */}
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.action}
                onClick={() => onEdit(transaction)}
                aria-label={`編輯${describe(transaction)}`}
              >
                編輯
              </button>
              <button
                type="button"
                className={`${styles.action} ${styles.remove}`}
                onClick={() => onRemove(transaction)}
                aria-label={`刪除${describe(transaction)}`}
              >
                刪除
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
