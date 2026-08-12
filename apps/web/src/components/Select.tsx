import { useId, type SelectHTMLAttributes } from 'react';
import styles from './TextField.module.css';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
}

/**
 * 帶標籤的下拉選單。沿用 TextField 的樣式，讓表單欄位外觀一致；
 * 同樣用 useId 綁定 label ↔ select（點標籤可聚焦，測試也能用 label 找到它）。
 */
export function Select({ label, id, children, ...rest }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={selectId}>
        {label}
      </label>
      <select className={styles.input} id={selectId} {...rest}>
        {children}
      </select>
    </div>
  );
}
