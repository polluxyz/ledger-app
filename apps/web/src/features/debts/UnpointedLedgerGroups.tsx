import type { LedgerGroup } from '@ledger/shared';
import { SmallDebtDirection } from './LedgerSourceList';
import styles from './UnpointedLedgerGroups.module.css';

interface UnpointedLedgerGroupsProps {
  groups: readonly LedgerGroup[];
}

/** 未指向的人依 API 分組唯讀呈現，保留帳本名稱與原始結清方向。 */
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
            {people.map(({ person, amount }) => {
              return (
                <li key={person.id}>
                  <span className={styles.person}>
                    <span className={styles.personName}>{person.name}</span>
                    <SmallDebtDirection personName={person.name} amount={amount} />
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
