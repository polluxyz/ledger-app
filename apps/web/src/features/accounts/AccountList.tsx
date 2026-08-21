import type { Account } from '@ledger/shared';
import { FormError } from '../../components/FormError';
import { formatAmount } from '../../lib/format';
import styles from './AccountList.module.css';

interface AccountListProps {
  accounts: Account[];
  isLoading: boolean;
  error: unknown;
  onEdit: (account: Account) => void;
  onRemove: (account: Account) => void;
}

/**
 * 帳戶列表。形狀比照 `TransactionList`（同樣是一列一筆、右側對齊金額），
 * 讓兩個列表看起來屬於同一個 app。
 *
 * 餘額由後端算好送來，前端只負責顯示——不在這裡做任何加總或換算。
 */
export function AccountList({ accounts, isLoading, error, onEdit, onRemove }: AccountListProps) {
  if (isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }
  if (error) {
    return <FormError error={error} />;
  }
  if (accounts.length === 0) {
    return (
      <p className={styles.empty}>
        還沒有任何帳戶。
        {/* 帳戶可以被刪光（後端只擋有交易引用的），但那樣就記不了帳——
            連動帳本的交易必須指定帳戶。這裡把後果講出來。 */}
        <strong className={styles.emptyHint}>至少保留一個帳戶才能記帳。</strong>
      </p>
    );
  }

  return (
    <ul className={styles.list}>
      {accounts.map((account) => (
        <li className={styles.item} key={account.id}>
          <div className={styles.main}>
            {/* 只顯示名稱與目前餘額。初始餘額建立後就不能改，列出來只是佔位置，
                看的人真正在意的是「現在還有多少」。 */}
            <span className={styles.name}>{account.name}</span>
          </div>
          <div className={styles.right}>
            <span
              className={`${styles.balance} ${account.balance < 0 ? styles.negative : ''}`}
              // 讓螢幕閱讀器知道這個數字是什麼，不必依賴視覺上的位置。
              aria-label={`${account.name}餘額`}
            >
              ${formatAmount(account.balance)}
            </span>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.action}
                onClick={() => onEdit(account)}
                aria-label={`編輯${account.name}`}
              >
                編輯
              </button>
              <button
                type="button"
                className={`${styles.action} ${styles.remove}`}
                onClick={() => onRemove(account)}
                aria-label={`刪除${account.name}`}
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
