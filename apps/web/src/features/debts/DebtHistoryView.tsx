import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { Counterparty, LedgerSummary, Paginated, Transaction } from '@ledger/shared';
import { FormError } from '../../components/FormError';
import { apiRequest } from '../../lib/api-client';
import { useLedgers } from '../ledgers/use-ledgers';
import { TransactionList } from '../transactions/TransactionList';
import { transactionsKey } from '../transactions/use-transactions';
import { AnimatedDisclosure } from './AnimatedDisclosure';
import { DebtEntriesList } from './DebtEntriesList';
import { splitDebtEntriesByBalanceZero } from './debt-entry-history';
import { useCounterparties, useCounterpartyEntries } from './use-debts';
import styles from './DebtHistoryView.module.css';

interface DebtHistoryViewProps {
  ledger: LedgerSummary;
  onEditSplit: (splitId: string) => void;
}

/**
 * 借還歷史子分頁（debts-tabs2）。
 *
 * ## 為什麼將歷史統一至獨立分頁
 *
 * 原先散落在各個對象展開明細與共享帳本組底部的歷史按鈕，集中在此處分段管理。
 * - 個人往來：列出所有有往來紀錄的對象（點擊展開已歸零／還清的紀錄，可修改、刪除）。
 * - 共享帳本：列出有已記結清的共享帳本（點擊展開唯讀交易清單）。
 * 某段無資料時隱藏，兩段皆無資料時呈現「沒有歷史紀錄」。
 */
export function DebtHistoryView({ onEditSplit }: DebtHistoryViewProps) {
  const counterparties = useCounterparties({ limit: 100 });
  const ledgers = useLedgers(true);
  const [expandedPersonId, setExpandedPersonId] = useState<string | null>(null);
  const [expandedLedgerId, setExpandedLedgerId] = useState<string | null>(null);

  const sharedLedgers = useMemo(
    () => (ledgers.data ?? []).filter((l) => l.kind === 'SHARED'),
    [ledgers.data],
  );

  const sharedTransferQueries = useQueries({
    queries: sharedLedgers.map((l) => ({
      queryKey: [...transactionsKey(l.id), { type: 'TRANSFER' as const, limit: 100 }],
      queryFn: () =>
        apiRequest<Paginated<Transaction>>(`/ledgers/${l.id}/transactions?type=TRANSFER&limit=100`),
    })),
  });

  const settledSharedLedgers = useMemo(() => {
    return sharedLedgers
      .map((ledger, index) => {
        const query = sharedTransferQueries[index];
        const settlements = (query?.data?.items ?? []).filter((item) => Boolean(item.settlement));
        return {
          ledger,
          settlements,
          isLoading: query?.isLoading ?? false,
        };
      })
      .filter((item) => item.settlements.length > 0);
  }, [sharedLedgers, sharedTransferQueries]);

  const isLoading =
    counterparties.isLoading || ledgers.isLoading || sharedTransferQueries.some((q) => q.isLoading);

  if (isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }

  const counterpartyItems = counterparties.data?.items ?? [];
  const hasPersonal = counterpartyItems.length > 0;
  const hasShared = settledSharedLedgers.length > 0;

  if (!hasPersonal && !hasShared) {
    return <p className={styles.empty}>沒有歷史紀錄。</p>;
  }

  return (
    <div className={styles.view}>
      {counterparties.error && <FormError error={counterparties.error} />}
      {ledgers.error && <FormError error={ledgers.error} />}

      {hasPersonal && (
        <section className={styles.section} aria-labelledby="debt-history-personal-heading">
          <h3 id="debt-history-personal-heading" className={styles.heading}>
            個人往來
          </h3>
          <ul className={styles.list}>
            {counterpartyItems.map((person) => {
              const expanded = expandedPersonId === person.id;
              const detailsId = `history-person-${person.id}`;

              return (
                <li key={person.id} className={styles.item}>
                  <button
                    type="button"
                    className={styles.row}
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                    onClick={() => setExpandedPersonId(expanded ? null : person.id)}
                  >
                    <span className={styles.name}>{person.displayName}</span>
                  </button>
                  <AnimatedDisclosure id={detailsId} open={expanded}>
                    <PersonHistoryDetail person={person} onEditSplit={onEditSplit} />
                  </AnimatedDisclosure>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {hasShared && (
        <section className={styles.section} aria-labelledby="debt-history-shared-heading">
          <h3 id="debt-history-shared-heading" className={styles.heading}>
            共享帳本
          </h3>
          <ul className={styles.list}>
            {settledSharedLedgers.map(({ ledger: sharedLedger, settlements }) => {
              const expanded = expandedLedgerId === sharedLedger.id;
              const detailsId = `history-ledger-${sharedLedger.id}`;

              return (
                <li key={sharedLedger.id} className={styles.item}>
                  <button
                    type="button"
                    className={styles.row}
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                    onClick={() => setExpandedLedgerId(expanded ? null : sharedLedger.id)}
                  >
                    <span className={styles.name}>{sharedLedger.name}</span>
                  </button>
                  <AnimatedDisclosure id={detailsId} open={expanded}>
                    <div className={styles.ledgerHistoryList}>
                      <TransactionList
                        transactions={settlements}
                        isLoading={false}
                        error={null}
                        readOnly
                        emptyMessage="沒有歷史紀錄。"
                        onEdit={() => undefined}
                      />
                    </div>
                  </AnimatedDisclosure>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function PersonHistoryDetail({
  person,
  onEditSplit,
}: {
  person: Counterparty;
  onEditSplit: (splitId: string) => void;
}) {
  const entries = useCounterpartyEntries(person.id, { limit: 100 });
  const { history } = splitDebtEntriesByBalanceZero(entries.data?.items ?? []);

  if (entries.isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }
  if (entries.error) {
    return <FormError error={entries.error} />;
  }
  if (history.length === 0) {
    return <p className={styles.empty}>沒有歷史紀錄。</p>;
  }

  return (
    <div className={styles.personHistoryDetail}>
      <DebtEntriesList
        entries={history}
        displayName={person.displayName}
        editable
        onEditSplit={onEditSplit}
      />
    </div>
  );
}
