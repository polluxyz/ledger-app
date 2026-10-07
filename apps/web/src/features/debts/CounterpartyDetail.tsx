import { useState } from 'react';
import type { CounterpartyLedgerPart, DebtEntry, DebtEntryKind } from '@ledger/shared';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Dialog } from '../../components/Dialog';
import { DebtArrow } from '../../components/DebtArrow';
import { FormError } from '../../components/FormError';
import { Pagination } from '../../components/Pagination';
import { formatDate, formatMoney } from '../../lib/format';
import { useOpenSettleIntent } from '../settlements/settle-intent';
import {
  useCounterparty,
  useCounterpartyEntries,
  useDeleteDebtEntry,
  useForgiveCounterparty,
} from './use-debts';
import { LedgerSourceList } from './LedgerSourceList';
import { DebtEntryEditDialog } from './DebtEntryEditDialog';
import styles from './CounterpartyDetail.module.css';

interface CounterpartyDetailProps {
  counterpartyId: string;
  /** 記往來仍由新增表單負責；這裡只提供對象名字給交易頁。 */
  onRecordEntry: (name: string) => void;
  onEditSplit?: (splitId: string) => void;
}

/**
 * 交易頁的往來帳只留帳（spec 修訂 2 W55）：名字＋連動標記、餘額、記一筆、免除剩餘
 * 與往來紀錄（含修改、刪除）。改名、暱稱、合併、解除連動與刪除對象屬於對象頁的
 * 「對象」面板（`CounterpartyProfile`），這裡不再出現。餘額與逐筆紀錄全部來自 API，
 * 寫入交給資料層 hooks。
 */
export function CounterpartyDetail({
  counterpartyId,
  onRecordEntry,
  onEditSplit,
}: CounterpartyDetailProps) {
  const [page, setPage] = useState(1);
  const counterparty = useCounterparty(counterpartyId);
  const entries = useCounterpartyEntries(counterpartyId, { page, limit: 20 });
  const forgive = useForgiveCounterparty();
  const removeEntry = useDeleteDebtEntry();
  const openSettleIntent = useOpenSettleIntent();
  const navigate = useNavigate();

  const [forgiveOpen, setForgiveOpen] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState<DebtEntry | null>(null);
  const [entryToEdit, setEntryToEdit] = useState<DebtEntry | null>(null);

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

  function handleOpenLedgerSource(source: CounterpartyLedgerPart) {
    if (source.left) {
      void navigate(`/ledgers/${source.ledgerId}/history`);
      return;
    }
    openSettleIntent({
      ledgerId: source.ledgerId,
      personId: source.personId,
      amount: source.amount,
    });
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

  return (
    <div className={styles.detail}>
      <header className={styles.heading}>
        <div className={styles.titleRow}>
          <h3>{person.displayName}</h3>
          {person.link && <span className={styles.linkBadge}>連動</span>}
        </div>
      </header>

      <p className={styles.balance}>
        {formatCounterpartyBalance(person.displayName, person.balance)}
      </p>

      {ledgerParts.length > 0 && (
        <section
          className={styles.sharedLedgers}
          aria-labelledby="counterparty-shared-ledgers-heading"
        >
          <h4 id="counterparty-shared-ledgers-heading">共享帳本</h4>
          <LedgerSourceList sources={ledgerParts} onOpenSource={handleOpenLedgerSource} />
        </section>
      )}

      <div className={styles.actions}>
        <Button type="button" onClick={() => onRecordEntry(person.displayName)}>
          記一筆
        </Button>
        {person.balance > 0 && (
          <Button type="button" variant="secondary" onClick={() => setForgiveOpen(true)}>
            免除剩餘
          </Button>
        )}
      </div>

      <section className={styles.entries} aria-labelledby="counterparty-entries-heading">
        <h4 id="counterparty-entries-heading">往來紀錄</h4>
        {entries.isLoading ? (
          <p className={styles.status}>載入中…</p>
        ) : entries.error ? (
          <FormError error={entries.error} />
        ) : entries.data?.items.length === 0 ? (
          <p className={styles.empty}>還沒有往來紀錄。</p>
        ) : (
          <>
            <ul className={styles.entryList}>
              {entries.data?.items.map((entry) => {
                const isAdjustment = ADJUSTMENT_KINDS.has(entry.kind);
                const canEdit = !isAdjustment && entry.splitId === null;
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
                          <span
                            className={`${styles.syncLabel} ${styles[entry.sync.toLowerCase()]}`}
                          >
                            {SYNC_STATUS_LABELS[entry.sync]}
                          </span>
                        )}
                      </div>
                      {entry.note && <p className={styles.note}>{entry.note}</p>}
                    </div>
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
                  </li>
                );
              })}
            </ul>
            {entries.data && (
              <Pagination
                page={entries.data.page}
                limit={entries.data.limit}
                total={entries.data.total}
                onChange={setPage}
              />
            )}
          </>
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
