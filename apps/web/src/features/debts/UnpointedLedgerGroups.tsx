import type { CounterpartyLedgerPart, LedgerGroup } from '@ledger/shared';
import { formatMoney } from '../../lib/format';
import { SmallDebtDirection } from './LedgerSourceList';
import styles from './UnpointedLedgerGroups.module.css';

interface UnpointedLedgerGroupsProps {
  groups: readonly LedgerGroup[];
  onOpenSource: (source: CounterpartyLedgerPart) => void;
}

/** 未指向的人依 API 分組顯示，前端只把帳本與結清金額排成可開啟的列。 */
export function UnpointedLedgerGroups({ groups, onOpenSource }: UnpointedLedgerGroupsProps) {
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
              const source: CounterpartyLedgerPart = {
                ledgerId: ledger.id,
                ledgerName: ledger.name,
                personId: person.id,
                personName: person.name,
                amount,
                left: ledger.left,
              };
              const direction = amount > 0 ? `${person.name}欠你` : `你欠${person.name}`;
              const access = ledger.left
                ? `開啟已退出帳本 ${ledger.name} 的唯讀畫面`
                : `開啟 ${ledger.name} 的結清`;

              return (
                <li key={person.id}>
                  <button
                    type="button"
                    className={styles.person}
                    aria-label={`${access}：${direction} ${formatMoney(Math.abs(amount))}`}
                    onClick={() => onOpenSource(source)}
                  >
                    <span className={styles.personName}>{person.name}</span>
                    <SmallDebtDirection personName={person.name} amount={amount} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
