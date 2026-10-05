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
  /** 明細列用的單行小箭頭：只有名字與方向，不帶頭貼、字與金額。 */
  compact?: boolean;
}

/** 用同一個方向呈現誰欠誰，並把原本句子保留給輔助科技。 */
export function DebtArrow({
  from,
  to,
  amount,
  srText,
  label = '欠',
  compact = false,
}: DebtArrowProps) {
  if (compact) {
    return (
      <span className={styles.arrow}>
        <span className={styles.srOnly}>{srText}</span>
        <span className={styles.compact} aria-hidden="true">
          <span className={styles.compactName}>{from}</span>
          <span className={styles.compactLine} />
          <span className={styles.compactName}>{to}</span>
        </span>
      </span>
    );
  }

  return (
    <span className={styles.arrow}>
      <span className={styles.srOnly}>{srText}</span>
      <span className={styles.visual} aria-hidden="true">
        <Person name={from} />
        <span className={styles.track}>
          <span className={styles.label}>{label}</span>
          <span className={styles.line} />
          <span className={styles.amount}>{formatMoney(amount)}</span>
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
