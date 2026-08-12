import { useId, type InputHTMLAttributes } from 'react';
import styles from './TextField.module.css';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** 欄位下方的補充說明（例如密碼長度要求）。 */
  hint?: string;
}

/**
 * 帶標籤的輸入欄位。用 useId 產生唯一 id 並綁定 label ↔ input，
 * 這樣點標籤會聚焦輸入框，螢幕閱讀器也能正確報讀（也讓測試能用
 * getByLabelText 找到欄位）。
 */
export function TextField({ label, hint, id, ...rest }: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <input
        className={styles.input}
        id={inputId}
        aria-describedby={hint ? hintId : undefined}
        {...rest}
      />
      {hint && (
        <span className={styles.hint} id={hintId}>
          {hint}
        </span>
      )}
    </div>
  );
}
