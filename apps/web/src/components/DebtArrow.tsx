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
  /** 箭頭上方的字。借還分頁用「需要支付」，其餘沿用「欠」。 */
  label?: string;
  /** 結清列只需要顯示方向；保留必填 amount 以免既有呼叫端改變。 */
  hideAmount?: boolean;
}

/** 用同一個方向呈現誰欠誰，並把原本句子保留給輔助科技。 */
export function DebtArrow({
  from,
  to,
  amount,
  srText,
  label = '欠',
  hideAmount = false,
}: DebtArrowProps) {
  return (
    <span className={styles.arrow}>
      <span className={styles.srOnly}>{srText}</span>
      <span className={styles.visual} aria-hidden="true">
        <Person name={from} />
        <span className={styles.track}>
          {/* 只剩方向的結清紀錄不是「欠」，所以不帶字。 */}
          <span className={styles.label}>{hideAmount ? '' : label}</span>
          <span className={styles.line} />
          <span className={styles.amount}>{hideAmount ? '' : formatMoney(amount)}</span>
        </span>
        <Person name={to} />
      </span>
    </span>
  );
}

/** 頭貼在上、名字在下。使用者還沒有頭貼，先用名字第一個字代替。 */
function Person({ name }: { name: string }) {
  return (
    <span className={styles.person}>
      <span className={styles.avatar}>{Array.from(name)[0] ?? ''}</span>
      <span className={styles.name}>{name}</span>
    </span>
  );
}
