import { useState } from 'react';
import type { Counterparty, ManualTransactionType } from '@ledger/shared';
import { DebtArrow } from '../../components/DebtArrow';
import { CounterpartyPicker } from '../debts/CounterpartyPicker';
import { formatMoney } from '../../lib/format';
import type { SplitParticipantDraft } from './split-form';
import styles from './SplitSection.module.css';

interface SplitSectionProps {
  enabled: boolean;
  pending: boolean;
  type: Extract<ManualTransactionType, 'EXPENSE' | 'INCOME'>;
  payerName: string;
  isPayerOther: boolean;
  participants: SplitParticipantDraft[];
  previewShares: Map<string, number> | null;
  onToggle: (enabled: boolean) => void;
  onAddCounterparty: (counterparty: Counterparty) => void;
  onAddName: (name: string) => void;
  onRemoveParticipant: (key: string) => void;
  onOpenOptions: () => void;
}

/** 主表單只列出當前名單與 shared 預覽；詳細分法留在側欄子頁。 */
export function SplitSection({
  enabled,
  pending,
  type,
  payerName,
  isPayerOther,
  participants,
  previewShares,
  onToggle,
  onAddCounterparty,
  onAddName,
  onRemoveParticipant,
  onOpenOptions,
}: SplitSectionProps) {
  const included = participants.filter((person) => person.included);
  const [pickerValue, setPickerValue] = useState('');

  function selectCounterparty(counterparty: Counterparty) {
    onAddCounterparty(counterparty);
    setPickerValue('');
  }

  function addName(name: string) {
    onAddName(name);
    setPickerValue('');
  }

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
            disabled={pending}
            onClick={onOpenOptions}
          >
            ›
          </button>
        )}
      </div>

      {enabled && (
        <>
          <ul className={styles.people}>
            {included.map((person) => {
              const share = previewShares?.get(person.key);
              return (
                <li className={styles.person} key={person.key}>
                  <span className={styles.name}>{person.name}</span>
                  <span className={styles.share}>
                    {share === undefined ? '' : formatMoney(share)}
                  </span>
                  <button
                    type="button"
                    className={styles.remove}
                    aria-label={`移除${person.name}`}
                    disabled={pending}
                    onClick={() => onRemoveParticipant(person.key)}
                  >
                    −
                  </button>
                </li>
              );
            })}
          </ul>

          {included.map((person) => {
            const share = previewShares?.get(person.key);
            if (person.isMe || person.name === payerName || share === undefined) return null;
            const from = type === 'EXPENSE' ? person.name : isPayerOther ? payerName : '我';
            const to = type === 'EXPENSE' ? (isPayerOther ? payerName : '我') : person.name;
            const srText =
              from === '我'
                ? `你欠${to} ${formatMoney(share)}`
                : `${from}欠你 ${formatMoney(share)}`;
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

          <div className={styles.add}>
            <CounterpartyPicker
              label="＋ 新增分帳對象"
              value={pickerValue}
              onChange={setPickerValue}
              onSelect={(counterparty) => counterparty && selectCounterparty(counterparty)}
              onAddName={addName}
            />
          </div>
        </>
      )}
    </section>
  );
}
