import { useState, type FormEvent } from 'react';
import {
  actualAmountOf,
  centsToInput,
  debtCategoryTypeOf,
  parseMoneyInput,
  type DebtEntry,
  type DebtEntryKind,
  type UpdateDebtEntryRequest,
} from '@ledger/shared';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { Select } from '../../components/Select';
import { TextField } from '../../components/TextField';
import { toDateInputValue } from '../../lib/format';
import { selectableAccounts, useAccounts } from '../accounts/use-accounts';
import { useCategories } from '../categories/use-categories';
import { CategoryPicker } from '../transactions/CategoryPicker';
import fieldLayoutStyles from '../transactions/TransactionFieldLayout.module.css';
import { useUpdateDebtEntry } from './use-debts';
import styles from './DebtEntryEditDialog.module.css';

interface DebtEntryEditDialogProps {
  entry: DebtEntry | null;
  displayName: string;
  onClose: () => void;
}

/** 編輯一般往來紀錄的小視窗；只有 API 有交易的紀錄才帶入交易欄位。 */
export function DebtEntryEditDialog({ entry, displayName, onClose }: DebtEntryEditDialogProps) {
  return (
    <Dialog open={entry !== null} title="修改往來紀錄" onClose={onClose}>
      {entry && (
        <DebtEntryEditForm
          key={entry.id}
          entryId={entry.id}
          amount={
            entry.kind === 'COLLECT' || entry.kind === 'REPAY'
              ? actualAmountOf(entry.kind, Math.abs(entry.delta), entry.difference)
              : Math.abs(entry.delta)
          }
          date={entry.date}
          note={entry.note}
          title={entry.recorded?.title ?? null}
          accountId={entry.recorded?.accountId ?? null}
          categoryId={entry.recorded?.categoryId ?? null}
          ledgerId={entry.recorded?.ledgerId ?? ''}
          kind={entry.kind}
          paired={entry.paired}
          counterpartyName={displayName}
          hasRecordedTransaction={entry.recorded !== null}
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
  title: string | null;
  accountId: string | null;
  categoryId: string | null;
  ledgerId: string;
  kind: DebtEntryKind;
  paired: boolean;
  counterpartyName: string;
  hasRecordedTransaction: boolean;
  onClose: () => void;
}

/** 交易頁與借還頁共用往來修改表單，並只送有變動的欄位。 */
export function DebtEntryEditForm({
  entryId,
  amount: originalAmount,
  date: originalDateValue,
  note: originalNoteValue,
  title: originalTitleValue,
  accountId: originalAccountId,
  categoryId: originalCategoryId,
  ledgerId,
  kind,
  paired,
  counterpartyName,
  hasRecordedTransaction,
  onClose,
}: DebtEntryEditFormProps) {
  const originalDate = toDateInputValue(new Date(originalDateValue));
  const originalNote = originalNoteValue ?? '';
  const originalTitle = originalTitleValue ?? '';
  const originalAccountIdValue = originalAccountId ?? '';
  const originalCategoryIdValue = originalCategoryId ?? '';
  const [amount, setAmount] = useState(centsToInput(originalAmount));
  const [date, setDate] = useState(originalDate);
  const [note, setNote] = useState(originalNote);
  const [title, setTitle] = useState(originalTitle);
  const [accountId, setAccountId] = useState(originalAccountIdValue);
  const [categoryId, setCategoryId] = useState(originalCategoryIdValue);
  const updateEntry = useUpdateDebtEntry();
  const accounts = useAccounts();
  const accountsForSelection = selectableAccounts(accounts.data ?? []);
  const categoryType = debtCategoryTypeOf(kind);
  // 名稱、帳戶、分類只有借出、借入、收回、還款能改（3i 決策 176）；舊的「幫我付」沒有帳戶，
  // 顯示必填的帳戶欄反而會讓它連金額都存不了。
  const canEditRecording = hasRecordedTransaction && categoryType !== null;
  const categories = useCategories(canEditRecording ? ledgerId : null, categoryType ?? undefined);

  const amountCents = parseMoneyInput(amount);
  const amountChanged = amountCents !== originalAmount;
  const dateChanged = date !== originalDate;
  const noteChanged = note !== originalNote;
  const titleChanged = title !== originalTitle;
  const accountChanged = accountId !== originalAccountIdValue;
  const categoryChanged = categoryId !== originalCategoryIdValue;
  const hasChanges =
    amountChanged ||
    dateChanged ||
    noteChanged ||
    titleChanged ||
    accountChanged ||
    categoryChanged;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (amountCents === null || amountCents <= 0) {
      return;
    }

    const input: UpdateDebtEntryRequest = {};
    if (amountChanged) {
      input.amount = amountCents;
    }
    if (dateChanged) {
      input.date = new Date(date).toISOString();
    }
    if (noteChanged) {
      input.note = note === '' ? null : note;
    }
    if (canEditRecording && titleChanged) {
      input.title = title.trim() === '' ? null : title.trim();
    }
    if (canEditRecording && accountChanged && accountId !== '') {
      input.accountId = accountId;
    }
    if (canEditRecording && categoryChanged) {
      input.categoryId = categoryId === '' ? null : categoryId;
    }
    if (Object.keys(input).length === 0) {
      return;
    }

    updateEntry.mutate({ entryId, input }, { onSuccess: onClose });
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <FormError error={updateEntry.error} />
      {paired && (amountChanged || dateChanged) && <p>會送給{counterpartyName}確認</p>}
      <div className={fieldLayoutStyles.amount}>
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
      </div>
      <div className={fieldLayoutStyles.row}>
        <TextField
          label="日期"
          type="date"
          value={date}
          required
          disabled={updateEntry.isPending}
          onChange={(event) => setDate(event.target.value)}
        />
        {canEditRecording && (
          <CategoryPicker
            categories={categories.data ?? []}
            value={categoryId}
            allowClear
            onChange={setCategoryId}
          />
        )}
      </div>
      {canEditRecording && (
        <>
          <Select
            label="帳戶"
            value={accountId}
            required
            disabled={accounts.isLoading || updateEntry.isPending}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="" disabled>
              請選擇
            </option>
            {accountsForSelection.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
          <TextField
            label="名稱"
            value={title}
            maxLength={100}
            disabled={updateEntry.isPending}
            onChange={(event) => setTitle(event.target.value)}
          />
        </>
      )}
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
