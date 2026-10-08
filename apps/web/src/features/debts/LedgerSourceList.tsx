import type { CounterpartyLedgerPart } from '@ledger/shared';
import { MiniOweArrow } from './MiniOweArrow';
import { formatMoney } from '../../lib/format';
import styles from './LedgerSourceList.module.css';

/** 共享帳本來源：與往來紀錄同一種「誰欠誰」箭頭，一行一列，總覽唯讀。 */
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
        // amount 正＝對方欠我（同 delta 慣例），箭頭起點永遠是欠錢的人。
        const from = source.amount > 0 ? source.personName : '我';
        const to = source.amount > 0 ? '我' : source.personName;
        const amountText = formatMoney(Math.abs(source.amount));
        const srText =
          source.amount > 0
            ? `${source.personName}欠你 ${amountText}`
            : `你欠${source.personName} ${amountText}`;

        const content = (
          // 頭貼只有一個字，人名一定要出現在左邊文字裡，兩個「小」才分得出來。
          <span className={styles.source}>
            <span
              className={styles.sourceName}
              title={`${source.ledgerName} · ${source.personName}`}
            >
              {source.ledgerName} · {source.personName}
            </span>
            {source.left && <span className={styles.left}>已退出</span>}
            <MiniOweArrow from={from} to={to} />
          </span>
        );

        return (
          <li key={`${source.ledgerId}-${source.personId}`}>
            {readOnly ? (
              <span className={`${styles.row} ${styles.readOnly}`}>
                <span className={styles.srOnly}>{srText}</span>
                {content}
                <span className={styles.amount}>{amountText}</span>
              </span>
            ) : (
              <button type="button" className={styles.row} onClick={() => onOpenSource?.(source)}>
                <span className={styles.srOnly}>{srText}</span>
                {content}
                <span className={styles.amount}>{amountText}</span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
