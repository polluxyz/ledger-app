import { useMemo, useState } from 'react';
import type { LedgerKind, LeaveMove } from '@ledger/shared';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { TextField } from '../../components/TextField';
import confirmStyles from '../../components/ConfirmDialog.module.css';
import { LeavePreviewSections } from './LeaveItemPicker';
import { LedgerMovePickerDialog } from './LedgerMovePickerDialog';
import { LeaveLedgerDialog } from './LeaveLedgerDialog';
import {
  isLedgerWritable,
  useArchiveLedger,
  useDeleteLedgerPreview,
  useLedgers,
  useLeaveLedger,
} from './use-ledgers';
import styles from './DeleteLedgerDialog.module.css';

interface DeleteLedgerDialogProps {
  ledgerId: string;
  ledgerName: string;
  ledgerKind?: LedgerKind;
  onCancel: () => void;
  onDeleted: () => void;
  onArchived: () => void;
}

const BLOCKED_REASON = {
  LEDGER_ARCHIVED: '帳本已封存',
  LAST_OWNER: '你是最後一位擁有者，不能刪除',
  HAS_OTHER_MEMBERS: '還有其他成員，只能封存',
  HAS_OTHERS_TRANSACTIONS: '有其他成員的交易，只能封存',
} as const;

/** 共享帳本沿用 3k；私人帳本以後端預覽與分組搬移刪除。 */
export function DeleteLedgerDialog({ ledgerKind = 'PERSONAL', ...props }: DeleteLedgerDialogProps) {
  if (ledgerKind === 'SHARED') {
    return (
      <LeaveLedgerDialog
        ledgerId={props.ledgerId}
        ledgerName={props.ledgerName}
        mode="delete"
        onCancel={props.onCancel}
        onCompleted={props.onDeleted}
        onArchived={props.onArchived}
      />
    );
  }
  return <PrivateDeleteLedgerDialog {...props} />;
}

function PrivateDeleteLedgerDialog({
  ledgerId,
  ledgerName,
  onCancel,
  onDeleted,
  onArchived,
}: Omit<DeleteLedgerDialogProps, 'ledgerKind'>) {
  const [moves, setMoves] = useState<LeaveMove[]>([]);
  const [moveFlow, setMoveFlow] = useState<number | 'new' | null>(null);
  const [typedName, setTypedName] = useState('');
  const ledgers = useLedgers();
  const preview = useDeleteLedgerPreview(ledgerId, moves);
  const archive = useArchiveLedger();
  const remove = useLeaveLedger();
  const ledgerNames = useMemo(
    () => new Map((ledgers.data ?? []).map((ledger) => [ledger.id, ledger.name])),
    [ledgers.data],
  );
  const isPending = archive.isPending || remove.isPending;
  const canDelete =
    preview.data?.leave.allowed === true && typedName === ledgerName && !preview.isFetching;
  const itemNames = useMemo(
    () => new Map((preview.data?.items ?? []).map((item) => [item.id, item.title?.trim() || '—'])),
    [preview.data?.items],
  );
  const hasItems = (preview.data?.items.length ?? 0) > 0;
  const movedItemIds = useMemo(() => new Set(moves.flatMap((move) => move.itemIds)), [moves]);
  const remainingItems = (preview.data?.items ?? []).filter((item) => !movedItemIds.has(item.id));

  function confirmDelete() {
    if (!canDelete || isPending) return;
    remove.mutate(
      {
        id: ledgerId,
        deleteLedger: true,
        moves: moves.map((move) => ({
          targetLedgerId: move.targetLedgerId,
          itemIds: [...move.itemIds].sort(),
        })),
        confirm: ledgerName,
      },
      { onSuccess: onDeleted },
    );
  }

  function confirmArchive() {
    archive.mutate(ledgerId, { onSuccess: onArchived });
  }

  function finishMove(move: LeaveMove | null) {
    if (moveFlow === 'new') {
      if (move) setMoves((current) => [...current, move]);
    } else if (moveFlow !== null) {
      setMoves((current) =>
        move
          ? current.map((existing, index) => (index === moveFlow ? move : existing))
          : current.filter((_existing, index) => index !== moveFlow),
      );
    }
    setMoveFlow(null);
  }

  const activeMove = typeof moveFlow === 'number' ? moves[moveFlow] : undefined;
  const otherMoves = moves.filter((_move, index) => index !== moveFlow);
  const unavailableItemIds = new Set(otherMoves.flatMap((move) => move.itemIds));
  const selectableItems = (preview.data?.items ?? []).filter(
    (item) => !unavailableItemIds.has(item.id),
  );
  const error = remove.error ?? archive.error ?? preview.error;

  return (
    <>
      <Dialog open title={`刪除「${ledgerName}」`} onClose={onCancel}>
        <div className={styles.content}>
          {preview.isLoading && <p className={styles.status}>載入中…</p>}
          {preview.data?.leave.allowed && (
            <>
              {hasItems && moves.length > 0 && (
                <section className={styles.section} aria-labelledby="delete-ledger-moves-heading">
                  <h3 id="delete-ledger-moves-heading" className={styles.sectionTitle}>
                    搬移
                  </h3>
                  <ul className={styles.list}>
                    {moves.map((move, index) => {
                      const targetName =
                        ledgerNames.get(move.targetLedgerId) ?? move.targetLedgerId;
                      return (
                        <li key={move.targetLedgerId} className={styles.moveRow}>
                          <span className={styles.moveItems}>
                            {move.itemIds.map((itemId) => itemNames.get(itemId) ?? '—').join('、')}
                          </span>
                          <span className={styles.moveTarget}>
                            <span aria-hidden="true">→</span> {targetName}
                            <button
                              type="button"
                              className={styles.moveAction}
                              aria-label={`修改搬移到 ${targetName}`}
                              disabled={isPending}
                              onClick={() => setMoveFlow(index)}
                            >
                              <svg viewBox="0 0 16 16" aria-hidden="true">
                                <path d="M11.7 1.7a1.6 1.6 0 0 1 2.3 2.3L6 12l-3.5 1 1-3.5 8.2-7.8ZM9.8 3.6l2.6 2.6" />
                              </svg>
                              修改
                            </button>
                            <button
                              type="button"
                              className={`${styles.moveAction} ${styles.removeMove}`}
                              aria-label={`取消搬移到 ${targetName}`}
                              disabled={isPending}
                              onClick={() => {
                                setMoves((current) =>
                                  current.filter((_item, itemIndex) => itemIndex !== index),
                                );
                              }}
                            >
                              ×
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
              {(preview.data.accounts.length > 0 || preview.data.withdrawals.length > 0) && (
                <LeavePreviewSections preview={preview.data} columnHint="現在 → 刪除後" />
              )}
              {remainingItems.length > 0 && (
                <button
                  type="button"
                  className={styles.pickerLink}
                  disabled={isPending}
                  onClick={() => setMoveFlow('new')}
                >
                  搬到其他帳本 ›
                </button>
              )}
              <TextField
                label="輸入帳本名稱"
                value={typedName}
                onChange={(event) => setTypedName(event.target.value)}
                disabled={isPending}
              />
            </>
          )}
          {preview.data && !preview.data.leave.allowed && (
            <p className={styles.reason}>
              {preview.data.leave.blockedBy
                ? BLOCKED_REASON[preview.data.leave.blockedBy]
                : '只能封存'}
            </p>
          )}
          <FormError error={error ?? ledgers.error} />
          <div className={styles.actions}>
            <Button type="button" variant="secondary" disabled={isPending} onClick={onCancel}>
              取消
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={confirmArchive}>
              {archive.isPending ? '處理中…' : '封存'}
            </Button>
            {preview.data?.leave.allowed && (
              <Button
                type="button"
                className={confirmStyles.danger}
                disabled={isPending || !canDelete}
                onClick={confirmDelete}
              >
                {remove.isPending ? '處理中…' : '刪除'}
              </Button>
            )}
          </div>
        </div>
      </Dialog>
      {moveFlow !== null && preview.data && (
        <LedgerMovePickerDialog
          sourceLedgerId={ledgerId}
          items={selectableItems}
          existingMove={activeMove}
          otherMoves={otherMoves}
          ledgers={
            ledgers.data?.filter((ledger) => ledger.id !== ledgerId && isLedgerWritable(ledger)) ??
            []
          }
          ledgersError={ledgers.error}
          isLedgersLoading={ledgers.isLoading}
          onCancel={() => setMoveFlow(null)}
          onComplete={finishMove}
        />
      )}
    </>
  );
}
