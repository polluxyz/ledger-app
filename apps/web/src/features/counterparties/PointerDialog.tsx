import { useState, type FormEvent } from 'react';
import type { Counterparty } from '@ledger/shared';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { Select } from '../../components/Select';
import { useSetLedgerPointer } from '../ledger-people/use-ledger-pointers';
import styles from './PointerDialog.module.css';

export interface PointerDialogTarget {
  ledgerId: string;
  personId: string;
  personName: string;
  counterpartyId: string | null;
}

interface PointerDialogProps {
  target: PointerDialogTarget | null;
  counterparties: Counterparty[];
  onClose: () => void;
}

/** 只編輯目前這個人的有效指向；關閉會卸載表單，重新打開就以最新 API 值為預設。 */
export function PointerDialog({ target, counterparties, onClose }: PointerDialogProps) {
  if (!target) {
    return null;
  }

  return (
    <PointerDialogForm
      key={`${target.ledgerId}-${target.personId}`}
      target={target}
      counterparties={counterparties}
      onClose={onClose}
    />
  );
}

function PointerDialogForm({
  target,
  counterparties,
  onClose,
}: Omit<PointerDialogProps, 'target'> & { target: PointerDialogTarget }) {
  const [counterpartyId, setCounterpartyId] = useState(target.counterpartyId ?? '');
  const setLedgerPointer = useSetLedgerPointer();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLedgerPointer.mutate(
      {
        ledgerId: target.ledgerId,
        personId: target.personId,
        counterpartyId: counterpartyId === '' ? null : counterpartyId,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Dialog open title={target.personName} onClose={onClose}>
      <form className={styles.form} onSubmit={submit}>
        <Select
          label="指向已建立的對象"
          value={counterpartyId}
          disabled={setLedgerPointer.isPending}
          onChange={(event) => {
            setLedgerPointer.reset();
            setCounterpartyId(event.target.value);
          }}
        >
          <option value="">不指向</option>
          {counterparties.map((counterparty) => (
            <option key={counterparty.id} value={counterparty.id}>
              {counterparty.displayName}
            </option>
          ))}
        </Select>

        <FormError error={setLedgerPointer.error} />

        <div className={styles.actions}>
          <Button
            type="button"
            variant="secondary"
            disabled={setLedgerPointer.isPending}
            onClick={onClose}
          >
            取消
          </Button>
          <Button type="submit" disabled={setLedgerPointer.isPending}>
            {setLedgerPointer.isPending ? '儲存中…' : '儲存'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
