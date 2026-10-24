import type { UseQueryResult } from '@tanstack/react-query';
import type { Counterparty, LedgerGroup, Paginated } from '@ledger/shared';
import { Link } from 'react-router-dom';
import { BalanceArrow } from './BalanceArrow';
import styles from './DebtsCard.module.css';

type QueryState<T> = Pick<UseQueryResult<T, Error>, 'data' | 'error' | 'isLoading'>;

export interface DebtsCardProps {
  counterpartiesQuery: QueryState<Paginated<Counterparty>>;
  unpointedLedgersQuery: QueryState<LedgerGroup[]>;
  showAllLink: boolean;
}

const DEBTS_OVERVIEW_HREF = '/transactions?view=debts&tab=overview';

/** 首頁借還卡呈現兩份 query 的回應；金額和方向沿用回應及借還清單元件。 */
export function DebtsCard({
  counterpartiesQuery,
  unpointedLedgersQuery,
  showAllLink,
}: DebtsCardProps) {
  const counterparties = counterpartiesQuery.data?.items.slice(0, 5) ?? [];
  const ledgerGroups = unpointedLedgersQuery.data ?? [];
  const counterpartyTotal = counterpartiesQuery.data?.total ?? 0;
  const bothQueriesSucceeded =
    !counterpartiesQuery.isLoading &&
    !counterpartiesQuery.error &&
    counterpartiesQuery.data !== undefined &&
    !unpointedLedgersQuery.isLoading &&
    !unpointedLedgersQuery.error &&
    unpointedLedgersQuery.data !== undefined;
  const isEmpty = bothQueriesSucceeded && counterparties.length === 0 && ledgerGroups.length === 0;

  return (
    <section className={styles.card} aria-labelledby="home-debts-heading">
      <header className={styles.header}>
        <h2 className={styles.heading} id="home-debts-heading">
          借還
        </h2>
        {showAllLink && (
          <Link className={styles.allLink} to={DEBTS_OVERVIEW_HREF}>
            全部 →
          </Link>
        )}
      </header>

      {counterpartiesQuery.isLoading && (
        <p className={styles.status} role="status">
          對象載入中…
        </p>
      )}
      {counterpartiesQuery.error && (
        <p className={styles.status} role="status">
          對象暫時無法載入
        </p>
      )}
      {counterparties.length > 0 && (
        <ul className={styles.people} aria-label="往來對象">
          {counterparties.map((counterparty) => (
            <li className={styles.person} key={counterparty.id}>
              <span className={styles.name}>{counterparty.displayName}</span>
              <span className={styles.balance}>
                <BalanceArrow name={counterparty.displayName} amount={counterparty.totalBalance} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {showAllLink && counterpartyTotal > 5 && (
        <Link className={styles.allPeople} to={DEBTS_OVERVIEW_HREF}>
          全部 {counterpartyTotal} 人 →
        </Link>
      )}

      {unpointedLedgersQuery.isLoading && (
        <p className={styles.status} role="status">
          帳本載入中…
        </p>
      )}
      {unpointedLedgersQuery.error && (
        <p className={styles.status} role="status">
          帳本暫時無法載入
        </p>
      )}
      {ledgerGroups.map((group) => (
        <section className={styles.ledgerGroup} key={group.ledger.id}>
          <h3 className={styles.ledgerHeading}>{group.ledger.name}</h3>
          <ul className={styles.ledgerPeople} aria-label={`${group.ledger.name}未指向對象`}>
            {group.people.map(({ person, amount }) => (
              <li className={styles.person} key={person.id}>
                <span className={styles.name}>{person.name}</span>
                <span className={styles.balance}>
                  <BalanceArrow name={person.name} amount={amount} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {isEmpty && (
        <p className={styles.empty} role="status">
          沒有借還
        </p>
      )}
    </section>
  );
}
