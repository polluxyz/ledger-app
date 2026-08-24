import { useState } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { FormError } from './FormError';
import { TextField } from './TextField';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** 要確認的事，用完整句子寫清楚後果。 */
  message: string;
  /** 確認鈕的文字，預設「確定」。破壞性操作請直接寫動作，例如「刪除」。 */
  confirmLabel?: string;
  /**
   * 有值時多渲染一個輸入框，使用者要打出一模一樣的字，確認鈕才會啟用。
   *
   * 留給「不可復原」等級的操作用——多按一下不足以讓人真的停下來想，打字才會。
   * 刪除帳本另有一層理由：後端要求網址上的 `confirm` 與帳本名稱相符，
   * 那個輸入框是契約要求，不是 UI 選擇。
   */
  confirmText?: string;
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
 *
 * 內容拆成 `ConfirmDialogBody` 的原因：`Dialog` 關閉時會整個卸載子樹，打到一半的
 * 確認文字因此自動清空。若把 `useState` 放在這一層，它會活過關閉，下次打開還留著
 * 上次的字——那正好讓「打字確認」失去意義。
 */
export function ConfirmDialog({ open, title, onCancel, ...rest }: ConfirmDialogProps) {
  return (
    <Dialog open={open} title={title} onClose={onCancel}>
      <ConfirmDialogBody onCancel={onCancel} {...rest} />
    </Dialog>
  );
}

function ConfirmDialogBody({
  message,
  confirmLabel = '確定',
  confirmText,
  error,
  isPending = false,
  onConfirm,
  onCancel,
}: Omit<ConfirmDialogProps, 'open' | 'title'>) {
  const [typed, setTyped] = useState('');
  // 前後空白一律不算數。那幾乎都是誤打或複製貼上帶進來的，擋下來只會讓人困惑。
  const confirmed = confirmText === undefined || typed.trim() === confirmText;

  return (
    <>
      <FormError error={error} />
      <p className={styles.message}>{message}</p>
      {confirmText !== undefined && (
        <TextField
          label={`請輸入「${confirmText}」以確認`}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          disabled={isPending}
          autoComplete="off"
        />
      )}
      <div className={styles.actions}>
        <Button variant="secondary" onClick={onCancel} disabled={isPending}>
          取消
        </Button>
        <Button className={styles.danger} onClick={onConfirm} disabled={isPending || !confirmed}>
          {isPending ? '處理中…' : confirmLabel}
        </Button>
      </div>
    </>
  );
}
