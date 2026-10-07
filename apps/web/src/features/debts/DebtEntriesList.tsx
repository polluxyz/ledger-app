import { useState } from 'react';
import type { DebtEntry, DebtEntryKind } from '@ledger/shared';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { formatDate, formatMoney } from '../../lib/format';
import { DebtEntryEditDialog } from './DebtEntryEditDialog';
import { useDeleteDebtEntry } from './use-debts';
import styles from './DebtEntriesList.module.css';

interface DebtEntriesListProps {
  entries: readonly DebtEntry[];
  displayName: string;
  editable?: boolean;
  onEditSplit?: (splitId: string) => void;
}

/**
 * 往來紀錄清單。
 *
 * ## 為什麼把清單與刪除／修改對話框抽成獨立元件
 *
 * 個人分頁展開明細與歷史分頁的「個人往來」都要呈現往來紀錄，並提供修改、刪除
 * 與分帳入口。將渲染邏輯集中在此，確保兩處欄位格式（delta、累計餘額、連動狀態）
 * 與操作回饋完全一致。
 */
export function DebtEntriesList({
  entries,
  displayName,
  editable = true,
  onEditSplit,
}: DebtEntriesListProps) {
  const removeEntry = useDeleteDebtEntry();
  const [entryToDelete, setEntryToDelete] = useState<DebtEntry | null>(null);
  const [entryToEdit, setEntryToEdit] = useState<DebtEntry | null>(null);

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

  return (
    <>
      <ul className={styles.entryList}>
        {entries.map((entry) => {
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
          <p>會請{displayName}也刪除</p>
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
        displayName={displayName}
        onClose={() => setEntryToEdit(null)}
      />
    </>
  );
}

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
  FORGIVEN: '被免除',
};

function formatDelta(delta: number): string {
  return delta > 0 ? `+${formatMoney(delta)}` : `−${formatMoney(Math.abs(delta))}`;
}

function formatBalanceAfter(balanceAfter: number): string {
  if (balanceAfter < 0) {
    return `餘額 −${formatMoney(Math.abs(balanceAfter))}`;
  }
  return `餘額 ${formatMoney(balanceAfter)}`;
}
