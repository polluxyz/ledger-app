import { useState } from 'react';
import type { LedgerSummary } from '@ledger/shared';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FormError } from '../../components/FormError';
import { formatMoney } from '../../lib/format';
import { AnimatedDisclosure } from './AnimatedDisclosure';
import { DebtEntriesList } from './DebtEntriesList';
import { DebtEntryForm } from './DebtEntryForm';
import { useCounterparty, useCounterpartyEntries, useForgiveCounterparty } from './use-debts';
import { LedgerSourceList } from './LedgerSourceList';
import { splitDebtEntriesByBalanceZero } from './debt-entry-history';
import styles from './CounterpartyDetail.module.css';

interface CounterpartyDetailProps {
  ledger: LedgerSummary;
  counterpartyId: string;
  mode: 'overview' | 'personal';
  onEditSplit?: (splitId: string) => void;
}

/**
 * 對象列展開後的明細。
 *
 * ## 為什麼不再顯示重複的箭頭與標題（debts-tabs2）
 *
 * 外層列已經有對象名稱與借貸箭頭，展開後直接進入共享帳本來源或未還清紀錄，
 * 避免視覺重複。歷史紀錄已統整到「歷史」子分頁，明細底部不再提供歷史展開。
 */
export function CounterpartyDetail({
  ledger,
  counterpartyId,
  mode,
  onEditSplit,
}: CounterpartyDetailProps) {
  const counterparty = useCounterparty(counterpartyId);
  const entries = useCounterpartyEntries(counterpartyId, { limit: 100 });
  const forgive = useForgiveCounterparty();

  const [forgiveOpen, setForgiveOpen] = useState(false);
  const [entryFormOpen, setEntryFormOpen] = useState(false);

  function closeForgive() {
    setForgiveOpen(false);
    forgive.reset();
  }

  function confirmForgive() {
    forgive.mutate(counterpartyId, { onSuccess: closeForgive });
  }

  if (counterparty.isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }
  if (counterparty.error) {
    return <FormError error={counterparty.error} />;
  }
  if (!counterparty.data) {
    return null;
  }

  const person = counterparty.data;
  const { ledgerParts } = person;
  const sharedLedgersHeadingId = `counterparty-shared-ledgers-${counterpartyId}`;
  const entryFormId = `counterparty-entry-form-${counterpartyId}`;
  const { outstanding } = splitDebtEntriesByBalanceZero(entries.data?.items ?? []);
  const canWrite = mode === 'personal';

  return (
    <div className={styles.detail}>
      {mode === 'overview' && ledgerParts.length > 0 && (
        <section className={styles.sharedLedgers} aria-labelledby={sharedLedgersHeadingId}>
          <h4 id={sharedLedgersHeadingId}>共享帳本</h4>
          <LedgerSourceList sources={ledgerParts} readOnly />
        </section>
      )}

      {canWrite && (
        <div className={styles.actions}>
          <Button
            type="button"
            aria-expanded={entryFormOpen}
            aria-controls={entryFormId}
            onClick={() => setEntryFormOpen((open) => !open)}
          >
            記一筆
          </Button>
          {person.balance > 0 && (
            <Button type="button" variant="secondary" onClick={() => setForgiveOpen(true)}>
              免除剩餘
            </Button>
          )}
        </div>
      )}

      {canWrite && (
        <AnimatedDisclosure
          id={entryFormId}
          open={entryFormOpen}
          className={styles.entryFormDisclosure}
        >
          <DebtEntryForm
            ledger={ledger}
            initialCounterpartyName={person.displayName}
            onCancel={() => setEntryFormOpen(false)}
            onSaved={() => setEntryFormOpen(false)}
          />
        </AnimatedDisclosure>
      )}

      <section className={styles.entries}>
        {entries.isLoading ? (
          <p className={styles.status}>載入中…</p>
        ) : entries.error ? (
          <FormError error={entries.error} />
        ) : outstanding.length === 0 ? (
          <p className={styles.empty}>目前沒有未還清紀錄。</p>
        ) : (
          <DebtEntriesList
            entries={outstanding}
            editable={canWrite}
            displayName={person.displayName}
            onEditSplit={onEditSplit}
          />
        )}
      </section>

      <ConfirmDialog
        open={forgiveOpen}
        title="免除剩餘"
        message={`${person.displayName}欠你的 ${formatMoney(person.balance)} 將歸零`}
        confirmLabel="免除"
        error={forgive.error}
        isPending={forgive.isPending}
        onConfirm={confirmForgive}
        onCancel={closeForgive}
      />
    </div>
  );
}
