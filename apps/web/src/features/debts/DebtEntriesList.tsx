import { useState } from 'react';
import type { DebtEntry, DebtEntryKind } from '@ledger/shared';
import { Check } from 'lucide-react';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { formatDate, formatMoney } from '../../lib/format';
import { DebtEntryEditDialog } from './DebtEntryEditDialog';
import { getDebtEntryFlow } from './entry-flow';
import { MiniFlowArrow } from './MiniFlowArrow';
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
 * 與分帳入口。統一用方向符號、金額和同步狀態，讓使用者不用再解讀動詞與正負號。
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
          const flow = getDebtEntryFlow(entry, displayName);
          const from = flow.direction === 'toThem' ? '我' : displayName;
          const to = flow.direction === 'toThem' ? displayName : '我';

          return (
            <li
              key={entry.id}
              className={styles.entry}
              aria-label={flow.description}
              title={flow.description}
            >
              <div className={styles.entryInfo}>
                <div className={styles.entryLine}>
                  {/* 同一頁都是同年往來，日期只留 MM/DD，年份沒有資訊量。 */}
                  <time dateTime={entry.date}>{formatDate(entry.date).slice(5)}</time>
                  {flow.marker === 'check' ? (
                    <span className={styles.adjustmentIcon} aria-hidden="true">
                      <Check size={14} strokeWidth={2.5} />
                    </span>
                  ) : (
                    flow.direction !== null && (
                      <MiniFlowArrow from={from} to={to} variant="flow" marker={flow.marker} />
                    )
                  )}
                  {entry.note && <span className={styles.note}>{entry.note}</span>}
                </div>
                <div className={styles.entryAmount}>
                  {isUnrecorded && <span className={styles.unrecorded}>未記帳</span>}
                  {SYNC_STATUS_LABELS[entry.sync] && (
                    <span className={`${styles.syncLabel} ${styles[entry.sync.toLowerCase()]}`}>
                      {SYNC_STATUS_LABELS[entry.sync]}
                    </span>
                  )}
                  <span className={styles.delta}>{formatMoney(Math.abs(entry.delta))}</span>
                </div>
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
