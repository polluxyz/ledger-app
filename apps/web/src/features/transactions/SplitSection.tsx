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
  isPayerOther: boolean;
  participants: SplitParticipantDraft[];
  previewShares: Map<string, number> | null;
  onToggle: (enabled: boolean) => void;
  onAddCounterparty: (counterparty: Counterparty) => void;
  onAddName: (name: string) => void;
  onRemoveParticipant: (key: string) => void;
  /** 「我」那一列是勾選框（修訂 2，W92）：取消＝只幫別人付，可以再勾回來。 */
  onToggleMe: (included: boolean) => void;
  onOpenOptions: () => void;
}

/** 主表單只列出當前名單與 shared 預覽；詳細分法留在側欄子頁。 */
export function SplitSection({
  enabled,
  pending,
  type,
  isPayerOther,
  participants,
  previewShares,
  onToggle,
  onAddCounterparty,
  onAddName,
  onRemoveParticipant,
  onToggleMe,
  onOpenOptions,
}: SplitSectionProps) {
  const included = participants.filter((person) => person.included);
  const me = participants.find((person) => person.isMe);
  const others = included.filter((person) => !person.isMe);
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
            {/*
             * 「我」不用「−」移除：移除後沒有地方加回來（選人清單裡沒有「我」，W89）。
             * 改成勾選框，取消勾選代表只幫別人付，名單裡仍留著這一列。
             */}
            {me && (
              <li className={styles.person} key={me.key}>
                <label className={styles.name}>
                  <input
                    type="checkbox"
                    checked={me.included}
                    disabled={pending}
                    onChange={(event) => onToggleMe(event.target.checked)}
                  />
                  {me.name}
                </label>
                <span className={styles.share}>
                  {me.included && previewShares?.get(me.key) !== undefined
                    ? formatMoney(previewShares.get(me.key)!)
                    : ''}
                </span>
              </li>
            )}
            {others.map((person) => {
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

          {/*
           * 只有我付（收）時才列出每個人的箭頭。別人付時，其他人欠付款人多少不關我的事
           * （3c 決策 87、W67），我欠付款人的那一行已經在帳戶列下方（W65），這裡不重複。
           */}
          {!isPayerOther && (
            <div className={styles.arrows}>
              {included.map((person) => {
                const share = previewShares?.get(person.key);
                if (person.isMe || share === undefined) return null;
                const from = type === 'EXPENSE' ? person.name : '我';
                const to = type === 'EXPENSE' ? '我' : person.name;
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
            </div>
          )}

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
