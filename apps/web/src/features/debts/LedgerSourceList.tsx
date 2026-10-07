import type { CounterpartyLedgerPart } from '@ledger/shared';
import { DebtArrow } from '../../components/DebtArrow';
import { formatMoney } from '../../lib/format';
import styles from './LedgerSourceList.module.css';

/** 共用帳本來源的唯讀入口，讓借還展開區與往來帳明細保持相同的金額方向。 */
interface LedgerSourceListProps {
  sources: readonly CounterpartyLedgerPart[];
  onOpenSource: (source: CounterpartyLedgerPart) => void;
}

export function LedgerSourceList({ sources, onOpenSource }: LedgerSourceListProps) {
  return (
    <ul className={styles.list}>
      {sources.map((source) => (
        <li key={`${source.ledgerId}-${source.personId}`}>
          <button
            type="button"
            className={styles.row}
            aria-label={getLedgerSourceLabel(source)}
            onClick={() => onOpenSource(source)}
          >
            <span className={styles.ledgerName}>
              {source.ledgerName} <span aria-hidden="true">›</span>
              {source.left && <span className={styles.left}>已退出</span>}
            </span>
            <SmallDebtDirection personName={source.personName} amount={source.amount} />
          </button>
        </li>
      ))}
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

function getLedgerSourceLabel(source: CounterpartyLedgerPart): string {
  const direction = source.amount > 0 ? `${source.personName}欠你` : `你欠${source.personName}`;
  const access = source.left
    ? `開啟已退出帳本 ${source.ledgerName} 的唯讀畫面`
    : `開啟 ${source.ledgerName} 的結清`;
  return `${access}：${direction} ${formatMoney(Math.abs(source.amount))}`;
}
