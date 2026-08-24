import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { CategoryType, LedgerSummary } from '@ledger/shared';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormError';
import { Select } from '../../components/Select';
import { TextField } from '../../components/TextField';
import { toDateInputValue } from '../../lib/format';
import { useAccounts } from '../accounts/use-accounts';
import { useCategories } from '../categories/use-categories';
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
 *
 * 目前只支援支出與收入。轉帳（TRANSFER）需要「轉入帳戶」欄位與另一套欄位規則，
 * 留待後續切片。
 *
 * ## 為什麼收的是整個 `ledger` 而不只是 id（SC-16）
 *
 * 帳戶欄位存不存在，取決於這本帳本的 `tracksBalance`：
 *
 * - **連動帳本**：帳戶必填，不給就是 400 `ACCOUNT_REQUIRED`。
 * - **非連動帳本**：帳戶不可給，給了就是 400 `ACCOUNT_NOT_ALLOWED`。
 *
 * 所以欄位不能只是「停用」，必須整個不存在，送出的 body 也不能帶 `accountId`。
 */
export function TransactionForm({ ledger }: { ledger: LedgerSummary }) {
  const ledgerId = ledger.id;
  const [type, setType] = useState<CategoryType>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => toDateInputValue());
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');

  const categories = useCategories(ledgerId, type);
  const accounts = useAccounts();
  const createTransaction = useCreateTransaction(ledgerId);

  /**
   * 帳戶是必填的。使用者若沒主動選過，就落到第一個帳戶——多數人只有一個「現金」，
   * 等於完全不用碰這個欄位。
   *
   * 刻意用「推導顯示值」而非 useEffect 去 setState：後者會多觸發一輪渲染
   * （cascading render），而 state 只需要保存使用者的明確選擇。
   */
  const selectedAccountId = ledger.tracksBalance ? accountId || (accounts.data?.[0]?.id ?? '') : '';

  /**
   * 切換收入 / 支出時一併清掉已選分類——換了 type 就是換一組分類，
   * 先前選的多半已不在清單中。
   *
   * 刻意在事件處理裡一次改完，而非用 useEffect 事後補救：後者會多觸發一輪
   * 渲染（cascading render），React 也不建議這樣用。
   */
  function handleTypeChange(nextType: CategoryType) {
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
        accountId: selectedAccountId === '' ? undefined : selectedAccountId,
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

  /**
   * 帳戶可以被刪光（後端只擋「有交易引用」的），但連動帳本的交易必須指定帳戶。
   * 那時若照常渲染表單，使用者面對的是一個空的下拉，按下送出必定得到 400，
   * 而畫面上沒有任何線索說明原因——解法還在另一個頁面。所以直接換成引導。
   */
  if (ledger.tracksBalance && !accounts.isLoading && (accounts.data?.length ?? 0) === 0) {
    return (
      <section className={styles.form}>
        <p className={styles.legend}>新增一筆交易</p>
        <p className={styles.blocked}>
          記帳前要先有一個帳戶。<Link to="/accounts">前往新增帳戶</Link>
        </p>
      </section>
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

        {/* 非連動帳本沒有帳戶欄位。停用而非移除是不夠的——後端連「帶著空值」都會
            擋下（400 ACCOUNT_NOT_ALLOWED），而且一個停用的欄位會讓人以為
            「應該要能選，只是現在不行」。 */}
        {ledger.tracksBalance ? (
          <Select
            label="帳戶"
            value={selectedAccountId}
            required
            onChange={(event) => setAccountId(event.target.value)}
          >
            {accounts.data?.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        ) : (
          // 記完帳餘額不會變，那是正常的。不講清楚的話，看起來像是壞了。
          <p className={styles.notice}>這本帳本不影響你的帳戶餘額，因此不需要選擇帳戶。</p>
        )}

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
