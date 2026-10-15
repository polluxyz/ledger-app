import type { Account } from '@ledger/shared';
import { FormError } from '../../components/FormError';
import { Icon } from '../../components/Icon';
import { formatMoney } from '../../lib/format';
import styles from './AccountList.module.css';

interface AccountListProps {
  accounts: Account[];
  isLoading: boolean;
  error: unknown;
  onEdit: (account: Account) => void;
  onRemove: (account: Account) => void;
}

/**
 * 帳戶列表。形狀比照 `TransactionList`（一列一筆、金額右對齊、列尾兩顆圖示鈕），
 * 讓兩個列表看起來屬於同一個 app。
 *
 * 餘額由後端算好送來，前端只負責顯示——不在這裡做任何加總或換算。
 *
 * 一般帳戶保留改名與刪除圖示；臨時帳戶只顯示名稱和後端提供的餘額，不能編輯。
 */
export function AccountList({ accounts, isLoading, error, onEdit, onRemove }: AccountListProps) {
  if (isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }
  if (error) {
    return <FormError error={error} />;
  }
  // 後端已把臨時帳戶排在最後；只依 hasTransactions 隱藏空的臨時帳戶，保留原順序。
  const visibleAccounts = accounts.filter(
    (account) => !account.isTemporary || account.hasTransactions,
  );

  if (visibleAccounts.length === 0) {
    return (
      <p className={styles.empty}>
        還沒有任何帳戶。
        {/* 一般帳戶可以被刪光，但之後記帳仍需要至少一個真正帳戶。 */}
        <strong className={styles.emptyHint}>至少保留一個帳戶才能記帳。</strong>
      </p>
    );
  }

  return (
    <ul className={styles.list}>
      {visibleAccounts.map((account) => {
        const name = account.isTemporary ? '臨時帳戶' : account.name;
        return (
          <li className={styles.item} key={account.id}>
            {/* 初始餘額建立後就不能改，列表只顯示後端算好的目前餘額。 */}
            <span className={styles.name}>{name}</span>
            <span
              className={`${styles.balance} ${account.balance < 0 ? styles.negative : ''}`}
              // 讓螢幕閱讀器知道這個數字是什麼，不必依賴視覺上的位置。
              aria-label={`${name}餘額`}
            >
              {formatMoney(account.balance)}
            </span>
            {!account.isTemporary && (
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => onEdit(account)}
                  aria-label={`編輯${account.name}`}
                  title={`編輯${account.name}`}
                >
                  <Icon name="edit" />
                </button>
                <button
                  type="button"
                  className={`${styles.action} ${styles.remove}`}
                  onClick={() => onRemove(account)}
                  aria-label={`刪除${account.name}`}
                  title={`刪除${account.name}`}
                >
                  <Icon name="trash" />
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
