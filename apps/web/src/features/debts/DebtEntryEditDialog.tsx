import { useState, type FormEvent } from 'react';
import {
  centsToInput,
  parseMoneyInput,
  type DebtEntry,
  type UpdateDebtEntryRequest,
} from '@ledger/shared';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { TextField } from '../../components/TextField';
import { toDateInputValue } from '../../lib/format';
import { useUpdateDebtEntry } from './use-debts';
import styles from './DebtEntryEditDialog.module.css';

interface DebtEntryEditDialogProps {
  entry: DebtEntry | null;
  displayName: string;
  onClose: () => void;
}

/** 編輯一般往來紀錄的小視窗；只傳有變更的欄位，沿用 API 作為唯一資料來源。 */
export function DebtEntryEditDialog({ entry, displayName, onClose }: DebtEntryEditDialogProps) {
  return (
    <Dialog open={entry !== null} title="修改往來紀錄" onClose={onClose}>
      {entry && (
        <DebtEntryEditForm
          key={entry.id}
          entryId={entry.id}
          amount={Math.abs(entry.delta)}
          date={entry.date}
          note={entry.note}
          paired={entry.paired}
          displayName={displayName}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

export interface DebtEntryEditFormProps {
  entryId: string;
  /** 往來紀錄金額以正數編輯。 */
  amount: number;
  date: string;
  note: string | null;
  paired: boolean;
  displayName: string;
  onClose: () => void;
}

/** 可獨立放進對話框或右側欄的往來紀錄編輯表單。 */
export function DebtEntryEditForm({
  entryId,
  amount: originalAmount,
  date: originalDateValue,
  note: originalNoteValue,
  paired,
  displayName,
  onClose,
}: DebtEntryEditFormProps) {
  const originalDate = toDateInputValue(new Date(originalDateValue));
  const originalNote = originalNoteValue ?? '';
  const [amount, setAmount] = useState(centsToInput(originalAmount));
  const [date, setDate] = useState(originalDate);
  const [note, setNote] = useState(originalNote);
  const updateEntry = useUpdateDebtEntry();

  const amountCents = parseMoneyInput(amount);
  const hasChanges =
    amountCents !== originalAmount || date !== originalDate || note !== originalNote;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (amountCents === null || amountCents <= 0) {
      return;
    }

    const input: UpdateDebtEntryRequest = {};
    if (amountCents !== originalAmount) {
      input.amount = amountCents;
    }
    if (date !== originalDate) {
      input.date = new Date(date).toISOString();
    }
    if (note !== originalNote) {
      input.note = note === '' ? null : note;
    }
    if (Object.keys(input).length === 0) {
      return;
    }

    updateEntry.mutate({ entryId, input }, { onSuccess: onClose });
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <FormError error={updateEntry.error} />
      {paired && <p>會送給{displayName}確認</p>}
      <TextField
        label="金額"
        type="number"
        min="0.01"
        step="0.01"
        inputMode="decimal"
        value={amount}
        required
        disabled={updateEntry.isPending}
        onChange={(event) => setAmount(event.target.value)}
      />
      <TextField
        label="日期"
        type="date"
        value={date}
        required
        disabled={updateEntry.isPending}
        onChange={(event) => setDate(event.target.value)}
      />
      <TextField
        label="備註"
        value={note}
        maxLength={500}
        disabled={updateEntry.isPending}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className={styles.actions}>
        <Button
          type="button"
          variant="secondary"
          disabled={updateEntry.isPending}
          onClick={onClose}
        >
          取消
        </Button>
        <Button
          type="submit"
          disabled={
            updateEntry.isPending || amountCents === null || amountCents <= 0 || !hasChanges
          }
        >
          {updateEntry.isPending ? '儲存中…' : '儲存'}
        </Button>
      </div>
    </form>
  );
}
