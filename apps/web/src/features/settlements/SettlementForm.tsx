import { useState, type FormEvent } from 'react';
import {
  centsToInput,
  parseMoneyInput,
  type LedgerPerson,
  type LedgerSummary,
  type Transaction,
} from '@ledger/shared';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FormError } from '../../components/FormError';
import { Select } from '../../components/Select';
import { TextField } from '../../components/TextField';
import { toDateInputValue } from '../../lib/format';
import { useCurrentUser } from '../auth/use-current-user';
import { useAccounts } from '../accounts/use-accounts';
import { useLedgerPeople } from '../ledger-people/use-ledger-people';
import type { SettlementPrefill } from '../transactions/TransactionWorkbench';
import { useCreateSettlement, useDeleteSettlement, useUpdateSettlement } from './use-settlements';
import styles from './SettlementForm.module.css';

interface SettlementFormProps {
  ledger: LedgerSummary;
  transaction?: Transaction;
  prefill?: SettlementPrefill;
  onSaved: () => void;
  onDeleted: () => void;
}

/**
 * 結清的新增與編輯表單（3e W116～W121）。帳本裡的人與自己的帳戶取自既有 hooks；
 * 是否顯示帳戶欄只依目前選到的人與帳本設定決定，付款與收款規則由後端驗證。
 */
export function SettlementForm({
  ledger,
  transaction,
  prefill,
  onSaved,
  onDeleted,
}: SettlementFormProps) {
  const people = useLedgerPeople(ledger.id, ledger.kind === 'SHARED');
  const currentUser = useCurrentUser();
  const accounts = useAccounts();
  const createSettlement = useCreateSettlement(ledger.id);
  const updateSettlement = useUpdateSettlement(ledger.id);
  const deleteSettlement = useDeleteSettlement(ledger.id);
  const [fromSelection, setFromSelection] = useState<string | null>(null);
  const [toSelection, setToSelection] = useState<string | null>(null);
  const [accountSelection, setAccountSelection] = useState<string | null | undefined>(undefined);
  const [amount, setAmount] = useState(() =>
    transaction ? centsToInput(transaction.amount) : prefill ? centsToInput(prefill.amount) : '',
  );
  const [date, setDate] = useState(() =>
    toDateInputValue(transaction ? new Date(transaction.date) : undefined),
  );
  const [note, setNote] = useState(transaction?.note ?? '');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const settlement = transaction?.settlement ?? null;
  const isEditing = settlement !== null;
  const currentUserId = currentUser.data?.id;
  const currentPerson = people.data?.find((person) => person.userId === currentUserId);
  const fromPersonId =
    fromSelection ?? settlement?.from.id ?? prefill?.fromPersonId ?? currentPerson?.id ?? '';
  const toPersonId = toSelection ?? settlement?.to.id ?? prefill?.toPersonId ?? '';
  const fromPerson = people.data?.find((person) => person.id === fromPersonId);
  const toPerson = people.data?.find((person) => person.id === toPersonId);
  const fromIsMe = currentUserId !== undefined && fromPerson?.userId === currentUserId;
  const toIsMe = currentUserId !== undefined && toPerson?.userId === currentUserId;
  const showAccount = ledger.tracksBalance && (fromIsMe || toIsMe);
  const existingAccountId = fromIsMe
    ? (transaction?.account?.id ?? '')
    : toIsMe
      ? (transaction?.toAccount?.id ?? '')
      : '';
  const accountId = accountSelection === undefined ? existingAccountId : (accountSelection ?? '');
  const amountCents = parseMoneyInput(amount);
  const samePerson = fromPersonId !== '' && fromPersonId === toPersonId;
  const pending = createSettlement.isPending || updateSettlement.isPending;
  const canSubmit =
    !pending &&
    !samePerson &&
    fromPersonId !== '' &&
    toPersonId !== '' &&
    amountCents !== null &&
    amountCents > 0 &&
    date !== '' &&
    (!showAccount || accountId !== '');
  const error =
    people.error ??
    accounts.error ??
    createSettlement.error ??
    updateSettlement.error ??
    deleteSettlement.error;

  function displayName(person: LedgerPerson) {
    return person.userId !== null && person.userId === currentUserId ? '我' : person.name;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || amountCents === null) {
      return;
    }

    const input = {
      ...(isEditing || !fromIsMe ? { fromPersonId } : {}),
      toPersonId,
      amount: amountCents,
      date: new Date(date).toISOString(),
      ...(isEditing || note !== '' ? { note } : {}),
      ...(showAccount && accountId !== ''
        ? fromIsMe
          ? { fromAccountId: accountId }
          : { toAccountId: accountId }
        : {}),
    };

    if (isEditing && settlement) {
      updateSettlement.mutate({ settlementId: settlement.id, input }, { onSuccess: onSaved });
    } else {
      createSettlement.mutate(input, { onSuccess: onSaved });
    }
  }

  function handleDelete() {
    if (!settlement) {
      return;
    }
    deleteSettlement.mutate(settlement.id, {
      onSuccess: () => {
        setConfirmDeleteOpen(false);
        onDeleted();
      },
    });
  }

  return (
    <>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <FormError error={error} />
        <Select
          label="付錢的人"
          value={fromPersonId}
          required
          onChange={(event) => {
            setFromSelection(event.target.value);
            setAccountSelection(null);
          }}
        >
          <option value="">選擇付錢的人</option>
          {people.data?.map((person) => (
            <option key={person.id} value={person.id}>
              {displayName(person)}
            </option>
          ))}
        </Select>
        <Select
          label="收錢的人"
          value={toPersonId}
          required
          onChange={(event) => {
            setToSelection(event.target.value);
            setAccountSelection(null);
          }}
        >
          <option value="">選擇收錢的人</option>
          {people.data?.map((person) => (
            <option key={person.id} value={person.id}>
              {displayName(person)}
            </option>
          ))}
        </Select>
        <TextField
          label="金額"
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          value={amount}
          required
          onChange={(event) => setAmount(event.target.value)}
        />
        <TextField
          label="日期"
          type="date"
          value={date}
          required
          onChange={(event) => setDate(event.target.value)}
        />
        {showAccount && (
          <Select
            label="帳戶"
            value={accountId}
            required
            onChange={(event) => setAccountSelection(event.target.value)}
          >
            <option value="">選擇帳戶</option>
            {accounts.data?.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        )}
        <TextField
          label="備註"
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />
        <div className={styles.actions}>
          <Button type="submit" disabled={!canSubmit}>
            {pending ? '儲存中…' : isEditing ? '儲存' : '新增'}
          </Button>
        </div>
        {isEditing && (
          <Button
            type="button"
            variant="secondary"
            disabled={deleteSettlement.isPending}
            onClick={() => setConfirmDeleteOpen(true)}
          >
            刪除
          </Button>
        )}
      </form>
      <ConfirmDialog
        open={confirmDeleteOpen}
        title="刪除結清"
        message="確定刪除這筆結清？"
        confirmLabel="刪除"
        error={deleteSettlement.error}
        isPending={deleteSettlement.isPending}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </>
  );
}
