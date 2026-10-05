import type { ManualTransactionType } from '@ledger/shared';
import { DebtArrow } from '../../components/DebtArrow';
import { formatMoney } from '../../lib/format';
import type { LedgerSplitPersonDraft } from './ledger-split-form';
import styles from './LedgerSplitSection.module.css';

interface LedgerSplitSectionProps {
  enabled: boolean;
  pending: boolean;
  type: Extract<ManualTransactionType, 'EXPENSE' | 'INCOME'>;
  participants: LedgerSplitPersonDraft[];
  payerPersonId: string | null;
  payerName: string;
  previewShares: Map<string, number> | null;
  onToggle: (enabled: boolean) => void;
  onTogglePerson: (personId: string, included: boolean) => void;
  onOpenOptions: () => void;
}

/** 共享帳本的表單名單只呈現勾選與後端規則的本地預覽，送出的整份名單由表單轉換。 */
export function LedgerSplitSection({
  enabled,
  pending,
  type,
  participants,
  payerPersonId,
  payerName,
  previewShares,
  onToggle,
  onTogglePerson,
  onOpenOptions,
}: LedgerSplitSectionProps) {
  const included = participants.filter((person) => person.included);
  const effectivePayerName = payerName || '我';

  return (
    <section className={styles.section} aria-label="分帳">
      <div className={styles.heading}>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={pending}
            onChange={(event) => onToggle(event.target.checked)}
          />
          分帳
        </label>
        {enabled && (
          <button
            type="button"
            className={styles.options}
            aria-label="分帳選項"
            disabled={pending || included.length === 0}
            onClick={onOpenOptions}
          >
            ›
          </button>
        )}
      </div>

      {enabled && (
        <>
          <ul className={styles.people}>
            {participants.map((person) => {
              const share = person.included ? previewShares?.get(person.key) : undefined;
              const isPayer = person.key === payerPersonId;
              return (
                <li className={styles.person} key={person.key}>
                  <label className={styles.name}>
                    <input
                      type="checkbox"
                      aria-label={person.name}
                      checked={person.included}
                      disabled={pending}
                      onChange={(event) => onTogglePerson(person.key, event.target.checked)}
                    />
                    <span>{person.name}</span>
                    {isPayer && <span className={styles.payer}>付款人</span>}
                  </label>
                  <span className={styles.share}>
                    {share === undefined ? '' : formatMoney(share)}
                  </span>
                </li>
              );
            })}
          </ul>

          {included.length > 0 && (
            <div className={styles.arrows}>
              {included.map((person) => {
                const share = previewShares?.get(person.key);
                if (share === undefined || person.key === payerPersonId) return null;
                const from = type === 'EXPENSE' ? person.name : effectivePayerName;
                const to = type === 'EXPENSE' ? effectivePayerName : person.name;
                const srText =
                  from === '我'
                    ? `你欠${to} ${formatMoney(share)}`
                    : to === '我'
                      ? `${from}欠你 ${formatMoney(share)}`
                      : `${from}欠${to} ${formatMoney(share)}`;
                return (
                  <DebtArrow
                    key={`arrow-${person.key}`}
                    from={from}
                    to={to}
                    amount={share}
                    srText={srText}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
