import { useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { Select } from '../../components/Select';
import { useCounterparties, useMergeCounterparty } from './use-debts';
import styles from './MergeDialog.module.css';

interface MergeDialogProps {
  open: boolean;
  counterpartyId: string;
  onClose: () => void;
}

/** 合併視窗只選一個未連動對象，實際搬移與名稱規則交由 API 執行。 */
export function MergeDialog({ open, counterpartyId, onClose }: MergeDialogProps) {
  return (
    <Dialog open={open} title="合併之前的紀錄" onClose={onClose}>
      <MergeForm key={counterpartyId} counterpartyId={counterpartyId} onClose={onClose} />
    </Dialog>
  );
}

function MergeForm({ counterpartyId, onClose }: Omit<MergeDialogProps, 'open'>) {
  const [sourceId, setSourceId] = useState('');
  const counterparties = useCounterparties({ limit: 100 });
  const merge = useMergeCounterparty();
  const unlinkedCounterparties = (counterparties.data?.items ?? []).filter(
    (counterparty) => counterparty.link === null,
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sourceId === '') {
      return;
    }
    merge.mutate({ counterpartyId, sourceId }, { onSuccess: onClose });
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <FormError error={counterparties.error} />
      <FormError error={merge.error} />
      <Select
        label="併入"
        value={sourceId}
        disabled={merge.isPending}
        onChange={(event) => setSourceId(event.target.value)}
      >
        <option value=""></option>
        {unlinkedCounterparties.map((counterparty) => (
          <option key={counterparty.id} value={counterparty.id}>
            {counterparty.displayName}
          </option>
        ))}
      </Select>
      <div className={styles.actions}>
        <Button type="button" variant="secondary" disabled={merge.isPending} onClick={onClose}>
          取消
        </Button>
        <Button type="submit" disabled={merge.isPending || sourceId === ''}>
          合併
        </Button>
      </div>
    </form>
  );
}
