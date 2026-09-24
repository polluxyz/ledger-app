import { useId } from 'react';
import type { Counterparty } from '@ledger/shared';
import { TextField } from '../../components/TextField';
import { formatMoney } from '../../lib/format';
import styles from './CounterpartyPicker.module.css';

interface CounterpartyPickerProps {
  value: string;
  onChange: (value: string) => void;
  counterparties: Counterparty[];
}

/**
 * 對象欄只負責輸入與提示；清單和餘額由父層的 API 查詢提供，避免每個表單各自請求。
 */
export function CounterpartyPicker({ value, onChange, counterparties }: CounterpartyPickerProps) {
  const listId = `counterparties-${useId()}`;
  const normalizedName = value.trim();
  const counterparty = findCounterparty(value, counterparties);

  let hint: string | null = null;
  if (normalizedName !== '') {
    if (!counterparty) {
      hint = '新對象，送出時建立';
    } else if (counterparty.balance > 0) {
      hint = `目前${counterparty.name}欠你 ${formatMoney(counterparty.balance)}`;
    } else if (counterparty.balance < 0) {
      hint = `目前你欠${counterparty.name} ${formatMoney(Math.abs(counterparty.balance))}`;
    } else {
      hint = `目前和${counterparty.name}兩清`;
    }
  }

  return (
    <div>
      <TextField
        label="對象"
        value={value}
        list={listId}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {counterparties.map((item) => (
          <option key={item.id} value={item.name} />
        ))}
      </datalist>
      {hint && (
        <p className={styles.hint} role="status">
          {hint}
        </p>
      )}
    </div>
  );
}

/** 去掉輸入值的前後空白後，以完整名字比對，不用前綴猜測對象。 */
// 選擇器與送出表單都共用同一個比對方式，因此在元件檔一併匯出這個純函式。
// eslint-disable-next-line react-refresh/only-export-components
export function findCounterparty(
  name: string,
  counterparties: Counterparty[],
): Counterparty | null {
  const normalizedName = name.trim();
  return normalizedName === ''
    ? null
    : (counterparties.find((counterparty) => counterparty.name === normalizedName) ?? null);
}
