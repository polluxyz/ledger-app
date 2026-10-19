import type { CounterpartyLedgerPart } from '@ledger/shared';
import { MiniOweArrow } from './MiniOweArrow';
import { formatMoney } from '../../lib/format';
import rowStyles from './DebtRow.module.css';
import styles from './LedgerSourceList.module.css';

interface LedgerSourceListProps {
  sources: readonly CounterpartyLedgerPart[];
  onOpenSource?: (source: CounterpartyLedgerPart) => void;
  readOnly?: boolean;
  reserveActionColumn?: boolean;
  avatarLabels?: ReadonlyMap<string, string>;
}

/** 共享來源依帳本分組；帳本名稱作小標題，列內只留日期欄、箭頭、標籤與金額。 */
export function LedgerSourceList({
  sources,
  onOpenSource,
  readOnly = false,
  reserveActionColumn = false,
  avatarLabels,
}: LedgerSourceListProps) {
  const groupsByLedger = new Map<
    string,
    { ledgerName: string; sources: CounterpartyLedgerPart[] }
  >();

  for (const source of sources) {
    const group = groupsByLedger.get(source.ledgerId) ?? {
      ledgerName: source.ledgerName,
      sources: [],
    };
    group.sources.push(source);
    groupsByLedger.set(source.ledgerId, group);
  }

  return (
    <div className={styles.groups}>
      {[...groupsByLedger.entries()].map(([ledgerId, group]) => (
        <section key={ledgerId} className={styles.group}>
          <h4 className={styles.heading}>{group.ledgerName}</h4>
          <ul className={styles.sourceList}>
            {group.sources.map((source) => {
              // amount 正＝對方欠我（同 delta 慣例），箭頭起點永遠是欠錢的人。
              const from = source.amount > 0 ? source.personName : '我';
              const to = source.amount > 0 ? '我' : source.personName;
              const amountText = formatMoney(Math.abs(source.amount));
              const srText =
                source.amount > 0
                  ? `${source.personName}欠你 ${amountText}`
                  : `你欠${source.personName} ${amountText}`;

              const content = (
                <SourceRowContents
                  from={from}
                  to={to}
                  amountText={amountText}
                  avatarLabels={avatarLabels}
                  reserveActionColumn={reserveActionColumn}
                />
              );

              return (
                <li key={`${source.ledgerId}-${source.personId}`} className={rowStyles.item}>
                  {readOnly ? (
                    <span className={rowStyles.row} role="group" aria-label={srText}>
                      {content}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={`${rowStyles.row} ${rowStyles.interactive}`}
                      aria-label={srText}
                      onClick={() => onOpenSource?.(source)}
                    >
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SourceRowContents({
  from,
  to,
  amountText,
  avatarLabels,
  reserveActionColumn,
}: {
  from: string;
  to: string;
  amountText: string;
  avatarLabels?: ReadonlyMap<string, string>;
  reserveActionColumn: boolean;
}) {
  return (
    <span className={styles.visual} aria-hidden="true">
      <span className={rowStyles.date} />
      <span className={rowStyles.arrow}>
        <MiniOweArrow
          from={from}
          fromLabel={avatarLabels?.get(from)}
          to={to}
          toLabel={avatarLabels?.get(to)}
        />
      </span>
      <span className={rowStyles.spacer} />
      <span className={rowStyles.label} />
      <span className={rowStyles.amount}>
        <span className={rowStyles.amountText}>{amountText}</span>
      </span>
      {reserveActionColumn && <span className={rowStyles.actions} />}
    </span>
  );
}
