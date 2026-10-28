import { formatMoney } from '../../lib/format';
import styles from './HomeBalanceSummaryArrow.module.css';

export interface HomeBalanceSummaryArrowProps {
  name: string;
  /** API 提供的金額：正數表示對方欠我，負數表示我欠對方。 */
  amount: number;
}

/** 首頁借還用左右頭像表示付款方與收款方；金額集中在箭頭下方，不與姓名爭寬度。 */
export function HomeBalanceSummaryArrow({ name, amount }: HomeBalanceSummaryArrowProps) {
  const nameIsBlank = name.trim().length === 0;
  const summaryName = nameIsBlank ? '未命名對象' : name;
  const settled = amount === 0;
  const otherOwesMe = amount >= 0;
  const amountLabel = formatMoney(Math.abs(amount));
  const spokenSummary = settled
    ? `${summaryName}與我兩清`
    : otherOwesMe
      ? `${summaryName}欠你 ${amountLabel}`
      : `你欠${summaryName} ${amountLabel}`;

  function person(label: string, self: boolean) {
    const displayedName = self || !nameIsBlank ? label : '—';

    return (
      <span className={`${styles.person} ${self ? styles.self : ''}`}>
        <span className={styles.avatar} aria-hidden="true">
          {self ? '我' : nameIsBlank ? '?' : Array.from(label)[0]}
        </span>
        <span className={styles.name} title={displayedName}>
          {displayedName}
        </span>
      </span>
    );
  }

  return (
    <span
      className={`${styles.summary} ${settled ? styles.settled : ''}`}
      aria-label={spokenSummary}
    >
      {person(otherOwesMe ? name : '我', !otherOwesMe)}
      <span className={styles.middle}>
        <span className={styles.label}>{settled ? '已結清' : '需要支付'}</span>
        <span className={styles.direction} aria-hidden="true">
          {settled ? '' : '→'}
        </span>
        <span className={`${styles.amount} ${amountLabel.length > 12 ? styles.largeAmount : ''}`}>
          {settled ? '兩清' : amountLabel}
        </span>
      </span>
      {person(otherOwesMe ? '我' : name, otherOwesMe)}
    </span>
  );
}
