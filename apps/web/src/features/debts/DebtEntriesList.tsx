import { useEffect, useRef, useState } from 'react';
import type { DebtEntry, DebtEntryKind } from '@ledger/shared';
import { Check, MoreHorizontal } from 'lucide-react';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { formatDate, formatMoney } from '../../lib/format';
import { useDeleteSplit } from '../transactions/use-splits';
import { DebtEntryEditDialog } from './DebtEntryEditDialog';
import { getDebtEntryFlow } from './entry-flow';
import { MiniOweArrow } from './MiniOweArrow';
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
 * 列右邊的操作收進「⋯」選單（2026-10-08）：一列只剩一顆按鈕，分帳紀錄的修改、
 * 刪除也從這裡走分帳的編輯面板與刪除流程。
 */
export function DebtEntriesList({
  entries,
  displayName,
  editable = true,
  onEditSplit,
}: DebtEntriesListProps) {
  const removeEntry = useDeleteDebtEntry();
  const removeSplit = useDeleteSplit();
  const [entryToDelete, setEntryToDelete] = useState<DebtEntry | null>(null);
  const [entryToEdit, setEntryToEdit] = useState<DebtEntry | null>(null);
  const [splitToDelete, setSplitToDelete] = useState<DebtEntry | null>(null);

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

  function closeSplitDelete() {
    setSplitToDelete(null);
    removeSplit.reset();
  }

  function confirmSplitDelete() {
    if (!splitToDelete?.splitId) {
      return;
    }
    removeSplit.mutate(splitToDelete.splitId, { onSuccess: closeSplitDelete });
  }

  return (
    <>
      <ul className={styles.entryList}>
        {entries.map((entry) => {
          const isAdjustment = ADJUSTMENT_KINDS.has(entry.kind);
          const isUnrecorded = entry.transactionId === null && !isAdjustment;
          const flow = getDebtEntryFlow(entry, displayName);
          const from = flow.direction === 'iOweThem' ? '我' : displayName;
          const to = flow.direction === 'iOweThem' ? displayName : '我';

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
                      <MiniOweArrow from={from} to={to} repay={flow.marker === 'repay'} />
                    )
                  )}
                  {entry.note && <span className={styles.note}>{entry.note}</span>}
                </div>
                <div className={styles.entryAmount}>
                  {entry.splitId !== null && <span className={styles.splitBadge}>分帳</span>}
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
                <EntryMenu
                  hasEdit={!isAdjustment}
                  onEdit={() => {
                    if (entry.splitId !== null) {
                      onEditSplit?.(entry.splitId);
                    } else {
                      setEntryToEdit(entry);
                    }
                  }}
                  onDelete={() => {
                    if (entry.splitId !== null) {
                      setSplitToDelete(entry);
                    } else {
                      setEntryToDelete(entry);
                    }
                  }}
                />
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
      {/*
       * 分帳紀錄的刪除走分帳端點；確認文字比照分帳編輯面板的刪除確認——
       * 這筆已同步就提醒會送對方確認，其餘只問「刪除分帳？」。
       */}
      <ConfirmDialog
        open={splitToDelete !== null}
        title="刪除分帳"
        message={splitToDelete?.sync === 'SYNCED' ? '刪除後會送給對方確認。' : '刪除分帳？'}
        confirmLabel="刪除"
        error={removeSplit.error}
        isPending={removeSplit.isPending}
        onConfirm={confirmSplitDelete}
        onCancel={closeSplitDelete}
      />
      <DebtEntryEditDialog
        entry={entryToEdit}
        displayName={displayName}
        onClose={() => setEntryToEdit(null)}
      />
    </>
  );
}

/**
 * 每列的「⋯」選單：開著時才掛全域監聽，選單外按下或按 Esc 就收起，焦點回到
 * 「⋯」讓鍵盤使用者接得上。項目只有修改與刪除，由呼叫端決定各自做什麼。
 */
function EntryMenu({
  hasEdit,
  onEdit,
  onDelete,
}: {
  hasEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function choose(action: () => void) {
    setOpen(false);
    buttonRef.current?.focus();
    action();
  }

  return (
    <div className={styles.menuWrap} ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.menuButton}
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={18} strokeWidth={2} />
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          {hasEdit && (
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => choose(onEdit)}
            >
              修改
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => choose(onDelete)}
          >
            刪除
          </button>
        </div>
      )}
    </div>
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
