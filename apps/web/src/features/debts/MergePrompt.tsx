import { useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { Select } from '../../components/Select';
import { useCounterparties, useDismissMergePrompt, useMergeCounterparty } from './use-debts';
import styles from './MergePrompt.module.css';

interface MergePromptFormProps {
  counterpartyId: string;
  onDone: () => void;
  onLater: () => void;
}

interface MergePromptDialogProps extends MergePromptFormProps {
  open: boolean;
  userName: string;
}

/** 詢問表單只記錄使用者選擇，合併與清除待詢問標記都交由既有 API。 */
export function MergePromptForm({ counterpartyId, onDone, onLater }: MergePromptFormProps) {
  const [answer, setAnswer] = useState<'no' | 'yes'>('no');
  const [sourceId, setSourceId] = useState('');
  const counterparties = useCounterparties({ limit: 100 });
  const dismiss = useDismissMergePrompt();
  const merge = useMergeCounterparty();
  const isPending = dismiss.isPending || merge.isPending;
  const unlinkedCounterparties = (counterparties.data?.items ?? []).filter(
    (counterparty) => counterparty.link === null,
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (answer === 'no') {
      dismiss.mutate(counterpartyId, { onSuccess: onDone });
    } else if (sourceId !== '') {
      merge.mutate({ counterpartyId, sourceId }, { onSuccess: onDone });
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <p className={styles.question}>之前有用別的名字記過他嗎？</p>
      <FormError error={counterparties.error} />
      <FormError error={dismiss.error ?? merge.error} />
      <div className={styles.answers}>
        <label className={styles.answer}>
          <input
            type="radio"
            name={`merge-prompt-${counterpartyId}`}
            value="no"
            checked={answer === 'no'}
            disabled={isPending}
            onChange={() => {
              setAnswer('no');
              setSourceId('');
            }}
          />
          沒有
        </label>
        <div className={styles.mergeChoice}>
          <label className={styles.answer}>
            <input
              type="radio"
              name={`merge-prompt-${counterpartyId}`}
              value="yes"
              checked={answer === 'yes'}
              disabled={isPending}
              onChange={() => setAnswer('yes')}
            />
            有：
          </label>
          <div className={styles.select}>
            <Select
              label=""
              aria-label="未連動的人"
              value={sourceId}
              disabled={answer !== 'yes' || isPending}
              onChange={(event) => setSourceId(event.target.value)}
            >
              <option value=""></option>
              {unlinkedCounterparties.map((counterparty) => (
                <option key={counterparty.id} value={counterparty.id}>
                  {counterparty.displayName}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>
      <div className={styles.actions}>
        <Button type="button" variant="secondary" disabled={isPending} onClick={onLater}>
          稍後
        </Button>
        <Button type="submit" disabled={isPending || (answer === 'yes' && sourceId === '')}>
          確定
        </Button>
      </div>
    </form>
  );
}

/** 接受連動後的彈窗沿用同一表單，待確認卡片也能直接重用表單本身。 */
export function MergePromptDialog({
  open,
  counterpartyId,
  userName,
  onDone,
  onLater,
}: MergePromptDialogProps) {
  return (
    <Dialog open={open} title={`已和 ${userName} 連動`} onClose={onLater}>
      <MergePromptForm
        key={counterpartyId}
        counterpartyId={counterpartyId}
        onDone={onDone}
        onLater={onLater}
      />
    </Dialog>
  );
}
