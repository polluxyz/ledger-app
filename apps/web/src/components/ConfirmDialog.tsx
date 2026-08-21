import { Button } from './Button';
import { Dialog } from './Dialog';
import { FormError } from './FormError';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** 要確認的事，用完整句子寫清楚後果。 */
  message: string;
  /** 確認鈕的文字，預設「確定」。破壞性操作請直接寫動作，例如「刪除」。 */
  confirmLabel?: string;
  /** 送出後才發生的錯誤（例如後端回 409）；有值時就地顯示，彈窗不關。 */
  error?: unknown;
  /** 動作進行中：兩顆按鈕都停用，避免重複送出。 */
  isPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 破壞性操作前的二次確認。
 *
 * **它只回報使用者按了哪個鈕，不負責執行動作。** 送出、載入中、錯誤都留在呼叫端，
 * 因為那些是「刪帳戶」或「移除成員」各自的事：mutation 不同、錯誤碼不同。若把
 * mutation 放進來，這個元件就綁死在某一種資源上，下一個地方只能再複製一份，
 * 而複製出去的那份會慢慢長歪。
 *
 * 為什麼需要 `error`：像 409 這種錯誤是**按下確認之後**才發生的。彈窗若在送出當下
 * 就關閉，使用者只會看到「什麼都沒發生」，不知道被拒絕了、更不知道為什麼。
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '確定',
  error,
  isPending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} title={title} onClose={onCancel}>
      <FormError error={error} />
      <p className={styles.message}>{message}</p>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={onCancel} disabled={isPending}>
          取消
        </Button>
        <Button className={styles.danger} onClick={onConfirm} disabled={isPending}>
          {isPending ? '處理中…' : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
