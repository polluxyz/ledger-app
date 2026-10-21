import { useId, useState } from 'react';
import type { LedgerLeaveItem, LedgerSummary, LeaveMove } from '@ledger/shared';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { LeaveItemPicker } from './LeaveItemPicker';
import { isLedgerWritable } from './use-ledgers';
import styles from './LedgerMovePickerDialog.module.css';

interface LedgerMovePickerDialogProps {
  sourceLedgerId: string;
  items: readonly LedgerLeaveItem[];
  existingMove?: LeaveMove;
  otherMoves: readonly LeaveMove[];
  ledgers: readonly LedgerSummary[];
  ledgersError: unknown;
  isLedgersLoading: boolean;
  onCancel: () => void;
  onComplete: (move: LeaveMove | null) => void;
}

/** 私人帳本搬移流程：先選未搬的項目，再選一本可記帳的目標帳本。 */
export function LedgerMovePickerDialog({
  sourceLedgerId,
  items,
  existingMove,
  otherMoves,
  ledgers,
  ledgersError,
  isLedgersLoading,
  onCancel,
  onComplete,
}: LedgerMovePickerDialogProps) {
  const [step, setStep] = useState<'items' | 'ledger'>('items');
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>(
    existingMove ? [...existingMove.itemIds] : [],
  );
  const [selectedTargetLedgerId, setSelectedTargetLedgerId] = useState<string | null>(
    existingMove?.targetLedgerId ?? null,
  );
  const radioGroupId = useId();
  const usedLedgerIds = new Set(otherMoves.map((move) => move.targetLedgerId));
  const eligibleLedgers = ledgers.filter(
    (ledger) => ledger.id !== sourceLedgerId && isLedgerWritable(ledger),
  );

  function continueToLedger() {
    if (selectedItemIds.length === 0) {
      onComplete(null);
      return;
    }
    setStep('ledger');
  }

  function completeMove() {
    if (!selectedTargetLedgerId || selectedItemIds.length === 0 || isLedgersLoading) return;
    onComplete({
      targetLedgerId: selectedTargetLedgerId,
      itemIds: [...selectedItemIds].sort(),
    });
  }

  if (step === 'items') {
    return (
      <LeaveItemPicker
        items={items}
        preview={undefined}
        previewError={null}
        isPreviewLoading={false}
        excludedItemIds={[]}
        selectedCount={selectedItemIds.length}
        onExcludedItemIdsChange={() => undefined}
        selectionMode="include"
        selectedItemIds={selectedItemIds}
        onSelectedItemIdsChange={setSelectedItemIds}
        submitLabel="下一步"
        allowEmptySelection={existingMove !== undefined}
        onComplete={continueToLedger}
        onCancel={onCancel}
      />
    );
  }

  return (
    <Dialog open title="搬到" onClose={onCancel}>
      <div className={styles.content}>
        <Button
          type="button"
          variant="secondary"
          className={styles.back}
          aria-label="返回選擇交易"
          onClick={() => setStep('items')}
        >
          ‹
        </Button>
        {isLedgersLoading && <p className={styles.status}>載入中…</p>}
        <FormError error={ledgersError} />
        <fieldset className={styles.ledgerList} aria-label="選擇帳本">
          {eligibleLedgers.map((ledger) => {
            const isUsed = usedLedgerIds.has(ledger.id);
            return (
              <label
                key={ledger.id}
                className={`${styles.ledgerOption} ${
                  selectedTargetLedgerId === ledger.id ? styles.selected : ''
                } ${isUsed ? styles.used : ''}`}
              >
                <input
                  type="radio"
                  name={radioGroupId}
                  value={ledger.id}
                  checked={selectedTargetLedgerId === ledger.id}
                  disabled={isUsed || isLedgersLoading}
                  onChange={() => setSelectedTargetLedgerId(ledger.id)}
                />
                <span className={styles.ledgerName}>{ledger.name}</span>
                {ledger.kind === 'SHARED' && <span className={styles.badge}>共享</span>}
                {isUsed && <span className={styles.badge}>已選</span>}
              </label>
            );
          })}
        </fieldset>
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onCancel}>
            取消
          </Button>
          <Button
            type="button"
            onClick={completeMove}
            disabled={!selectedTargetLedgerId || isLedgersLoading}
          >
            完成
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
