import { useEffect, useRef, useState } from 'react';
import type { LedgerSummary } from '@ledger/shared';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormError';
import { useCurrentUser } from '../auth/use-current-user';
import { AnimatedDisclosure } from '../debts/AnimatedDisclosure';
import { useLedgerPeople } from '../ledger-people/use-ledger-people';
import { useLedgers } from '../ledgers/use-ledgers';
import { TransactionList } from '../transactions/TransactionList';
import type { SettlementPrefill } from '../transactions/TransactionWorkbench';
import { useTransactions } from '../transactions/use-transactions';
import { SettlementForm } from './SettlementForm';
import { SettlementView } from './SettlementView';
import type { SettleIntent } from './settle-intent';
import styles from './SharedSettlementsView.module.css';

interface SharedSettlementsViewProps {
  settleIntent: SettleIntent | null;
}

interface ActiveSettlementForm {
  ledgerId: string;
  prefill?: SettlementPrefill;
  instance: number;
}

/** 借還共享分頁按帳本分組呈現結清，所有讀寫都以各組的帳本 id 為準。 */
export function SharedSettlementsView({ settleIntent }: SharedSettlementsViewProps) {
  const ledgers = useLedgers(true);
  const currentUser = useCurrentUser();
  const targetLedger = ledgers.data?.find(
    (ledger) => ledger.id === settleIntent?.ledgerId && ledger.kind === 'SHARED',
  );
  const people = useLedgerPeople(targetLedger?.id ?? null, targetLedger !== undefined);
  const location = useLocation();
  const [, setSearchParams] = useSearchParams();
  const handledIntentLocation = useRef<string | null>(null);
  const nextFormInstance = useRef(0);
  const [activeForm, setActiveForm] = useState<ActiveSettlementForm | null>(null);
  const [historyOpenLedgerId, setHistoryOpenLedgerId] = useState<string | null>(null);

  useEffect(() => {
    if (settleIntent === null || handledIntentLocation.current === location.key) {
      return;
    }
    if (
      ledgers.isLoading ||
      (ledgers.isFetching && !targetLedger) ||
      currentUser.isLoading ||
      (targetLedger && people.isLoading)
    ) {
      return;
    }

    handledIntentLocation.current = location.key;

    const currentPerson = people.data?.find((person) => person.userId === currentUser.data?.id);
    if (
      targetLedger &&
      targetLedger.role !== 'VIEWER' &&
      targetLedger.archivedAt === null &&
      currentPerson
    ) {
      const prefill: SettlementPrefill = {
        fromPersonId: settleIntent.amount > 0 ? settleIntent.personId : currentPerson.id,
        toPersonId: settleIntent.amount > 0 ? currentPerson.id : settleIntent.personId,
        amount: Math.abs(settleIntent.amount),
      };
      nextFormInstance.current += 1;
      setActiveForm({
        ledgerId: settleIntent.ledgerId,
        prefill,
        instance: nextFormInstance.current,
      });
      setHistoryOpenLedgerId(null);
    }

    setSearchParams((current) => current, { replace: true, state: null });
  }, [
    currentUser.data?.id,
    currentUser.isLoading,
    location.key,
    ledgers.isLoading,
    ledgers.isFetching,
    people.data,
    people.isLoading,
    setSearchParams,
    settleIntent,
    targetLedger,
  ]);

  function openForm(ledgerId: string, prefill?: SettlementPrefill) {
    nextFormInstance.current += 1;
    setActiveForm(
      prefill
        ? { ledgerId, prefill, instance: nextFormInstance.current }
        : { ledgerId, instance: nextFormInstance.current },
    );
    setHistoryOpenLedgerId(null);
  }

  function closeForm() {
    setActiveForm(null);
  }

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
          activeForm={activeForm?.ledgerId === ledger.id ? activeForm : null}
          historyOpen={historyOpenLedgerId === ledger.id}
          onOpenForm={(prefill) => openForm(ledger.id, prefill)}
          onCloseForm={closeForm}
          onToggleHistory={() =>
            setHistoryOpenLedgerId((current) => (current === ledger.id ? null : ledger.id))
          }
        />
      ))}
    </div>
  );
}

interface SharedSettlementLedgerProps {
  ledger: LedgerSummary;
  activeForm: ActiveSettlementForm | null;
  historyOpen: boolean;
  onOpenForm: (prefill?: SettlementPrefill) => void;
  onCloseForm: () => void;
  onToggleHistory: () => void;
}

function SharedSettlementLedger({
  ledger,
  activeForm,
  historyOpen,
  onOpenForm,
  onCloseForm,
  onToggleHistory,
}: SharedSettlementLedgerProps) {
  const transactions = useTransactions(ledger.id, { type: 'TRANSFER', limit: 100 });
  const historyId = `settlement-history-${ledger.id}`;
  const formId = `settlement-form-${ledger.id}`;
  const canCreate = ledger.role !== 'VIEWER' && ledger.archivedAt === null;
  const history = (transactions.data?.items ?? []).filter((transaction) => transaction.settlement);

  return (
    <section className={styles.group} aria-labelledby={`settlement-ledger-${ledger.id}`}>
      <h2 className={styles.ledgerHeading} id={`settlement-ledger-${ledger.id}`}>
        {ledger.name}
      </h2>
      <SettlementView ledger={ledger} onSettle={onOpenForm} />
      {canCreate && (
        <div className={styles.addAction}>
          <Button type="button" onClick={() => onOpenForm()}>
            新增結清
          </Button>
        </div>
      )}
      <AnimatedDisclosure id={formId} open={activeForm !== null} className={styles.formDisclosure}>
        {activeForm && (
          <div className={styles.form}>
            <SettlementForm
              key={activeForm.instance}
              ledger={ledger}
              prefill={activeForm.prefill}
              onSaved={onCloseForm}
              onDeleted={onCloseForm}
            />
            <div className={styles.formActions}>
              <Button type="button" variant="secondary" onClick={onCloseForm}>
                取消
              </Button>
            </div>
          </div>
        )}
      </AnimatedDisclosure>
      <section className={styles.history} aria-labelledby={`${historyId}-heading`}>
        <Button
          type="button"
          variant="secondary"
          id={`${historyId}-heading`}
          aria-expanded={historyOpen}
          aria-controls={historyId}
          onClick={onToggleHistory}
        >
          歷史
        </Button>
        <AnimatedDisclosure id={historyId} open={historyOpen}>
          <TransactionList
            transactions={history}
            isLoading={transactions.isLoading}
            error={transactions.error}
            emptyMessage="沒有歷史。"
            readOnly
            onEdit={() => undefined}
          />
        </AnimatedDisclosure>
      </section>
    </section>
  );
}
