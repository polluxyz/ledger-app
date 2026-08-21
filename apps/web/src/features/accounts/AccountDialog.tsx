import { useState, type FormEvent } from 'react';
import type { Account } from '@ledger/shared';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { TextField } from '../../components/TextField';
import { useCreateAccount, useUpdateAccount } from './use-accounts';

interface AccountDialogProps {
  /** null 代表關閉；`'new'` 為新增；給帳戶則是編輯那一筆。 */
  target: Account | 'new' | null;
  onClose: () => void;
}

/**
 * 新增／編輯帳戶的表單彈窗。兩種用途共用同一份表單，差別只在預填的值與送出的端點。
 *
 * 送出失敗時**彈窗不關**（例如名稱重複的 409）：關掉的話使用者剛打的字全沒了，
 * 而且多半根本沒看到錯誤訊息。錯誤沿用 `FormError`，直接呈現後端的文字。
 */
export function AccountDialog({ target, onClose }: AccountDialogProps) {
  if (!target) {
    return null;
  }
  // 用 key 讓「換一筆編輯」時整個重建，表單狀態不會殘留上一筆的值。
  const key = target === 'new' ? 'new' : target.id;
  return <AccountDialogForm key={key} target={target} onClose={onClose} />;
}

function AccountDialogForm({ target, onClose }: { target: Account | 'new'; onClose: () => void }) {
  const isNew = target === 'new';
  const [name, setName] = useState(isNew ? '' : target.name);
  const [initialBalance, setInitialBalance] = useState(isNew ? '0' : String(target.initialBalance));

  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();
  const mutation = isNew ? createAccount : updateAccount;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = { name, initialBalance: Number(initialBalance) };

    if (isNew) {
      createAccount.mutate(input, { onSuccess: onClose });
    } else {
      updateAccount.mutate({ id: target.id, ...input }, { onSuccess: onClose });
    }
  }

  return (
    <Dialog open title={isNew ? '新增帳戶' : '編輯帳戶'} onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <FormError error={mutation.error} />

        <TextField
          label="名稱"
          value={name}
          required
          maxLength={50}
          onChange={(event) => setName(event.target.value)}
        />

        {/* 刻意不設 min：信用卡在導入前就有欠款是常態，負數是正確的表達，
            不是錯誤輸入。hint 把這件事講出來，否則沒人會想到可以填負的。 */}
        <TextField
          label="初始餘額"
          type="number"
          step={1}
          inputMode="numeric"
          hint="開始使用本系統時這個帳戶已有的金額。信用卡的欠款請填負數。"
          value={initialBalance}
          required
          onChange={(event) => setInitialBalance(event.target.value)}
        />

        <Button type="submit" block disabled={mutation.isPending}>
          {mutation.isPending ? '儲存中…' : isNew ? '新增' : '儲存'}
        </Button>
      </form>
    </Dialog>
  );
}
