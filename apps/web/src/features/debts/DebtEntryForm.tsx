import { useState, type FormEvent } from 'react';
import type { LedgerSummary, ManualDebtEntryKind, CreateDebtEntryRequest } from '@ledger/shared';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormError';
import { Select } from '../../components/Select';
import { TextField } from '../../components/TextField';
import { formatAmount, formatMoney, toDateInputValue } from '../../lib/format';
import { useAccounts } from '../accounts/use-accounts';
import { useCategories } from '../categories/use-categories';
import { CounterpartyPicker, findCounterparty } from './CounterpartyPicker';
import { useCounterparties, useCreateDebtEntry } from './use-debts';
import styles from './DebtEntryForm.module.css';

interface DebtEntryFormProps {
  ledger: LedgerSummary;
  amountFieldId?: string;
  initialCounterpartyName?: string;
}

const KIND_OPTIONS: { value: ManualDebtEntryKind; label: string }[] = [
  { value: 'LEND', label: '借出' },
  { value: 'BORROW', label: '借入' },
  { value: 'COLLECT', label: '對方還我' },
  { value: 'REPAY', label: '我還對方' },
  { value: 'PAID_FOR_ME', label: '對方幫我付' },
];

const ACCOUNT_LABELS: Record<Exclude<ManualDebtEntryKind, 'PAID_FOR_ME'>, string> = {
  LEND: '從哪個帳戶借出',
  BORROW: '借到的錢進哪個帳戶',
  COLLECT: '收進哪個帳戶',
  REPAY: '從哪個帳戶付出',
};

/**
 * 借還分頁負責收集一筆往來紀錄需要的輸入，帳戶與分類選項仍由各自的 API hooks 提供。
 * 只有送出前的餘額預覽依 W16 在畫面上試算；紀錄成功後餘額以伺服器回應為準。
 */
export function DebtEntryForm({
  ledger,
  amountFieldId,
  initialCounterpartyName = '',
}: DebtEntryFormProps) {
  const [kind, setKind] = useState<ManualDebtEntryKind>('LEND');
  const [counterpartyName, setCounterpartyName] = useState(initialCounterpartyName);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => toDateInputValue());
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [note, setNote] = useState('');
  const [doNotRecord, setDoNotRecord] = useState(false);
  const [settle, setSettle] = useState(false);

  const counterpartiesQuery = useCounterparties({ limit: 100 });
  const counterparties = counterpartiesQuery.data?.items ?? [];
  const accounts = useAccounts();
  const categories = useCategories(ledger.id, 'EXPENSE');
  const createEntry = useCreateDebtEntry();

  const normalizedName = counterpartyName.trim();
  const counterparty = findCounterparty(counterpartyName, counterparties);
  const isPaidForMe = kind === 'PAID_FOR_ME';
  const canSettle = kind === 'COLLECT' || kind === 'REPAY';
  const showAccountField = ledger.tracksBalance && !isPaidForMe;
  const needsAccount = showAccountField && !doNotRecord;
  const amountNumber = Number(amount);
  const submitDisabled =
    normalizedName === '' ||
    amount === '' ||
    !(amountNumber > 0) ||
    (needsAccount && accountId === '') ||
    (isPaidForMe && categoryId === '') ||
    createEntry.isPending;

  const kindIndex = Math.max(
    KIND_OPTIONS.findIndex((option) => option.value === kind),
    0,
  );

  /** W16 唯一允許在前端加減往來金額的地方；實際餘額仍由 API 回應提供。 */
  let preview: string | null = null;
  if (normalizedName !== '' && amount !== '' && Number.isFinite(amountNumber)) {
    const before = counterparty?.balance ?? 0;
    const delta = kind === 'LEND' || kind === 'REPAY' ? amountNumber : -amountNumber;
    const after = before + delta;

    if (canSettle && settle) {
      if (after === 0) {
        preview = '記完後兩清';
      } else {
        const difference = -after;
        const sign = difference < 0 ? '−' : '+';
        const absoluteDifference = Math.abs(difference);
        const description =
          kind === 'COLLECT'
            ? difference < 0
              ? '少收'
              : '多收'
            : difference > 0
              ? '少付'
              : '多付';
        preview = `記完後兩清，差額 ${sign}${formatAmount(absoluteDifference)}（${description} ${formatAmount(absoluteDifference)} 元）`;
      }
    } else if (after === 0) {
      preview = '記完後：兩清';
    } else if (after > 0) {
      preview = `記完後：${counterparty?.name ?? normalizedName}欠你 ${formatMoney(after)}`;
    } else {
      preview = `記完後：你欠${counterparty?.name ?? normalizedName} ${formatMoney(Math.abs(after))}`;
    }
  }

  function handleKindChange(nextKind: ManualDebtEntryKind) {
    setKind(nextKind);
    // 結清與「不記入帳本」只適用部分種類；切換時清掉，避免隱藏的勾選影響下一筆。
    setSettle(false);
    setDoNotRecord(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitDisabled) {
      return;
    }

    const request: CreateDebtEntryRequest = {
      counterparty: counterparty ? { id: counterparty.id } : { name: normalizedName },
      kind,
      amount: amountNumber,
      date: new Date(date).toISOString(),
      record: doNotRecord
        ? null
        : {
            ledgerId: ledger.id,
            ...(kind !== 'PAID_FOR_ME' && ledger.tracksBalance ? { accountId } : {}),
          },
      ...(note === '' ? {} : { note }),
      ...(isPaidForMe ? { categoryId } : {}),
      ...(canSettle && settle ? { settle: true } : {}),
    };

    createEntry.mutate(request, {
      onSuccess: () => {
        // 一個對象常會連續記多筆；保留對象與種類，只清掉每筆通常不同的內容。
        setAmount('');
        setNote('');
      },
    });
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <FormError error={createEntry.error} />

      <CounterpartyPicker
        value={counterpartyName}
        onChange={setCounterpartyName}
        counterparties={counterparties}
      />

      <div className={styles.types} role="group" aria-label="往來種類">
        <span className={styles.thumbTrack} aria-hidden="true">
          <span
            className={styles.thumb}
            style={{
              width: `${100 / KIND_OPTIONS.length}%`,
              transform: `translateX(${kindIndex * 100}%)`,
            }}
          />
        </span>
        {KIND_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={styles.type}
            aria-pressed={kind === option.value}
            onClick={() => handleKindChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className={styles.amount}>
        <TextField
          label="金額"
          id={amountFieldId}
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={amount}
          required
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>

      <TextField
        label="日期"
        type="date"
        value={date}
        required
        onChange={(event) => setDate(event.target.value)}
      />

      {showAccountField && (
        <Select
          label={ACCOUNT_LABELS[kind]}
          value={accountId}
          required={!doNotRecord}
          disabled={doNotRecord}
          onChange={(event) => setAccountId(event.target.value)}
        >
          <option value="">請選擇</option>
          {accounts.data?.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      )}

      {isPaidForMe && (
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

      <TextField
        label="備註（選填）"
        value={note}
        maxLength={500}
        onChange={(event) => setNote(event.target.value)}
      />

      {!isPaidForMe && (
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={doNotRecord}
            onChange={(event) => setDoNotRecord(event.target.checked)}
          />
          不記入帳本
        </label>
      )}

      {canSettle && (
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={settle}
            onChange={(event) => setSettle(event.target.checked)}
          />
          以此結清
        </label>
      )}

      {preview && (
        <p className={styles.preview} role="status">
          {preview}
        </p>
      )}

      <div className={styles.actions}>
        <Button type="submit" block disabled={submitDisabled}>
          {createEntry.isPending ? '新增中…' : '新增'}
        </Button>
      </div>
    </form>
  );
}
