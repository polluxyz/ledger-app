import { useState, type FormEvent } from 'react';
import type { LedgerSummary, Transaction } from '@ledger/shared';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormError';
import { Select } from '../../components/Select';
import { useAccounts } from '../accounts/use-accounts';
import { useSetSettlementAccount, useSetTransactionAccount } from './use-settlements';
import styles from './FillAccountForm.module.css';

interface FillAccountFormProps {
  ledger: LedgerSummary;
  transaction: Transaction;
  onSaved: () => void;
}

/**
 * 補帳戶表單（3e W125）。專用端點只更新呼叫者自己的帳戶；VIEWER 也能使用，
 * 所以這裡不依角色隱藏表單或按鈕。
 */
export function FillAccountForm({ ledger, transaction, onSaved }: FillAccountFormProps) {
  const accounts = useAccounts();
  const setTransactionAccount = useSetTransactionAccount(ledger.id);
  const setSettlementAccount = useSetSettlementAccount(ledger.id);
  const [accountId, setAccountId] = useState('');
  const isSettlement = Boolean(transaction.settlement);
  const mutation = isSettlement ? setSettlementAccount : setTransactionAccount;
  const error = accounts.error ?? mutation.error;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (accountId === '') {
      return;
    }

    const input = { accountId };
    if (transaction.settlement) {
      setSettlementAccount.mutate(
        { settlementId: transaction.settlement.id, input },
        { onSuccess: onSaved },
      );
      return;
    }

    setTransactionAccount.mutate({ transactionId: transaction.id, input }, { onSuccess: onSaved });
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <FormError error={error} />
      <Select
        label="帳戶"
        value={accountId}
        required
        onChange={(event) => setAccountId(event.target.value)}
      >
        <option value="">選擇帳戶</option>
        {accounts.data?.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </Select>
      <div className={styles.actions}>
        <Button type="submit" disabled={accountId === '' || mutation.isPending}>
          儲存
        </Button>
      </div>
    </form>
  );
}
