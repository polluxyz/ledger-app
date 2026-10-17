import { useMemo, useState } from 'react';
import type { LedgerSummary } from '@ledger/shared';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { getAvatarLabels } from '../../lib/avatar-labels';
import { AnimatedDisclosure } from './AnimatedDisclosure';
import { DebtEntriesList } from './DebtEntriesList';
import { DebtEntryForm } from './DebtEntryForm';
import { useCounterparty, useCounterpartyEntryPages, useForgiveCounterparty } from './use-debts';
import { LedgerSourceList } from './LedgerSourceList';
import { isLedgerWritable, useLedgers } from '../ledgers/use-ledgers';
import styles from './CounterpartyDetail.module.css';

interface CounterpartyDetailProps {
  ledger: LedgerSummary;
  counterpartyId: string;
  mode: 'overview' | 'personal';
  /** 對象列已算好的頭貼字；展開區沿用它，列上與展開後才會是同一個字。 */
  counterpartyLabel?: string;
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
  counterpartyLabel,
  onEditSplit,
}: CounterpartyDetailProps) {
  const counterparty = useCounterparty(counterpartyId);
  const entries = useCounterpartyEntryPages(counterpartyId, 'outstanding');
  const ledgers = useLedgers(true);
  const forgive = useForgiveCounterparty();
  const writableLedgerIds = useMemo(
    () => new Set((ledgers.data ?? []).filter(isLedgerWritable).map((item) => item.id)),
    [ledgers.data],
  );

  const [forgiveOpen, setForgiveOpen] = useState(false);
  const [entryFormOpen, setEntryFormOpen] = useState(false);

  function closeForgive() {
    setForgiveOpen(false);
    forgive.reset();
  }

  function confirmForgive() {
    forgive.mutate({ counterpartyId, ledgerId: ledger.id }, { onSuccess: closeForgive });
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
  const entryFormId = `counterparty-entry-form-${counterpartyId}`;
  const outstandingEntries = entries.data?.pages.flatMap((page) => page.items) ?? [];
  const canWrite =
    mode === 'personal' &&
    (ledger.role === 'OWNER' || ledger.role === 'EDITOR') &&
    ledger.archivedAt === null;
  const computedLabels = getAvatarLabels([
    '我',
    person.displayName,
    ...ledgerParts.map((source) => source.personName),
  ]);
  const avatarLabels =
    counterpartyLabel === undefined
      ? computedLabels
      : new Map([...computedLabels, [person.displayName, counterpartyLabel]]);

  return (
    <div className={styles.detail}>
      <section className={styles.entries}>
        {entries.isLoading ? (
          <p className={styles.status}>載入中…</p>
        ) : entries.error ? (
          <FormError error={entries.error} />
        ) : outstandingEntries.length === 0 ? (
          <p className={styles.empty}>目前沒有未還清紀錄。</p>
        ) : (
          <DebtEntriesList
            entries={outstandingEntries}
            balance={person.balance}
            editable={mode === 'personal'}
            fallbackEditable={canWrite}
            writableLedgerIds={writableLedgerIds}
            displayName={person.displayName}
            avatarLabels={avatarLabels}
            onEditSplit={onEditSplit}
          />
        )}
        {entries.hasNextPage && (
          <div className={styles.loadMore}>
            <Button
              type="button"
              variant="secondary"
              disabled={entries.isFetchingNextPage}
              onClick={() => void entries.fetchNextPage()}
            >
              {entries.isFetchingNextPage ? '載入中…' : '載入更多'}
            </Button>
          </div>
        )}
      </section>

      {mode === 'overview' && ledgerParts.length > 0 && (
        <section className={styles.sharedLedgers}>
          <LedgerSourceList
            sources={ledgerParts}
            readOnly
            reserveActionColumn={canWrite}
            avatarLabels={avatarLabels}
          />
        </section>
      )}

      {/* 操作放在最下面靠右：先看完紀錄再決定要不要記一筆（開發者 2026-10-09）。 */}
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

      <Dialog open={forgiveOpen && canWrite} title="免除剩餘" onClose={closeForgive}>
        <div className={styles.entries}>
          <FormError error={forgive.error} />
          <div className={styles.actions}>
            <Button
              type="button"
              variant="secondary"
              disabled={forgive.isPending}
              onClick={closeForgive}
            >
              取消
            </Button>
            <Button type="button" disabled={forgive.isPending} onClick={confirmForgive}>
              {forgive.isPending ? '處理中…' : '免除'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
