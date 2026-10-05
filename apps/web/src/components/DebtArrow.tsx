import { formatMoney } from '../lib/format';
import styles from './DebtArrow.module.css';

interface DebtArrowProps {
  /** 箭頭的起點；代表欠款的一方。 */
  from: string;
  /** 箭頭的終點；代表被欠款的一方。 */
  to: string;
  /** 金額以分傳入，顯示交由 shared formatter。 */
  amount: number;
  /** 保留既有的口語描述給螢幕閱讀器。 */
  srText: string;
  /** 結清列只需要顯示方向；保留必填 amount 以免既有呼叫端改變。 */
  hideAmount?: boolean;
}

/** 用同一個方向呈現誰欠誰，並把原本句子保留給輔助科技。 */
export function DebtArrow({ from, to, amount, srText, hideAmount = false }: DebtArrowProps) {
  return (
    <span className={styles.arrow}>
      <span className={styles.srOnly}>{srText}</span>
      <span className={styles.visual} aria-hidden="true">
        <span className={styles.person}>{from}</span>
        <span className={styles.track}>
          {!hideAmount && <span className={styles.amount}>{formatMoney(amount)}</span>}
        </span>
        <span className={styles.person}>{to}</span>
      </span>
    </span>
  );
}
