import type { CounterpartyLedgerPart } from '@ledger/shared';
import { DebtArrow } from '../../components/DebtArrow';
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
          <>
            <span className={styles.ledgerName}>
              {source.ledgerName} <span aria-hidden="true">›</span>
              {source.left && <span className={styles.left}>已退出</span>}
            </span>
            <SmallDebtDirection personName={source.personName} amount={source.amount} />
          </>
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

/** 單行版沿用 DebtArrow 的無頭貼箭頭，金額只讀 API 的原始正負方向。 */
export function SmallDebtDirection({ personName, amount }: { personName: string; amount: number }) {
  const from = amount > 0 ? personName : '我';
  const to = amount > 0 ? '我' : personName;
  const amountText = formatMoney(Math.abs(amount));
  const srText = amount > 0 ? `${personName}欠你 ${amountText}` : `你欠${personName} ${amountText}`;

  return (
    <span className={styles.direction}>
      <DebtArrow compact from={from} to={to} amount={Math.abs(amount)} srText={srText} />
      <span className={styles.amount}>{amountText}</span>
    </span>
  );
}
