import { useState, type FormEvent } from 'react';
import type { Debt, UpdateDebtRequest } from '@ledger/shared';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { TextField } from '../../components/TextField';
import { toDateInputValue } from '../../lib/format';
import { useUpdateDebt } from './use-debts';
import styles from './DebtEditDialog.module.css';

/**
 * 編輯債務的彈窗（spec §4.3、plan §2.2）。
 *
 * 欄位包括對方名字、本金、日期與備註。
 *
 * ## 為什麼有結清還款時本金欄不顯示
 *
 * 依後端規則（決策 30），債務若包含結清還款，改本金會得到 409 `DEBT_NOT_OPEN`。
 * 所以畫面直接隱藏本金欄位，並加上旁註「先刪除結清的還款才能改本金」，讓使用者知道
 * 要先做什麼。
 *
 * ## PATCH 只送有變動的欄位
 *
 * 清空備註時送 `null`（後端以 `null` 表示清除、以 `undefined` 表示不更新）。
 */
export interface DebtEditDialogProps {
  debt: Debt;
  open: boolean;
  onClose: () => void;
}

export function DebtEditDialog({ debt, open, onClose }: DebtEditDialogProps) {
  if (!open) {
    return null;
  }
  return <DebtEditDialogContent debt={debt} onClose={onClose} />;
}

function DebtEditDialogContent({ debt, onClose }: { debt: Debt; onClose: () => void }) {
  const hasSettledPayment = debt.payments.some((payment) => payment.settles);
  const [counterpartyName, setCounterpartyName] = useState(debt.counterpartyName);
  const [principal, setPrincipal] = useState(String(debt.principal));
  const [date, setDate] = useState(() => toDateInputValue(new Date(debt.date)));
  const [note, setNote] = useState(debt.note ?? '');

  const updateDebt = useUpdateDebt();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: UpdateDebtRequest = {};

    if (counterpartyName !== debt.counterpartyName) {
      input.counterpartyName = counterpartyName;
    }
    if (!hasSettledPayment && Number(principal) !== debt.principal) {
      input.principal = Number(principal);
    }
    const initialDateStr = toDateInputValue(new Date(debt.date));
    if (date !== initialDateStr) {
      input.date = new Date(date).toISOString();
    }
    const initialNote = debt.note ?? '';
    if (note !== initialNote) {
      input.note = note === '' ? null : note;
    }

    if (Object.keys(input).length === 0) {
      onClose();
      return;
    }

    updateDebt.mutate(
      { debtId: debt.id, input },
      {
        onSuccess: () => {
          onClose();
        },
      },
    );
  }

  const isPending = updateDebt.isPending;

  return (
    <Dialog open={true} title="編輯借還" onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <FormError error={updateDebt.error} />

        <TextField
          label="對方名字"
          value={counterpartyName}
          required
          maxLength={100}
          onChange={(event) => setCounterpartyName(event.target.value)}
        />

        {hasSettledPayment ? (
          <p className={styles.notice}>先刪除結清的還款才能改本金</p>
        ) : (
          <TextField
            label="本金"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={principal}
            required
            onChange={(event) => setPrincipal(event.target.value)}
          />
        )}

        <TextField
          label="日期"
          type="date"
          value={date}
          required
          onChange={(event) => setDate(event.target.value)}
        />

        <TextField
          label="備註（選填）"
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />

        <div className={styles.actions}>
          <Button type="submit" block disabled={isPending}>
            {isPending ? '儲存中…' : '儲存'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
