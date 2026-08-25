import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type {
  CategoryType,
  LedgerSummary,
  Transaction,
  TransactionType,
  UpdateTransactionRequest,
} from '@ledger/shared';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormError';
import { Select } from '../../components/Select';
import { TextField } from '../../components/TextField';
import { toDateInputValue } from '../../lib/format';
import { useAccounts } from '../accounts/use-accounts';
import { useCategories } from '../categories/use-categories';
import { useCreateTransaction, useUpdateTransaction } from './use-transactions';
import styles from './TransactionForm.module.css';

interface TransactionFormProps {
  ledger: LedgerSummary;
  /** 有值＝編輯模式，欄位預填這一筆。 */
  transaction?: Transaction;
  /** 編輯成功後呼叫（通常用來關閉彈窗）。新增模式不會呼叫。 */
  onSaved?: () => void;
}

/**
 * 記一筆交易的表單，新增與編輯共用。
 *
 * 金額直接以整數送出——後端存的是帳本幣別的最小單位，而 TWD 的最小單位即為
 * 「元」，因此**不做任何換算**。
 *
 * 前端只做「體驗性」的必填與型別限制（required、type="number"）；真正的驗證
 * 一律由後端負責，失敗時原樣呈現後端訊息。
 *
 * ## 為什麼新增與編輯是同一個元件（D1）
 *
 * 欄位規則有四種組合（型別 × 帳本的 `tracksBalance`，表在
 * `packages/shared/src/types/transaction.ts`）。這種規則只該有一份實作。
 * 分成兩個表單一開始好寫，但兩邊遲早分岔，而分岔的症狀是「新增得成、編輯卻被
 * 後端 400」——很難聯想到原因。
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
export function TransactionForm({ ledger, transaction, onSaved }: TransactionFormProps) {
  const ledgerId = ledger.id;
  const isEdit = transaction !== undefined;

  const [type, setType] = useState<TransactionType>(transaction?.type ?? 'EXPENSE');
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : '');
  const [date, setDate] = useState(() =>
    toDateInputValue(transaction ? new Date(transaction.date) : undefined),
  );
  const [categoryId, setCategoryId] = useState(transaction?.category?.id ?? '');
  const [accountId, setAccountId] = useState(transaction?.account?.id ?? '');
  const [toAccountId, setToAccountId] = useState(transaction?.toAccount?.id ?? '');
  const [note, setNote] = useState(transaction?.note ?? '');

  /**
   * 轉帳沒有分類，但 hook 需要一個型別。這時沿用支出即可——分類欄位根本不會渲染，
   * 拿到的清單不會被用到。
   */
  const categoryType: CategoryType = type === 'TRANSFER' ? 'EXPENSE' : type;
  const categories = useCategories(ledgerId, categoryType);
  const accounts = useAccounts();
  const createTransaction = useCreateTransaction(ledgerId);
  const updateTransaction = useUpdateTransaction(ledgerId);
  const pending = isEdit ? updateTransaction.isPending : createTransaction.isPending;
  const error = isEdit ? updateTransaction.error : createTransaction.error;

  /**
   * 帳戶欄位鎖住＝這筆記在別人的帳戶上（D2）。
   *
   * 連動帳本的交易一定有帳戶，而 `account` 只在「帳戶不屬於目前的檢視者」時才被
   * 遮成 `null`（SC-18）。所以在連動帳本裡 `account === null` 就等於「不是我的」，
   * 不必再去比對建立者是誰。
   *
   * 這種情況下前端根本拿不到原本的帳戶 id，送出時就**不帶 `accountId`**，
   * 後端會沿用原值。若照新增模式那樣「沒選就落到第一個帳戶」，會把別人的交易
   * 悄悄搬到自己的戶頭——而且送得出去，後端不會擋。
   */
  const accountLocked = isEdit && ledger.tracksBalance && transaction.account === null;
  const showAccountField = ledger.tracksBalance && !accountLocked;

  /**
   * 帳戶是必填的。使用者若沒主動選過，就落到第一個帳戶——多數人只有一個「現金」，
   * 等於完全不用碰這個欄位。
   *
   * 刻意用「推導顯示值」而非 useEffect 去 setState：後者會多觸發一輪渲染
   * （cascading render），而 state 只需要保存使用者的明確選擇。
   */
  const selectedAccountId = showAccountField ? accountId || (accounts.data?.[0]?.id ?? '') : '';
  /** 轉入帳戶不能與轉出帳戶相同（後端回 400 TRANSFER_SAME_ACCOUNT），預設挑第一個不同的。 */
  const otherAccounts = (accounts.data ?? []).filter((account) => account.id !== selectedAccountId);
  const selectedToAccountId = showAccountField
    ? toAccountId && toAccountId !== selectedAccountId
      ? toAccountId
      : (otherAccounts[0]?.id ?? '')
    : '';

  /**
   * 轉帳只在連動帳本才有意義——非連動帳本不影響餘額，後端也會擋
   * （400 `ACCOUNT_NOT_ALLOWED`）。
   *
   * 帳戶鎖住時也不給轉帳（D3）：把別人的支出改成轉帳的話，轉出沿用他的帳戶、
   * 轉入是我的，後端會接受，變成一筆「從他的戶頭轉到我的戶頭」的交易。
   * 反方向（他的轉帳改成支出）允許，錢還留在他的帳戶；改完之後這顆鈕就消失、
   * 回不去——這個情況罕見，而且不可逆的方向是安全的那一邊。
   */
  const canTransfer = ledger.tracksBalance && !accountLocked;
  const showTransferButton = canTransfer || type === 'TRANSFER';
  /** 轉帳至少要有兩個帳戶。與其讓使用者送出後撞 400，不如先說清楚。 */
  const transferBlocked = type === 'TRANSFER' && showAccountField && otherAccounts.length === 0;

  /**
   * 切換型別時一併清掉已選分類——換了型別就是換一組分類，先前選的多半已不在清單中。
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
    // <input type="date"> 給的是 YYYY-MM-DD，補成後端要的 ISO 8601。
    const isoDate = new Date(date).toISOString();

    if (isEdit) {
      const input: UpdateTransactionRequest = {
        type,
        amount: Number(amount),
        date: isoDate,
        // 備註要清空只能送空字串——PATCH 的 undefined 代表「不動」（D8）。
        note,
        ...(type === 'TRANSFER' ? {} : { categoryId }),
        ...(showAccountField ? { accountId: selectedAccountId } : {}),
        ...(showAccountField && type === 'TRANSFER' ? { toAccountId: selectedToAccountId } : {}),
      };
      updateTransaction.mutate(
        { transactionId: transaction.id, input },
        { onSuccess: () => onSaved?.() },
      );
      return;
    }

    createTransaction.mutate(
      {
        type,
        amount: Number(amount),
        date: isoDate,
        categoryId: type === 'TRANSFER' ? undefined : categoryId,
        accountId: selectedAccountId === '' ? undefined : selectedAccountId,
        toAccountId:
          type === 'TRANSFER' && selectedToAccountId !== '' ? selectedToAccountId : undefined,
        note: note === '' ? undefined : note,
      },
      {
        onSuccess: () => {
          // 保留型別與日期，方便連續記帳；只清掉每筆都不同的欄位。
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
   *
   * 編輯別人的交易時不受影響：那時根本不需要自己的帳戶。
   */
  if (showAccountField && !accounts.isLoading && (accounts.data?.length ?? 0) === 0) {
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
    <form className={isEdit ? undefined : styles.form} onSubmit={handleSubmit} noValidate>
      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        {/* 編輯模式在彈窗裡，標題由彈窗負責，這裡再放一個會重複。 */}
        {!isEdit && <legend className={styles.legend}>新增一筆交易</legend>}

        <FormError error={error} />

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
          {showTransferButton && (
            <Button
              type="button"
              variant={type === 'TRANSFER' ? 'primary' : 'secondary'}
              aria-pressed={type === 'TRANSFER'}
              onClick={() => handleTypeChange('TRANSFER')}
            >
              轉帳
            </Button>
          )}
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

        {/* 轉帳沒有分類（「從銀行領錢」不屬於任何消費類別），欄位整個不渲染。 */}
        {type !== 'TRANSFER' && (
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
        )}

        {/* 非連動帳本沒有帳戶欄位。停用而非移除是不夠的——後端連「帶著空值」都會
            擋下（400 ACCOUNT_NOT_ALLOWED），而且一個停用的欄位會讓人以為
            「應該要能選，只是現在不行」。 */}
        {showAccountField ? (
          <>
            <Select
              label={type === 'TRANSFER' ? '轉出帳戶' : '帳戶'}
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
            {type === 'TRANSFER' &&
              (transferBlocked ? (
                <p className={styles.notice}>
                  轉帳需要兩個帳戶，目前只有一個。<Link to="/accounts">前往新增帳戶</Link>
                </p>
              ) : (
                <Select
                  label="轉入帳戶"
                  value={selectedToAccountId}
                  required
                  onChange={(event) => setToAccountId(event.target.value)}
                >
                  {otherAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </Select>
              ))}
          </>
        ) : accountLocked ? (
          // 別人的帳戶對我是遮蔽的，改不了也顯示不了（D2）。這裡說出原因，
          // 而不是放一個永遠停用的下拉——那會讓人以為只是暫時不能選。
          <p className={styles.notice}>這筆記在其他成員的帳戶，帳戶無法變更。</p>
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

        <Button type="submit" block disabled={pending || transferBlocked}>
          {pending ? (isEdit ? '儲存中…' : '新增中…') : isEdit ? '儲存' : '新增'}
        </Button>
      </fieldset>
    </form>
  );
}
