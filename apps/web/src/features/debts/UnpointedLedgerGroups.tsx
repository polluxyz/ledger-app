import type { LedgerGroup } from '@ledger/shared';
import { BalanceArrow } from './BalanceArrow';
import styles from './UnpointedLedgerGroups.module.css';

interface UnpointedLedgerGroupsProps {
  groups: readonly LedgerGroup[];
}

/**
 * 沒指向的人依帳本分組、唯讀呈現在對象清單下方。每一列的版面（名字、頭貼箭頭、
 * 「需要支付」、金額靠右）跟上面的對象列一致，只差在多了帳本名稱當組標題。
 */
export function UnpointedLedgerGroups({ groups }: UnpointedLedgerGroupsProps) {
  if (groups.length === 0) {
    return null;
  }

  return (
    <section className={styles.groups} aria-label="沒指向的共享帳本">
      {groups.map(({ ledger, people }) => (
        <section key={ledger.id} className={styles.group}>
          <h3 className={styles.heading}>
            {ledger.name}
            {ledger.left && <span className={styles.left}>已退出</span>}
          </h3>
          <ul className={styles.people}>
            {people.map(({ person, amount }) => (
              <li key={person.id} className={styles.item}>
                <span className={styles.row}>
                  <span className={styles.name}>{person.name}</span>
                  <span className={styles.balance}>
                    <BalanceArrow name={person.name} amount={amount} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
