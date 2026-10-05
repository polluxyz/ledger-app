import { useId, useState } from 'react';
import type { LedgerPerson } from '@ledger/shared';
import type { Account, Counterparty, ManualTransactionType } from '@ledger/shared';
import { DebtArrow } from '../../components/DebtArrow';
import { Select } from '../../components/Select';
import { TextField } from '../../components/TextField';
import { CounterpartyPicker } from '../debts/CounterpartyPicker';
import styles from './PaymentRow.module.css';

interface PaymentPreview {
  from: string;
  to: string;
  amount: number;
  srText: string;
}

interface PaymentRowProps {
  type: Extract<ManualTransactionType, 'EXPENSE' | 'INCOME'>;
  accounts: Account[];
  accountId: string;
  showAccountField: boolean;
  accountLocked: boolean;
  mode: 'account' | 'counterparty' | 'self';
  payerName: string;
  isPayerOther: boolean;
  preview: PaymentPreview | null;
  ledgerPeople?: LedgerPerson[];
  mePersonId?: string | null;
  selectedLedgerPersonId?: string | null;
  onAccountChange: (accountId: string) => void;
  onModeChange: (mode: 'account' | 'counterparty' | 'self') => void;
  onPayerNameChange: (name: string) => void;
  onPayerSelect: (counterparty: Counterparty | null) => void;
  onLedgerPersonSelect?: (person: LedgerPerson | null) => void;
}

/** 帳戶與付款人共用一列，切換時保留各自的選擇並預覽我的往來方向。 */
export function PaymentRow({
  type,
  accounts,
  accountId,
  showAccountField,
  accountLocked,
  mode,
  payerName,
  isPayerOther,
  preview,
  ledgerPeople,
  mePersonId,
  selectedLedgerPersonId,
  onAccountChange,
  onModeChange,
  onPayerNameChange,
  onPayerSelect,
  onLedgerPersonSelect,
}: PaymentRowProps) {
  const personLabel = type === 'INCOME' ? '收款人' : '付款人';
  const nextMode =
    mode === 'account'
      ? 'counterparty'
      : mode === 'counterparty'
        ? showAccountField
          ? 'account'
          : 'self'
        : 'counterparty';

  if (accountLocked) {
    return null;
  }

  return (
    <div className={styles.payment}>
      <div className={styles.choice}>
        {mode === 'account' && showAccountField ? (
          <Select
            label="帳戶"
            value={accountId}
            required
            onChange={(event) => onAccountChange(event.target.value)}
          >
            <option value="">選擇帳戶</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        ) : mode === 'counterparty' ? (
          ledgerPeople ? (
            <LedgerPersonPicker
              label={personLabel}
              people={ledgerPeople}
              mePersonId={mePersonId ?? null}
              value={payerName}
              selectedPersonId={selectedLedgerPersonId ?? null}
              onChange={onPayerNameChange}
              onSelect={onLedgerPersonSelect ?? (() => {})}
            />
          ) : (
            <CounterpartyPicker
              label={personLabel}
              value={payerName}
              onChange={onPayerNameChange}
              onSelect={onPayerSelect}
            />
          )
        ) : (
          <p className={styles.self}>{personLabel}：我</p>
        )}

        <button
          type="button"
          className={styles.switch}
          aria-label={
            mode === 'account'
              ? type === 'INCOME'
                ? '改為選收款人'
                : '改為選付款人'
              : mode === 'counterparty'
                ? showAccountField
                  ? '改為選帳戶'
                  : '改為選自己'
                : type === 'INCOME'
                  ? '改為選收款人'
                  : '改為選付款人'
          }
          onClick={() => onModeChange(nextMode)}
        >
          ⇄
        </button>
      </div>

      {isPayerOther && preview && (
        <div className={styles.preview}>
          <DebtArrow {...preview} />
        </div>
      )}
    </div>
  );
}

interface LedgerPersonPickerProps {
  label: string;
  people: LedgerPerson[];
  mePersonId: string | null;
  value: string;
  selectedPersonId: string | null;
  onChange: (value: string) => void;
  onSelect: (person: LedgerPerson | null) => void;
}

/** 共享帳本付款人只列帳本裡的其他人；自由輸入保留新增非成員的名字。 */
function LedgerPersonPicker({
  label,
  people,
  mePersonId,
  value,
  selectedPersonId,
  onChange,
  onSelect,
}: LedgerPersonPickerProps) {
  const listId = `ledger-people-${useId()}`;
  const [isOpen, setIsOpen] = useState(false);
  const query = value.trim().toLocaleLowerCase();
  const options = people.filter(
    (person) =>
      person.id !== mePersonId && (query === '' || person.name.toLocaleLowerCase().includes(query)),
  );

  function selectPerson(person: LedgerPerson) {
    onChange(person.name);
    onSelect(person);
    setIsOpen(false);
  }

  return (
    <div className={styles.ledgerPicker}>
      <TextField
        label={label}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listId}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        onChange={(event) => {
          onChange(event.target.value);
          onSelect(null);
          setIsOpen(true);
        }}
      />
      <ul
        className={styles.ledgerOptions}
        id={listId}
        role="listbox"
        aria-label={`${label}選項`}
        hidden={!isOpen || options.length === 0}
      >
        {options.map((person) => (
          <li
            key={person.id}
            className={styles.ledgerOption}
            role="option"
            aria-selected={selectedPersonId === person.id}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => selectPerson(person)}
          >
            {person.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
