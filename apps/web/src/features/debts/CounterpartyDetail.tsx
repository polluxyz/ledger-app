import { useState } from 'react';
import type { DebtEntry, DebtEntryKind, LedgerSummary } from '@ledger/shared';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Dialog } from '../../components/Dialog';
import { DebtArrow } from '../../components/DebtArrow';
import { FormError } from '../../components/FormError';
import { formatDate, formatMoney } from '../../lib/format';
import { AnimatedDisclosure } from './AnimatedDisclosure';
import { DebtEntryForm } from './DebtEntryForm';
import {
  useCounterparty,
  useCounterpartyEntries,
  useDeleteDebtEntry,
  useForgiveCounterparty,
} from './use-debts';
import { LedgerSourceList } from './LedgerSourceList';
import { DebtEntryEditDialog } from './DebtEntryEditDialog';
import { splitDebtEntriesByBalanceZero } from './debt-entry-history';
import styles from './CounterpartyDetail.module.css';

interface CounterpartyDetailProps {
  ledger: LedgerSummary;
  counterpartyId: string;
  mode: 'overview' | 'personal';
  onEditSplit?: (splitId: string) => void;
}

/**
 * 對象列展開後顯示 API 餘額與往來紀錄；個人分頁才顯示可寫入的操作。
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
  const removeEntry = useDeleteDebtEntry();

  const [forgiveOpen, setForgiveOpen] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState<DebtEntry | null>(null);
  const [entryToEdit, setEntryToEdit] = useState<DebtEntry | null>(null);
  const [entryFormOpen, setEntryFormOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  function closeForgive() {
    setForgiveOpen(false);
    forgive.reset();
  }

  function confirmForgive() {
    forgive.mutate(counterpartyId, { onSuccess: closeForgive });
  }

  function closeEntryDelete() {
    setEntryToDelete(null);
    removeEntry.reset();
  }

  function confirmEntryDelete() {
    if (!entryToDelete) {
      return;
    }
    removeEntry.mutate(entryToDelete.id, { onSuccess: closeEntryDelete });
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
  const entriesHeadingId = `counterparty-entries-${counterpartyId}`;
  const entryFormId = `counterparty-entry-form-${counterpartyId}`;
  const historyId = `counterparty-history-${counterpartyId}`;
  const { outstanding, history } = splitDebtEntriesByBalanceZero(entries.data?.items ?? []);
  const canWrite = mode === 'personal';

  function renderEntryList(items: readonly DebtEntry[], editable: boolean) {
    return (
      <ul className={styles.entryList}>
        {items.map((entry) => {
          const isAdjustment = ADJUSTMENT_KINDS.has(entry.kind);
          const canEdit = editable && !isAdjustment && entry.splitId === null;
          const isUnrecorded = entry.transactionId === null && !isAdjustment;
          return (
            <li key={entry.id} className={styles.entry}>
              <div className={styles.entryInfo}>
                <div className={styles.entryLine}>
                  <time dateTime={entry.date}>{formatDate(entry.date)}</time>
                  <span className={styles.kind}>{ENTRY_KIND_LABELS[entry.kind]}</span>
                  <span className={styles.delta}>{formatDelta(entry.delta)}</span>
                </div>
                <div className={styles.entryLine}>
                  {entry.balanceAfter !== undefined && (
                    <span className={styles.balanceAfter}>
                      {formatBalanceAfter(entry.balanceAfter)}
                    </span>
                  )}
                  {isUnrecorded && <span className={styles.unrecorded}>未記帳</span>}
                  {SYNC_STATUS_LABELS[entry.sync] && (
                    <span className={`${styles.syncLabel} ${styles[entry.sync.toLowerCase()]}`}>
                      {SYNC_STATUS_LABELS[entry.sync]}
                    </span>
                  )}
                </div>
                {entry.note && <p className={styles.note}>{entry.note}</p>}
              </div>
              {editable && (
                <div className={styles.entryActions}>
                  {entry.splitId !== null ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => onEditSplit?.(entry.splitId!)}
                    >
                      分帳
                    </Button>
                  ) : (
                    canEdit && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setEntryToEdit(entry)}
                      >
                        修改
                      </Button>
                    )
                  )}
                  {entry.splitId === null && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setEntryToDelete(entry)}
                    >
                      刪除
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className={styles.detail}>
      <p className={styles.balance}>
        {formatCounterpartyBalance(person.displayName, person.balance)}
      </p>

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

      <section className={styles.entries} aria-labelledby={entriesHeadingId}>
        <h4 id={entriesHeadingId}>往來紀錄</h4>
        {entries.isLoading ? (
          <p className={styles.status}>載入中…</p>
        ) : entries.error ? (
          <FormError error={entries.error} />
        ) : outstanding.length === 0 ? (
          <p className={styles.empty}>目前沒有未還清紀錄。</p>
        ) : (
          renderEntryList(outstanding, canWrite)
        )}
      </section>

      {history.length > 0 && (
        <section className={styles.history}>
          <Button
            type="button"
            variant="secondary"
            aria-expanded={historyOpen}
            aria-controls={historyId}
            onClick={() => setHistoryOpen((open) => !open)}
          >
            歷史
          </Button>
          <AnimatedDisclosure id={historyId} open={historyOpen}>
            {renderEntryList(history, canWrite)}
          </AnimatedDisclosure>
        </section>
      )}

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
      <ConfirmDialog
        open={entryToDelete !== null && !entryToDelete.paired}
        title="刪除往來紀錄"
        message={DELETE_ENTRY_MESSAGE}
        confirmLabel="刪除"
        error={removeEntry.error}
        isPending={removeEntry.isPending}
        onConfirm={confirmEntryDelete}
        onCancel={closeEntryDelete}
      />
      <Dialog open={entryToDelete?.paired === true} title="刪除往來紀錄" onClose={closeEntryDelete}>
        <div className={styles.confirmContent}>
          <FormError error={removeEntry.error} />
          <p>{DELETE_ENTRY_MESSAGE}</p>
          <p>會請{person.displayName}也刪除</p>
          <div className={styles.dialogActions}>
            <Button
              type="button"
              variant="secondary"
              disabled={removeEntry.isPending}
              onClick={closeEntryDelete}
            >
              取消
            </Button>
            <Button type="button" disabled={removeEntry.isPending} onClick={confirmEntryDelete}>
              刪除
            </Button>
          </div>
        </div>
      </Dialog>
      <DebtEntryEditDialog
        entry={entryToEdit}
        displayName={person.displayName}
        onClose={() => setEntryToEdit(null)}
      />
    </div>
  );
}

/** 系統算出的調整紀錄：不產生交易、不能改金額（API 會回 409 `DEBT_ENTRY_NOT_EDITABLE`）。 */
const ADJUSTMENT_KINDS: ReadonlySet<DebtEntryKind> = new Set(['SETTLEMENT', 'FORGIVE', 'FORGIVEN']);

const DELETE_ENTRY_MESSAGE =
  '刪除這筆往來？對應的交易會一起刪除，帳戶餘額與往來餘額會回到記這筆之前。';

const SYNC_STATUS_LABELS = {
  NONE: '',
  PENDING: '等對方確認',
  SYNCED: '已同步',
  DECLINED: '對方未接受',
} as const;

const ENTRY_KIND_LABELS: Record<DebtEntryKind, string> = {
  LEND: '借出',
  BORROW: '借入',
  COLLECT: '對方還我',
  REPAY: '我還對方',
  PAID_FOR_ME: '幫我付',
  PAID_FOR_THEM: '我幫對方付',
  RECEIVED_FOR_THEM: '我幫對方代收',
  RECEIVED_FOR_ME: '對方幫我代收',
  SETTLEMENT: '結清差額',
  FORGIVE: '免除',
  // 3b-2：接受對方的免除時寫入。畫面在 3b-2 的畫面步驟才會出現這種紀錄。
  FORGIVEN: '被免除',
};

/** 往來餘額方向來自 API 的正負號，視覺呈現統一交給 DebtArrow。 */
function formatCounterpartyBalance(displayName: string, balance: number) {
  if (balance > 0) {
    return (
      <DebtArrow
        from={displayName}
        to="我"
        amount={balance}
        label="需要支付"
        srText={`${displayName}欠你 ${formatMoney(balance)}`}
      />
    );
  }
  if (balance < 0) {
    return (
      <DebtArrow
        from="我"
        to={displayName}
        amount={Math.abs(balance)}
        label="需要支付"
        srText={`你欠${displayName} ${formatMoney(Math.abs(balance))}`}
      />
    );
  }
  return '兩清';
}

/** 往來紀錄的正負號直接呈現 delta，不把它換算成另一種帳務意義。 */
function formatDelta(delta: number): string {
  return delta > 0 ? `+${formatMoney(delta)}` : `−${formatMoney(Math.abs(delta))}`;
}

/** 累計餘額來自 API 的 balanceAfter，負數用清楚可見的數學負號。 */
function formatBalanceAfter(balanceAfter: number): string {
  if (balanceAfter < 0) {
    return `餘額 −${formatMoney(Math.abs(balanceAfter))}`;
  }
  return `餘額 ${formatMoney(balanceAfter)}`;
}
