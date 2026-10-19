import { useEffect, useState } from 'react';
import type { LedgerSummary } from '@ledger/shared';
import { useLocation, useSearchParams } from 'react-router-dom';
import { FormError } from '../../components/FormError';
import { useCurrentUser } from '../auth/use-current-user';
import { useLedgerPeople } from '../ledger-people/use-ledger-people';
import { useLedgers } from '../ledgers/use-ledgers';
import type { SettlementPrefill } from '../transactions/TransactionWorkbench';
import { SettlementView } from './SettlementView';
import type { SettleIntent } from './settle-intent';
import { useSettlementSummary } from './use-settlements';
import styles from './SharedSettlementsView.module.css';

interface SharedSettlementsViewProps {
  settleIntent: SettleIntent | null;
}

interface ActiveSettlement {
  ledgerId: string;
  suggestionKey: string;
  prefill?: SettlementPrefill;
}

/** 借還共享分頁按帳本分組呈現結清，所有讀寫都以各組的帳本 id 為準。 */
export function SharedSettlementsView({ settleIntent }: SharedSettlementsViewProps) {
  const ledgers = useLedgers(true);
  const currentUser = useCurrentUser();
  const targetLedger = ledgers.data?.find(
    (ledger) => ledger.id === settleIntent?.ledgerId && ledger.kind === 'SHARED',
  );
  const people = useLedgerPeople(targetLedger?.id ?? null, targetLedger !== undefined);
  const targetSummary = useSettlementSummary(targetLedger?.id ?? null, targetLedger !== undefined);
  const location = useLocation();
  const [, setSearchParams] = useSearchParams();
  const [activeSettlement, setActiveSettlement] = useState<ActiveSettlement | null>(null);
  const [handledIntentKey, setHandledIntentKey] = useState<string | null>(null);

  if (settleIntent !== null && handledIntentKey !== location.key) {
    if (ledgers.isSuccess && !targetLedger) {
      setHandledIntentKey(location.key);
    } else if (
      targetLedger &&
      (targetLedger.role === 'VIEWER' || targetLedger.archivedAt !== null)
    ) {
      setHandledIntentKey(location.key);
    } else if (targetLedger && people.data && targetSummary.data) {
      setHandledIntentKey(location.key);
      const currentPerson = people.data.find((person) => person.userId === currentUser.data?.id);
      if (currentPerson) {
        const expectedFrom = settleIntent.amount > 0 ? settleIntent.personId : currentPerson.id;
        const expectedTo = settleIntent.amount > 0 ? currentPerson.id : settleIntent.personId;
        const expectedKey = `${expectedFrom}-${expectedTo}`;
        const matching = targetSummary.data.suggestions.find(
          (s) => s.fromPersonId === expectedFrom && s.toPersonId === expectedTo,
        );

        if (matching) {
          setActiveSettlement({
            ledgerId: settleIntent.ledgerId,
            suggestionKey: expectedKey,
            prefill: {
              fromPersonId: expectedFrom,
              toPersonId: expectedTo,
              amount: Math.abs(settleIntent.amount),
            },
          });
        } else if (targetSummary.data.suggestions[0]) {
          // 找不到完全相符的轉帳時，展開該帳本第一條轉帳建議
          const first = targetSummary.data.suggestions[0];
          setActiveSettlement({
            ledgerId: settleIntent.ledgerId,
            suggestionKey: `${first.fromPersonId}-${first.toPersonId}`,
            prefill: {
              fromPersonId: first.fromPersonId,
              toPersonId: first.toPersonId,
              amount: first.amount,
            },
          });
        }
      }
    }
  }

  useEffect(() => {
    if (settleIntent !== null && handledIntentKey === location.key) {
      setSearchParams((current) => current, { replace: true, state: null });
    }
  }, [handledIntentKey, location.key, setSearchParams, settleIntent]);

  if (ledgers.isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }
  if (ledgers.error) {
    return <FormError error={ledgers.error} />;
  }

  const sharedLedgers = (ledgers.data ?? []).filter((ledger) => ledger.kind === 'SHARED');
  if (sharedLedgers.length === 0) {
    return <p className={styles.status}>目前沒有共享帳本。</p>;
  }

  return (
    <div className={styles.groups}>
      {sharedLedgers.map((ledger) => (
        <SharedSettlementLedger
          key={ledger.id}
          ledger={ledger}
          activeKey={
            activeSettlement?.ledgerId === ledger.id ? activeSettlement.suggestionKey : null
          }
          externalPrefill={
            activeSettlement?.ledgerId === ledger.id ? activeSettlement.prefill : null
          }
          onToggle={(key, prefill) => {
            if (key === null) {
              setActiveSettlement(null);
            } else {
              setActiveSettlement({ ledgerId: ledger.id, suggestionKey: key, prefill });
            }
          }}
        />
      ))}
    </div>
  );
}

interface SharedSettlementLedgerProps {
  ledger: LedgerSummary;
  activeKey: string | null;
  externalPrefill?: SettlementPrefill | null;
  onToggle: (key: string | null, prefill?: SettlementPrefill) => void;
}

function SharedSettlementLedger({
  ledger,
  activeKey,
  externalPrefill,
  onToggle,
}: SharedSettlementLedgerProps) {
  return (
    <section className={styles.group} aria-labelledby={`settlement-ledger-${ledger.id}`}>
      <h2 className={styles.ledgerHeading} id={`settlement-ledger-${ledger.id}`}>
        {ledger.name}
      </h2>
      <SettlementView
        ledger={ledger}
        activeSuggestionKey={activeKey}
        onActiveSuggestionChange={onToggle}
        externalPrefill={externalPrefill}
      />
    </section>
  );
}
