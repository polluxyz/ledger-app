import { useState } from 'react';
import {
  SPLIT_RATIO_TOTAL,
  centsToInput,
  computeSharesByKey,
  parseMoneyInput,
  type SplitMethod,
  type SplitPrecision,
} from '@ledger/shared';
import { Button } from '../../components/Button';
import { DebtArrow } from '../../components/DebtArrow';
import { Select } from '../../components/Select';
import { TextField } from '../../components/TextField';
import { formatMoney } from '../../lib/format';
import type { SplitParticipantDraft } from './split-form';
import { fillRemainingSharesByKey } from './split-form';
import styles from './SplitOptionsView.module.css';

const METHODS: Array<{ value: SplitMethod; label: string }> = [
  { value: 'EQUAL', label: '均分' },
  { value: 'AMOUNT', label: '金額' },
  { value: 'RATIO', label: '比例' },
];

interface SplitOptionsViewProps {
  total: number | null;
  type: 'EXPENSE' | 'INCOME';
  /** 3c 相容介面；新帳本表單傳入通用的 payerKey。 */
  payerCounterpartyId?: string | null;
  payerKey?: string | null;
  /** 3c 付款人不在名單時的吸收者，3e 不使用這個 fallback。 */
  fallbackKey?: string;
  payerName: string;
  method: SplitMethod;
  precision: SplitPrecision;
  participants: SplitParticipantDraft[];
  onBack: () => void;
  onSave: (value: {
    method: SplitMethod;
    precision: SplitPrecision;
    participants: SplitParticipantDraft[];
  }) => void;
}

/** 側欄內的分帳子頁：固定使用者改過的值，其餘由 shared 自動分配與預覽。 */
export function SplitOptionsView({
  total,
  type,
  payerCounterpartyId,
  payerKey: suppliedPayerKey,
  fallbackKey: suppliedFallbackKey,
  payerName,
  method: initialMethod,
  precision: initialPrecision,
  participants: initialParticipants,
  onBack,
  onSave,
}: SplitOptionsViewProps) {
  const [method, setMethod] = useState<SplitMethod>(initialMethod);
  const [precision, setPrecision] = useState<SplitPrecision>(initialPrecision);
  const [participants, setParticipants] = useState(() =>
    initialParticipants.map((person) => ({ ...person })),
  );
  const active = participants.filter((person) => person.included);
  const me = participants.find((person) => person.isMe);
  const payerKey =
    suppliedPayerKey !== undefined
      ? suppliedPayerKey
      : payerCounterpartyId !== undefined
        ? (payerCounterpartyId ?? me?.key ?? null)
        : (me?.key ?? null);
  const fallbackKey = suppliedFallbackKey ?? (suppliedPayerKey === undefined ? me?.key : undefined);

  const filled =
    method === 'EQUAL'
      ? null
      : fillRemainingSharesByKey({
          total: total ?? 0,
          method,
          precision,
          payerKey,
          ...(fallbackKey === undefined ? {} : { fallbackKey }),
          participants: active.map((person) => ({
            key: person.key,
            value:
              method === 'AMOUNT'
                ? person.amountFixed
                  ? person.amountValue
                  : undefined
                : person.ratioFixed
                  ? person.ratioValue
                  : undefined,
          })),
        });

  const preview =
    total !== null && total > 0
      ? computeSharesByKey({
          total,
          method,
          precision,
          payerKey,
          ...(fallbackKey === undefined ? {} : { fallbackKey }),
          participants: active.map((person, index) => ({
            key: person.key,
            ...(method === 'AMOUNT' && filled ? { amount: filled.values[index]! } : {}),
            ...(method === 'RATIO' && filled ? { ratio: filled.values[index]! } : {}),
          })),
        })
      : { ok: false as const, error: 'SPLIT_PARTICIPANTS_INVALID' as const };

  const remainderMessage =
    filled && filled.remainder !== 0
      ? method === 'AMOUNT'
        ? filled.remainder > 0
          ? `還差 ${formatMoney(filled.remainder)}`
          : `多了 ${formatMoney(Math.abs(filled.remainder))}`
        : `比例合計 ${formatPercent(SPLIT_RATIO_TOTAL - filled.remainder)}%`
      : null;

  function clearFixedValues(people: SplitParticipantDraft[]) {
    return people.map((person) => ({
      ...person,
      included: person.included,
      amountFixed: false,
      amountInput: '',
      amountValue: 0,
      ratioFixed: false,
      ratioInput: '',
      ratioValue: 0,
    }));
  }

  function changeMethod(nextMethod: SplitMethod) {
    setMethod(nextMethod);
    setParticipants((current) => clearFixedValues(current));
  }

  function toggleParticipant(key: string, included: boolean) {
    setParticipants((current) =>
      clearFixedValues(current).map((person) =>
        person.key === key ? { ...person, included } : person,
      ),
    );
  }

  function changeValue(key: string, value: string) {
    const parsed = parseMoneyInput(value) ?? 0;
    setParticipants((current) =>
      current.map((person) =>
        person.key === key
          ? method === 'AMOUNT'
            ? { ...person, amountFixed: true, amountInput: value, amountValue: parsed }
            : { ...person, ratioFixed: true, ratioInput: value, ratioValue: parsed }
          : person,
      ),
    );
  }

  function save() {
    if (!preview.ok || !filled) {
      onSave({ method, precision, participants: active });
      return;
    }
    const nextParticipants = active.map((person, index) => ({
      ...person,
      included: true,
      ...(method === 'AMOUNT'
        ? {
            amountValue: filled.values[index]!,
            amountInput: person.amountFixed
              ? person.amountInput
              : centsToInput(filled.values[index]!),
          }
        : {}),
      ...(method === 'RATIO'
        ? {
            ratioValue: filled.values[index]!,
            ratioInput: person.ratioFixed ? person.ratioInput : centsToInput(filled.values[index]!),
          }
        : {}),
    }));
    onSave({ method, precision, participants: nextParticipants });
  }

  return (
    <section className={styles.view} aria-label="分帳選項">
      <header className={styles.header}>
        <button type="button" className={styles.back} aria-label="返回" onClick={onBack}>
          ‹
        </button>
        <h3>分帳選項</h3>
        <Button type="button" disabled={!preview.ok} onClick={save}>
          儲存
        </Button>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="分帳方式">
        {METHODS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={method === option.value}
            onClick={() => changeMethod(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <ul className={styles.people}>
        {participants.map((person) => {
          const index = active.findIndex((candidate) => candidate.key === person.key);
          const share = preview.ok && index >= 0 ? preview.shares[index] : undefined;
          const value = filled?.values[index];
          const isPayer = person.key === payerKey;
          return (
            <li className={styles.person} key={person.key}>
              <label className={styles.include}>
                <input
                  type="checkbox"
                  checked={person.included}
                  onChange={(event) => toggleParticipant(person.key, event.target.checked)}
                />
                <span>
                  {person.name}
                  {isPayer ? ' · 付款人' : ''}
                </span>
              </label>

              {method === 'EQUAL' ? (
                <span className={styles.value}>
                  {share === undefined ? '' : formatMoney(share)}
                </span>
              ) : person.included ? (
                <div className={styles.custom}>
                  <TextField
                    label={method === 'AMOUNT' ? `${person.name} 金額` : `${person.name} 比例`}
                    type="number"
                    min="0"
                    max={method === 'RATIO' ? '100' : undefined}
                    step="0.01"
                    inputMode="decimal"
                    value={
                      method === 'AMOUNT'
                        ? person.amountFixed
                          ? person.amountInput
                          : value === undefined
                            ? ''
                            : centsToInput(value)
                        : person.ratioFixed
                          ? person.ratioInput
                          : value === undefined
                            ? ''
                            : centsToInput(value)
                    }
                    onChange={(event) => changeValue(person.key, event.target.value)}
                  />
                  {method === 'RATIO' && (
                    <span className={styles.percent}>
                      {share === undefined ? '' : `= ${formatMoney(share)}`}
                    </span>
                  )}
                </div>
              ) : (
                <span className={styles.value} />
              )}
            </li>
          );
        })}
      </ul>

      {preview.ok && (
        <div className={styles.arrows}>
          {active.map((person, index) => {
            if (person.key === payerKey) return null;
            const amount = preview.shares[index]!;
            const personName = person.isMe ? '我' : person.name;
            const creditor = payerKey === null ? '我' : payerName;
            const from = type === 'EXPENSE' ? personName : creditor;
            const to = type === 'EXPENSE' ? creditor : personName;
            const srText =
              suppliedPayerKey === undefined
                ? from === '我'
                  ? `你欠${to} ${formatMoney(amount)}`
                  : `${from}欠你 ${formatMoney(amount)}`
                : from === '我'
                  ? `你欠${to} ${formatMoney(amount)}`
                  : to === '我'
                    ? `${from}欠你 ${formatMoney(amount)}`
                    : `${from}欠${to} ${formatMoney(amount)}`;
            return (
              <DebtArrow
                key={`preview-${person.key}`}
                from={from}
                to={to}
                amount={amount}
                srText={srText}
              />
            );
          })}
        </div>
      )}

      {method !== 'AMOUNT' && (
        <Select
          label="精度"
          value={precision}
          onChange={(event) => setPrecision(event.target.value as SplitPrecision)}
        >
          <option value="CENT">分</option>
          <option value="YUAN">元</option>
        </Select>
      )}

      {remainderMessage && (
        <p className={styles.remainder} role="status">
          {remainderMessage}
        </p>
      )}
    </section>
  );
}

function formatPercent(value: number): string {
  return centsToInput(value)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
}
