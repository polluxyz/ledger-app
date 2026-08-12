import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
  /** 撐滿容器寬度（表單的主要動作常用）。 */
  block?: boolean;
}

/**
 * 一般按鈕。刻意保留原生 button 的所有屬性（type、disabled、onClick…），
 * 只在樣式上做統一。
 */
export function Button({ variant = 'primary', block = false, className, ...rest }: ButtonProps) {
  const classes = [styles.button, styles[variant], block ? styles.block : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return <button className={classes} {...rest} />;
}
