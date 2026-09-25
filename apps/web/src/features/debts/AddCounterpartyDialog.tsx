import { useState, type FormEvent } from 'react';
import type { Counterparty } from '@ledger/shared';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { TextField } from '../../components/TextField';
import { useCreateCounterparty } from './use-debts';
import styles from './AddCounterpartyDialog.module.css';

interface AddCounterpartyDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (counterparty: Counterparty) => void;
}

/**
 * 借還檢視可先建立往來對象再決定是否記帳；送出與錯誤留在小視窗裡，成功才交回新對象。
 */
export function AddCounterpartyDialog({ open, onClose, onCreated }: AddCounterpartyDialogProps) {
  return (
    <Dialog open={open} title="新增一個人" onClose={onClose}>
      <AddCounterpartyForm onClose={onClose} onCreated={onCreated} />
    </Dialog>
  );
}

function AddCounterpartyForm({ onClose, onCreated }: Omit<AddCounterpartyDialogProps, 'open'>) {
  const [name, setName] = useState('');
  const createCounterparty = useCreateCounterparty();
  const normalizedName = name.trim();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (normalizedName === '' || createCounterparty.isPending) {
      return;
    }

    createCounterparty.mutate(
      { name: normalizedName },
      {
        onSuccess: (counterparty) => {
          onCreated(counterparty);
          onClose();
        },
      },
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <FormError error={createCounterparty.error} />
      <TextField
        label="名字"
        value={name}
        maxLength={100}
        required
        disabled={createCounterparty.isPending}
        onChange={(event) => setName(event.target.value)}
      />
      <div className={styles.actions}>
        <Button
          variant="secondary"
          type="button"
          onClick={onClose}
          disabled={createCounterparty.isPending}
        >
          取消
        </Button>
        <Button type="submit" disabled={normalizedName === '' || createCounterparty.isPending}>
          {createCounterparty.isPending ? '新增中…' : '新增'}
        </Button>
      </div>
    </form>
  );
}
