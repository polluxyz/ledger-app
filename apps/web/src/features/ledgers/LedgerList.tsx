import { Link } from 'react-router-dom';
import type { LedgerSummary } from '@ledger/shared';
import { FormError } from '../../components/FormError';
import styles from './LedgerList.module.css';

interface LedgerListProps {
  ledgers: LedgerSummary[];
  isLoading: boolean;
  error: unknown;
}

const ROLE_LABEL: Record<LedgerSummary['role'], string> = {
  OWNER: '擁有者',
  EDITOR: '可編輯',
  VIEWER: '唯讀',
};

/**
 * 帳本列表。形狀比照 `AccountList`（一列一筆、右側是狀態），讓兩個列表看起來
 * 屬於同一個 app。
 *
 * **不做分組**（私人一區、共享一區）。帳本數量現階段是個位數，分組只會多一層標題
 * 把畫面切碎——與 2c 對帳戶分組的判斷一致。要重新考慮的觸發條件是帳本超過 20 本。
 */
export function LedgerList({ ledgers, isLoading, error }: LedgerListProps) {
  if (isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }
  if (error) {
    return <FormError error={error} />;
  }
  if (ledgers.length === 0) {
    return <p className={styles.empty}>還沒有任何帳本。</p>;
  }

  return (
    <ul className={styles.list}>
      {ledgers.map((ledger) => (
        <li className={styles.item} key={ledger.id}>
          <div className={styles.main}>
            <Link className={styles.name} to={`/ledgers/${ledger.id}`}>
              {ledger.name}
            </Link>
            <div className={styles.tags}>
              <span className={ledger.kind === 'SHARED' ? styles.tagShared : styles.tag}>
                {ledger.kind === 'SHARED' ? '共享' : '私人'}
              </span>
              <span className={styles.tag}>{ROLE_LABEL[ledger.role]}</span>
              {/* 非連動帳本才標示。連動是預設，一律標只會讓每一列都長出一堆標籤。 */}
              {!ledger.tracksBalance && <span className={styles.tag}>不影響餘額</span>}
              {ledger.archivedAt !== null && <span className={styles.tagArchived}>已封存</span>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
