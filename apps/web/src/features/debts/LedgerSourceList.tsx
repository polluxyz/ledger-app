import type { CounterpartyLedgerPart } from '@ledger/shared';
import { MiniFlowArrow } from './MiniFlowArrow';
import { formatMoney } from '../../lib/format';
import styles from './LedgerSourceList.module.css';

/** 共用帳本來源的唯讀入口，讓借還展開區與往來帳明細保持相同的金額方向。 */
interface LedgerSourceListProps {
  sources: readonly CounterpartyLedgerPart[];
  onOpenSource?: (source: CounterpartyLedgerPart) => void;
  readOnly?: boolean;
}

export function LedgerSourceList({
  sources,
  onOpenSource,
  readOnly = false,
}: LedgerSourceListProps) {
  return (
    <ul className={styles.list}>
      {sources.map((source) => {
        const content = (
          <span className={styles.content}>
            <span className={styles.ledgerName}>
              {source.ledgerName}
              {source.left && <span className={styles.left}>已退出</span>}
            </span>
            <SmallDebtDirection personName={source.personName} amount={source.amount} />
          </span>
        );

        return (
          <li key={`${source.ledgerId}-${source.personId}`}>
            {readOnly ? (
              <span className={`${styles.row} ${styles.readOnly}`}>{content}</span>
            ) : (
              <button type="button" className={styles.row} onClick={() => onOpenSource?.(source)}>
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** 帳本來源以實線表示目前欠款方向，金額只顯示絕對值。 */
export function SmallDebtDirection({ personName, amount }: { personName: string; amount: number }) {
  const from = amount > 0 ? personName : '我';
  const to = amount > 0 ? '我' : personName;
  const amountText = formatMoney(Math.abs(amount));
  const srText = amount > 0 ? `${personName}欠你 ${amountText}` : `你欠${personName} ${amountText}`;

  return (
    <span className={styles.direction}>
      <span className={styles.srOnly}>{srText}</span>
      <MiniFlowArrow from={from} to={to} variant="owe" />
      <span className={styles.amount}>{amountText}</span>
    </span>
  );
}
