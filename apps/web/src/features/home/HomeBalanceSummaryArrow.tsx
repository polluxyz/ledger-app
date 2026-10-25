import { formatMoney } from '../../lib/format';
import styles from './HomeBalanceSummaryArrow.module.css';

export interface HomeBalanceSummaryArrowProps {
  name: string;
  /** API 提供的金額：正數表示對方欠我，負數表示我欠對方。 */
  amount: number;
}

/** 首頁借還列只出現一次對方姓名，以金額方向保留「我」的位置與摘要箭頭。 */
export function HomeBalanceSummaryArrow({ name, amount }: HomeBalanceSummaryArrowProps) {
  if (amount === 0) {
    return (
      <span className={styles.summary} aria-label={`${name}與我兩清`}>
        <span className={styles.name}>{name}</span>
        <span className={styles.settled}>兩清</span>
        <span className={styles.person}>我</span>
      </span>
    );
  }

  const otherOwesMe = amount > 0;
  const amountLabel = formatMoney(Math.abs(amount));
  const direction = '→';
  const spokenSummary = otherOwesMe ? `${name}欠你 ${amountLabel}` : `你欠${name} ${amountLabel}`;

  return (
    <span className={styles.summary} aria-label={spokenSummary}>
      {otherOwesMe ? (
        <>
          <span className={styles.name}>{name}</span>
          <span className={styles.direction} aria-hidden="true">
            {direction}
          </span>
          <span className={styles.person}>我</span>
        </>
      ) : (
        <>
          <span className={styles.person}>我</span>
          <span className={styles.direction} aria-hidden="true">
            {direction}
          </span>
          <span className={styles.name}>{name}</span>
        </>
      )}
      <span className={styles.amount}>
        <span className={styles.label}>需要支付</span>
        {amountLabel}
      </span>
    </span>
  );
}
