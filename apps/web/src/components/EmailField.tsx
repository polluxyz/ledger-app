import type { InputHTMLAttributes } from 'react';
import { TextField } from './TextField';

interface EmailFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange'
> {
  label: string;
  value: string;
  /** 收到的已經是小寫。 */
  onChange: (value: string) => void;
}

/**
 * email 輸入欄位：使用者打的字一律即時轉成小寫顯示。
 *
 * email 不分大小寫，後端會先轉小寫再比對（`NormalizeEmail`）。這裡轉是為了**體驗**：
 * 使用者看到的就是實際送出、實際被存下的值，不會納悶「我明明打大寫」。規則本身在
 * 後端，這裡拿掉也不影響正確性。
 *
 * 注意要改的是 input 的**值**，不能用 CSS 的 `text-transform: lowercase`——那只改
 * 畫面，送出去的仍是大寫。
 *
 * `autoCapitalize="none"` 讓手機鍵盤不自動把第一個字母改成大寫，從源頭少一次轉換。
 */
export function EmailField({ onChange, ...rest }: EmailFieldProps) {
  return (
    <TextField
      type="email"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      onChange={(event) => onChange(event.target.value.toLowerCase())}
      {...rest}
    />
  );
}
