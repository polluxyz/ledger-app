import { useState, type FormEvent } from 'react';
import type { DebtEntry, UpdateDebtEntryRequest } from '@ledger/shared';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { TextField } from '../../components/TextField';
import { toDateInputValue } from '../../lib/format';
import { useUpdateDebtEntry } from './use-debts';
import styles from './DebtEntryEditDialog.module.css';

interface DebtEntryEditDialogProps {
  entry: DebtEntry | null;
  onClose: () => void;
}

/** 編輯一般往來紀錄的小視窗；只傳有變更的欄位，沿用 API 作為唯一資料來源。 */
export function DebtEntryEditDialog({ entry, onClose }: DebtEntryEditDialogProps) {
  return (
    <Dialog open={entry !== null} title="修改往來紀錄" onClose={onClose}>
      {entry && <DebtEntryEditForm key={entry.id} entry={entry} onClose={onClose} />}
    </Dialog>
  );
}

function DebtEntryEditForm({ entry, onClose }: { entry: DebtEntry; onClose: () => void }) {
  const originalAmount = Math.abs(entry.delta);
  const originalDate = toDateInputValue(new Date(entry.date));
  const originalNote = entry.note ?? '';
  const [amount, setAmount] = useState(String(originalAmount));
  const [date, setDate] = useState(originalDate);
  const [note, setNote] = useState(originalNote);
  const updateEntry = useUpdateDebtEntry();

  const hasChanges =
    Number(amount) !== originalAmount || date !== originalDate || note !== originalNote;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const input: UpdateDebtEntryRequest = {};
    if (Number(amount) !== originalAmount) {
      input.amount = Number(amount);
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

    updateEntry.mutate({ entryId: entry.id, input }, { onSuccess: onClose });
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <FormError error={updateEntry.error} />
      <TextField
        label="金額"
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
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
        label="備註（選填）"
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
        <Button type="submit" disabled={updateEntry.isPending || !hasChanges}>
          {updateEntry.isPending ? '儲存中…' : '儲存'}
        </Button>
      </div>
    </form>
  );
}
