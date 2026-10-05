import type { LedgerSummary } from '@ledger/shared';
import { Button } from '../../components/Button';
import { DebtArrow } from '../../components/DebtArrow';
import { FormError } from '../../components/FormError';
import { formatMoney } from '../../lib/format';
import { useCurrentUser } from '../auth/use-current-user';
import type { SettlementPrefill } from '../transactions/TransactionWorkbench';
import { useSettlementSummary } from './use-settlements';
import styles from './SettlementView.module.css';

interface SettlementViewProps {
  ledger: LedgerSummary;
  onSettle: (prefill: SettlementPrefill) => void;
}

/**
 * 共享帳本的結清檢視（3e W110～W114）。淨額與建議直接呈現後端回應，這裡只把 id
 * 對回名字、標出目前使用者，並提供開啟結清表單的入口。
 */
export function SettlementView({ ledger, onSettle }: SettlementViewProps) {
  const summary = useSettlementSummary(ledger.id, ledger.kind === 'SHARED');
  const currentUser = useCurrentUser();
  const canCreate = ledger.role !== 'VIEWER' && ledger.archivedAt === null;
  const peopleById = new Map(summary.data?.people.map(({ person }) => [person.id, person]));

  function displayName(person: { id: string; name: string; userId: string | null }) {
    return person.userId !== null && person.userId === currentUser.data?.id ? '我' : person.name;
  }

  return (
    <div className={styles.view}>
      {summary.isLoading && <p className={styles.status}>載入中…</p>}
      {summary.error && <FormError error={summary.error} />}
      {summary.data && (
        <>
          <section className={styles.section} aria-labelledby="settlement-nets">
            <h2 className={styles.heading} id="settlement-nets">
              淨額
            </h2>
            <ul className={styles.netList}>
              {summary.data.people.map(({ person, net }) => (
                <li className={styles.netRow} key={person.id}>
                  <span>{displayName(person)}</span>
                  <span className={styles.amount}>
                    {net === 0
                      ? formatMoney(0)
                      : `${net > 0 ? '+' : '−'}${formatMoney(Math.abs(net))}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {summary.data.suggestions.length > 0 && (
            <section className={styles.section} aria-labelledby="settlement-suggestions">
              <h2 className={styles.heading} id="settlement-suggestions">
                建議
              </h2>
              <ul className={styles.suggestionList}>
                {summary.data.suggestions.map((suggestion, index) => {
                  const from = peopleById.get(suggestion.fromPersonId);
                  const to = peopleById.get(suggestion.toPersonId);
                  if (!from || !to) {
                    return null;
                  }

                  const fromName = displayName(from);
                  const toName = displayName(to);
                  return (
                    <li
                      className={styles.suggestionRow}
                      key={`${suggestion.fromPersonId}-${index}`}
                    >
                      <DebtArrow
                        from={fromName}
                        to={toName}
                        amount={suggestion.amount}
                        srText={`${fromName}欠${toName} ${formatMoney(suggestion.amount)}`}
                      />
                      {canCreate && (
                        <Button
                          type="button"
                          onClick={() =>
                            onSettle({
                              fromPersonId: suggestion.fromPersonId,
                              toPersonId: suggestion.toPersonId,
                              amount: suggestion.amount,
                            })
                          }
                        >
                          結清
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
