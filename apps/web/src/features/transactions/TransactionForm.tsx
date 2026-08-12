import { useState, type FormEvent } from 'react';
import type { TransactionType } from '@ledger/shared';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormError';
import { Select } from '../../components/Select';
import { TextField } from '../../components/TextField';
import { toDateInputValue } from '../../lib/format';
import { useCategories } from '../categories/use-categories';
import { usePaymentMethods } from '../payment-methods/use-payment-methods';
import { useCreateTransaction } from './use-transactions';
import styles from './TransactionForm.module.css';

/**
 * 新增交易的表單。
 *
 * 金額直接以整數送出——後端存的是帳本幣別的最小單位，而 TWD 的最小單位即為
 * 「元」，因此**不做任何換算**。
 *
 * 前端只做「體驗性」的必填與型別限制（required、type="number"）；真正的驗證
 * 一律由後端負責，失敗時原樣呈現後端訊息。
 */
export function TransactionForm({ ledgerId }: { ledgerId: string }) {
  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => toDateInputValue());
  const [categoryId, setCategoryId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [note, setNote] = useState('');

  const categories = useCategories(ledgerId, type);
  const paymentMethods = usePaymentMethods(ledgerId);
  const createTransaction = useCreateTransaction(ledgerId);

  /**
   * 切換收入 / 支出時一併清掉已選分類——換了 type 就是換一組分類，
   * 先前選的多半已不在清單中。
   *
   * 刻意在事件處理裡一次改完，而非用 useEffect 事後補救：後者會多觸發一輪
   * 渲染（cascading render），React 也不建議這樣用。
   */
  function handleTypeChange(nextType: TransactionType) {
    setType(nextType);
    setCategoryId('');
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createTransaction.mutate(
      {
        type,
        amount: Number(amount),
        // <input type="date"> 給的是 YYYY-MM-DD，補成後端要的 ISO 8601。
        date: new Date(date).toISOString(),
        categoryId,
        paymentMethodId: paymentMethodId === '' ? undefined : paymentMethodId,
        note: note === '' ? undefined : note,
      },
      {
        onSuccess: () => {
          // 保留 type 與日期，方便連續記帳；只清掉每筆都不同的欄位。
          setAmount('');
          setNote('');
        },
      },
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend className={styles.legend}>新增一筆交易</legend>

        <FormError error={createTransaction.error} />

        <div className={styles.types}>
          <Button
            type="button"
            variant={type === 'EXPENSE' ? 'primary' : 'secondary'}
            aria-pressed={type === 'EXPENSE'}
            onClick={() => handleTypeChange('EXPENSE')}
          >
            支出
          </Button>
          <Button
            type="button"
            variant={type === 'INCOME' ? 'primary' : 'secondary'}
            aria-pressed={type === 'INCOME'}
            onClick={() => handleTypeChange('INCOME')}
          >
            收入
          </Button>
        </div>

        <div className={styles.row}>
          <TextField
            label="金額"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={amount}
            required
            onChange={(event) => setAmount(event.target.value)}
          />
          <TextField
            label="日期"
            type="date"
            value={date}
            required
            onChange={(event) => setDate(event.target.value)}
          />
        </div>

        <Select
          label="分類"
          value={categoryId}
          required
          onChange={(event) => setCategoryId(event.target.value)}
        >
          <option value="">請選擇</option>
          {categories.data?.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>

        <Select
          label="付款方式（選填）"
          value={paymentMethodId}
          onChange={(event) => setPaymentMethodId(event.target.value)}
        >
          <option value="">不指定</option>
          {paymentMethods.data?.map((paymentMethod) => (
            <option key={paymentMethod.id} value={paymentMethod.id}>
              {paymentMethod.name}
            </option>
          ))}
        </Select>

        <TextField
          label="備註（選填）"
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />

        <Button type="submit" block disabled={createTransaction.isPending}>
          {createTransaction.isPending ? '新增中…' : '新增'}
        </Button>
      </fieldset>
    </form>
  );
}
