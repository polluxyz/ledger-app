import { useState, type FormEvent } from 'react';
import type { CreateDebtEntryKind, CreateDebtEntryRequest, LedgerSummary } from '@ledger/shared';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormError';
import { Select } from '../../components/Select';
import { TextField } from '../../components/TextField';
import { formatAmount, formatMoney, toDateInputValue } from '../../lib/format';
import { useAccounts } from '../accounts/use-accounts';
import { CounterpartyPicker, findCounterparty } from './CounterpartyPicker';
import { useCounterparties, useCreateDebtEntry } from './use-debts';
import styles from './DebtEntryForm.module.css';

interface DebtEntryFormProps {
  ledger: LedgerSummary;
  amountFieldId?: string;
  initialCounterpartyName?: string;
}

type DebtEntryFormKind = Exclude<CreateDebtEntryKind, 'PAID_FOR_ME'>;

const KIND_OPTIONS: { value: DebtEntryFormKind; label: string }[] = [
  { value: 'LEND', label: '借出' },
  { value: 'BORROW', label: '借入' },
  { value: 'REPAYMENT', label: '還款' },
];

const ACCOUNT_LABELS: Record<DebtEntryFormKind, string> = {
  LEND: '從哪個帳戶借出',
  BORROW: '借到的錢進哪個帳戶',
  REPAYMENT: '收進哪個帳戶',
};

/**
 * 借還分頁負責收集一筆往來紀錄需要的輸入，帳戶與對象餘額仍由各自的 API hooks 提供。
 * 只有送出前的餘額預覽依 W16 在畫面上試算；紀錄成功後餘額以伺服器回應為準。
 */
export function DebtEntryForm({
  ledger,
  amountFieldId,
  initialCounterpartyName = '',
}: DebtEntryFormProps) {
  const [kind, setKind] = useState<DebtEntryFormKind>('LEND');
  const [counterpartyName, setCounterpartyName] = useState(initialCounterpartyName);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => toDateInputValue());
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [doNotRecord, setDoNotRecord] = useState(false);
  const [settle, setSettle] = useState(false);

  const counterpartiesQuery = useCounterparties({ limit: 100 });
  const counterparties = counterpartiesQuery.data?.items ?? [];
  const accounts = useAccounts();
  const createEntry = useCreateDebtEntry();

  const normalizedName = counterpartyName.trim();
  const counterparty = findCounterparty(counterpartyName, counterparties);
  const repaymentAvailable = Boolean(counterparty && counterparty.balance !== 0);
  const canSettle = kind === 'REPAYMENT';
  const showAccountField = ledger.tracksBalance;
  const needsAccount = showAccountField && !doNotRecord;
  const amountNumber = Number(amount);
  const repaymentOverage =
    kind === 'REPAYMENT' &&
    counterparty &&
    Number.isFinite(amountNumber) &&
    amountNumber > Math.abs(counterparty.balance)
      ? amountNumber - Math.abs(counterparty.balance)
      : null;
  const repaymentExceedsBalance = repaymentOverage !== null && !settle;
  const submitDisabled =
    normalizedName === '' ||
    amount === '' ||
    !(amountNumber > 0) ||
    (needsAccount && accountId === '') ||
    (kind === 'REPAYMENT' && !repaymentAvailable) ||
    repaymentExceedsBalance ||
    createEntry.isPending;

  let repaymentHint: string | null = null;
  if (normalizedName !== '') {
    if (kind === 'REPAYMENT') {
      repaymentHint =
        counterparty && counterparty.balance > 0
          ? `${counterparty.name}還你`
          : counterparty && counterparty.balance < 0
            ? `你還${counterparty.name}`
            : '目前沒有欠款';
    } else if (!repaymentAvailable) {
      repaymentHint = '目前沒有欠款';
    }
  }
  const accountLabel =
    kind === 'REPAYMENT' && counterparty && counterparty.balance < 0
      ? '從哪個帳戶付出'
      : ACCOUNT_LABELS[kind];

  const kindIndex = Math.max(
    KIND_OPTIONS.findIndex((option) => option.value === kind),
    0,
  );

  /** W16 唯一允許在前端加減往來金額的地方；實際餘額仍由 API 回應提供。 */
  let preview: string | null = null;
  if (normalizedName !== '' && amount !== '' && Number.isFinite(amountNumber)) {
    const before = counterparty?.balance ?? 0;
    const delta = kind === 'LEND' ? amountNumber : -amountNumber;
    const repaymentDelta = before > 0 ? -amountNumber : amountNumber;
    const after = before + (kind === 'REPAYMENT' ? repaymentDelta : delta);

    if (canSettle && settle) {
      if (after === 0) {
        preview = '記完後兩清';
      } else {
        const difference = -after;
        const sign = difference < 0 ? '−' : '+';
        const absoluteDifference = Math.abs(difference);
        const description =
          before > 0 ? (difference < 0 ? '少收' : '多收') : difference > 0 ? '少付' : '多付';
        preview = `記完後兩清，差額 ${sign}${formatAmount(absoluteDifference)}（${description} ${formatAmount(absoluteDifference)} 元）`;
      }
    } else if (repaymentExceedsBalance && repaymentOverage !== null) {
      preview = `超過欠款 ${formatMoney(repaymentOverage)}。要兩清請勾『以此結清』，或把多出的部分記成${before > 0 ? '借入' : '借出'}`;
    } else if (after === 0) {
      preview = '記完後：兩清';
    } else if (after > 0) {
      preview = `記完後：${counterparty?.name ?? normalizedName}欠你 ${formatMoney(after)}`;
    } else {
      preview = `記完後：你欠${counterparty?.name ?? normalizedName} ${formatMoney(Math.abs(after))}`;
    }
  }

  function handleKindChange(nextKind: DebtEntryFormKind) {
    setKind(nextKind);
    // 結清只適用還款；切換種類時清掉，避免勾選套用到下一筆。
    setSettle(false);
  }

  function handleCounterpartyChange(nextName: string) {
    setCounterpartyName(nextName);
    const nextCounterparty = findCounterparty(nextName, counterparties);
    if (kind === 'REPAYMENT' && (nextName.trim() === '' || nextCounterparty?.balance === 0)) {
      setKind('LEND');
      setSettle(false);
    }
  }

  function handleCounterpartyBlur() {
    if (kind === 'REPAYMENT' && !repaymentAvailable) {
      setKind('LEND');
      setSettle(false);
    }
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
            ...(ledger.tracksBalance ? { accountId } : {}),
          },
      ...(note === '' ? {} : { note }),
      ...(canSettle && settle ? { settle: true } : {}),
    };

    createEntry.mutate(request, {
      onSuccess: (response) => {
        // 一個對象常會連續記多筆；保留對象與種類，只清掉每筆通常不同的內容。
        setAmount('');
        setNote('');
        if (kind === 'REPAYMENT' && response.counterparty.balance === 0) {
          setKind('LEND');
          setSettle(false);
        }
      },
    });
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <FormError error={createEntry.error} />

      <div onBlur={handleCounterpartyBlur}>
        <CounterpartyPicker
          value={counterpartyName}
          onChange={handleCounterpartyChange}
          counterparties={counterparties}
        />
      </div>

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
            aria-label={option.label}
            disabled={option.value === 'REPAYMENT' && !repaymentAvailable}
            onClick={() => handleKindChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {repaymentHint && (
        <p className={styles.repaymentHint} role="status">
          {repaymentHint}
        </p>
      )}

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
          label={accountLabel}
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

      <TextField
        label="備註（選填）"
        value={note}
        maxLength={500}
        onChange={(event) => setNote(event.target.value)}
      />

      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={doNotRecord}
          onChange={(event) => setDoNotRecord(event.target.checked)}
        />
        不記入帳本
      </label>

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
