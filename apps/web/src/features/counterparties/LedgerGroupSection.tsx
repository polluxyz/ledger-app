import type { Counterparty, LedgerGroup, LedgerGroupPerson } from '@ledger/shared';
import { Button } from '../../components/Button';
import styles from './LedgerGroupSection.module.css';

interface LedgerGroupSectionProps {
  group: LedgerGroup;
  counterparties: Counterparty[];
  onSetPointer: (person: LedgerGroupPerson) => void;
}

/** 對象頁只呈現 API 給的帳本分組與名單，讓人名管理留在這裡、帳務留在交易頁。 */
export function LedgerGroupSection({
  group,
  counterparties,
  onSetPointer,
}: LedgerGroupSectionProps) {
  const counterpartyNames = new Map(
    counterparties.map((counterparty) => [counterparty.id, counterparty.displayName]),
  );

  return (
    <section className={styles.section} aria-labelledby={`ledger-group-${group.ledger.id}`}>
      <div className={styles.heading}>
        <h3 className={styles.title} id={`ledger-group-${group.ledger.id}`}>
          {group.ledger.name}
        </h3>
        <span className={styles.badge}>共享帳本</span>
        {group.ledger.left && <span className={styles.badge}>已退出</span>}
      </div>

      <ul className={styles.list}>
        {group.people.map((entry) => {
          const counterpartyName =
            entry.pointer.counterpartyId === null
              ? undefined
              : counterpartyNames.get(entry.pointer.counterpartyId);

          return (
            <li className={styles.item} key={entry.person.id}>
              <div className={styles.person}>
                <span className={styles.name}>{entry.person.name}</span>
                {counterpartyName !== undefined && (
                  <span className={styles.pointer}>→ {counterpartyName}</span>
                )}
                {entry.person.status === 'GUEST' && <span className={styles.badge}>虛擬成員</span>}
              </div>
              {!group.ledger.left && (
                <Button
                  type="button"
                  variant="secondary"
                  className={styles.pointerButton}
                  onClick={() => onSetPointer(entry)}
                >
                  指向
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
