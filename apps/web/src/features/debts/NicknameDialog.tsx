import { useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { TextField } from '../../components/TextField';
import { useRenameCounterparty } from './use-debts';
import styles from './NicknameDialog.module.css';

interface NicknameDialogProps {
  open: boolean;
  counterpartyId: string;
  name: string | null;
  onClose: () => void;
}

/** 已連動對象的暱稱沿用改名 API；清空時送 null，顯示名稱仍由後端提供。 */
export function NicknameDialog({ open, counterpartyId, name, onClose }: NicknameDialogProps) {
  return (
    <Dialog open={open} title="設定暱稱" onClose={onClose}>
      <NicknameForm
        key={counterpartyId}
        counterpartyId={counterpartyId}
        name={name}
        onClose={onClose}
      />
    </Dialog>
  );
}

function NicknameForm({ counterpartyId, name, onClose }: Omit<NicknameDialogProps, 'open'>) {
  const [nickname, setNickname] = useState(name ?? '');
  const rename = useRenameCounterparty();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = nickname.trim();
    rename.mutate(
      { counterpartyId, name: trimmedName === '' ? null : trimmedName },
      { onSuccess: onClose },
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <FormError error={rename.error} />
      <TextField
        label="暱稱"
        value={nickname}
        maxLength={100}
        disabled={rename.isPending}
        onChange={(event) => setNickname(event.target.value)}
      />
      <div className={styles.actions}>
        <Button type="button" variant="secondary" disabled={rename.isPending} onClick={onClose}>
          取消
        </Button>
        <Button type="submit" disabled={rename.isPending}>
          儲存
        </Button>
      </div>
    </form>
  );
}
