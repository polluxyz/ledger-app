import { useState, type FormEvent } from 'react';
import type { LedgerDetail } from '@ledger/shared';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { TextField } from '../../components/TextField';
import { useRenameLedger } from './use-ledgers';

interface LedgerRenameDialogProps {
  /** null 代表關閉。 */
  ledger: LedgerDetail | null;
  onClose: () => void;
}

/**
 * 帳本改名。
 *
 * 刻意**不與 `LedgerDialog` 共用**。建立表單現在裝著兩組建立後不可變更的選擇、
 * 參與者清單，以及「部分成員加入失敗」的重試狀態；改名只有一個欄位。硬塞進同一個
 * 元件，得到的是一堆 `if (isRename)`，兩種用途都變得難讀——`AccountDialog` 能共用，
 * 是因為它的新增與編輯只差一個欄位。
 *
 * 送出失敗時彈窗不關：關掉的話使用者剛打的字全沒了，而且多半沒看到錯誤訊息。
 */
export function LedgerRenameDialog({ ledger, onClose }: LedgerRenameDialogProps) {
  if (!ledger) {
    return null;
  }
  // 用 key 讓換一本帳本時整個重建，表單不會殘留上一本的名稱。
  return <LedgerRenameForm key={ledger.id} ledger={ledger} onClose={onClose} />;
}

function LedgerRenameForm({ ledger, onClose }: { ledger: LedgerDetail; onClose: () => void }) {
  const [name, setName] = useState(ledger.name);
  const renameLedger = useRenameLedger();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // 只送名稱。`kind` 與 `tracksBalance` 帶上去都會被後端退回 400，那是刻意的。
    renameLedger.mutate({ id: ledger.id, name }, { onSuccess: onClose });
  }

  return (
    <Dialog open title="帳本改名" onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <FormError error={renameLedger.error} />

        <TextField
          label="名稱"
          value={name}
          required
          maxLength={100}
          onChange={(event) => setName(event.target.value)}
        />

        <Button type="submit" block disabled={renameLedger.isPending}>
          {renameLedger.isPending ? '儲存中…' : '儲存'}
        </Button>
      </form>
    </Dialog>
  );
}
