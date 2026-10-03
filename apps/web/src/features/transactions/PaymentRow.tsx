import type { Account, Counterparty, ManualTransactionType } from '@ledger/shared';
import { DebtArrow } from '../../components/DebtArrow';
import { Select } from '../../components/Select';
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
  onAccountChange: (accountId: string) => void;
  onModeChange: (mode: 'account' | 'counterparty' | 'self') => void;
  onPayerNameChange: (name: string) => void;
  onPayerNameAdded: (name: string) => void;
  onPayerSelect: (counterparty: Counterparty | null) => void;
  onSelectSelf: () => void;
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
  onAccountChange,
  onModeChange,
  onPayerNameChange,
  onPayerNameAdded,
  onPayerSelect,
  onSelectSelf,
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
          <CounterpartyPicker
            label={personLabel}
            value={payerName}
            includeSelf
            onChange={onPayerNameChange}
            onSelect={onPayerSelect}
            onSelectSelf={onSelectSelf}
            onAddName={onPayerNameAdded}
          />
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
