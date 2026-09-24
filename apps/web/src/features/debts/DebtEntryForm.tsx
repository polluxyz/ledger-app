import { useId, useState, type FormEvent } from 'react';
import type { Debt, LedgerSummary } from '@ledger/shared';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormError';
import { Select } from '../../components/Select';
import { TextField } from '../../components/TextField';
import { formatMoney, toDateInputValue } from '../../lib/format';
import { useAccounts } from '../accounts/use-accounts';
import { useCreateDebt, useCreateDebtPayment, useDebtSummary, useDebts } from './use-debts';
import {
  canSubmitPayment,
  emptyPaymentDraft,
  PaymentFields,
  toPaymentRequest,
  type PaymentDraft,
} from './PaymentFields';
import styles from './DebtEntryForm.module.css';

/** 「借還」分頁裡的三種情況。還款的方向由選定的那筆債務決定，不必再選。 */
type DebtEntryKind = 'LENT' | 'BORROWED' | 'PAYMENT';

interface DebtEntryFormProps {
  ledger: LedgerSummary;
  /**
   * 金額欄的 `id`（沿用 `TransactionForm` 的慣例）：右側欄要把焦點送到金額欄，
   * 但 `TextField` 不轉發 ref，只能靠呼叫端指定的 id 去找。只在借出／借入模式
   * 生效——還款模式的金額欄屬於 `PaymentFields`，介面固定不含 id。
   */
  amountFieldId?: string;
}

/**
 * 「借還」分頁的表單：借出、借入、還款三選一（spec §4.1）。
 *
 * 借出與借入走 `POST /debts`（`useCreateDebt`），還款走
 * `POST /debts/{id}/payments`（`useCreateDebtPayment`）。真正的驗證都在後端；
 * 前端的 `required` 與停用只是體驗，失敗時由 `FormError` 顯示後端的訊息。
 *
 * ## 送出的 body 兩條關鍵規則（plan §2.4）
 *
 * - 借出／借入：勾了「這是舊債」就**不帶** `record`（省略＝不產生交易，決策 7）；
 *   沒勾就帶 `record: { ledgerId, accountId? }`。非連動帳本不帶 `accountId`。
 * - 還款：**一律明確給** `record`（要記就給帳本與帳戶，不記就給 `null`）——
 *   省略時後端會沿用本金交易的帳本與帳戶，畫面上顯示的與實際記的可能不同。
 *   這一段組裝集中在 `PaymentFields` 的 `toPaymentRequest`。
 *
 * ## 舊債為什麼是勾選框、預設不勾（W8）
 *
 * 誤選舊債會讓帳戶餘額對不起來（本金不會記進任何帳戶），所以必須是明確的
 * 動作，不能是預設值。
 */
export function DebtEntryForm({ ledger, amountFieldId }: DebtEntryFormProps) {
  const [kind, setKind] = useState<DebtEntryKind>('LENT');

  // 借出／借入的欄位。金額以字串保存，送出前才轉數字（比照 TransactionForm）。
  const [counterpartyName, setCounterpartyName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => toDateInputValue());
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [isOldDebt, setIsOldDebt] = useState(false);

  // 還款的欄位：選定的債務 id + 它的還款草稿。草稿跟著債務走（換債務就重設），
  // 因為金額預設值（未清餘額）與「以此結清」的判斷都取自那筆債務。
  const [paymentDebtId, setPaymentDebtId] = useState('');
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft | null>(null);

  const nameListId = useId();
  const accounts = useAccounts();
  const summary = useDebtSummary();
  const openDebts = useDebts({ status: 'OPEN', limit: 100 });
  const createDebt = useCreateDebt();
  const createDebtPayment = useCreateDebtPayment();

  const isPayment = kind === 'PAYMENT';
  const pending = isPayment ? createDebtPayment.isPending : createDebt.isPending;
  const error = isPayment ? createDebtPayment.error : createDebt.error;

  /**
   * 選定的債務**每次 render 都從查詢結果找**，而不是存成物件：記完一筆還款後
   * `use-debts` 會讓快取失效重取，未清餘額才會跟著更新；存物件會停在舊數字。
   */
  const selectedDebt = openDebts.data?.items.find((debt) => debt.id === paymentDebtId) ?? null;

  /** 帳戶欄照 `TransactionForm` 的慣例：沒主動選過就落到第一個帳戶。 */
  const selectedAccountId = ledger.tracksBalance ? accountId || (accounts.data?.[0]?.id ?? '') : '';

  const kindOptions: { value: DebtEntryKind; label: string }[] = [
    { value: 'LENT', label: '借出' },
    { value: 'BORROWED', label: '借入' },
    { value: 'PAYMENT', label: '還款' },
  ];
  const selectedKindIndex = Math.max(
    kindOptions.findIndex((option) => option.value === kind),
    0,
  );

  /** 換一筆債務就重設草稿：金額預設為**那一筆**的未清餘額（API 給的數字，W9）。 */
  function handlePaymentDebtChange(debtId: string) {
    setPaymentDebtId(debtId);
    const debt = openDebts.data?.items.find((item) => item.id === debtId);
    setPaymentDraft(debt ? emptyPaymentDraft(debt) : null);
  }

  function handleSubmitDebt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // 這個 handler 只掛在借出／借入的表單上；early return 同時讓 TS 收窄型別。
    if (kind === 'PAYMENT') {
      return;
    }

    createDebt.mutate(
      {
        direction: kind,
        counterpartyName,
        principal: Number(amount),
        // <input type="date"> 給的是 YYYY-MM-DD，補成後端要的 ISO 8601。
        date: new Date(date).toISOString(),
        ...(note === '' ? {} : { note }),
        // 舊債不帶 record（＝明確不產生交易）；沒勾就記進作用中帳本。
        ...(isOldDebt
          ? {}
          : {
              record: {
                ledgerId: ledger.id,
                // 非連動帳本不可帶 accountId（後端回 400 ACCOUNT_NOT_ALLOWED）。
                ...(ledger.tracksBalance ? { accountId: selectedAccountId } : {}),
              },
            }),
      },
      {
        onSuccess: () => {
          // 清空每筆都不同的欄位、留在同一個選項，方便連續記（比照 TransactionForm）。
          setCounterpartyName('');
          setAmount('');
          setNote('');
        },
      },
    );
  }

  function handleSubmitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDebt || !paymentDraft) {
      return;
    }
    // 送出鈕已用同一個判斷停用；這裡再擋一次，避免用 Enter 繞過停用的邊角。
    if (!canSubmitPayment(paymentDraft, selectedDebt, ledger)) {
      return;
    }

    createDebtPayment.mutate(
      { debtId: selectedDebt.id, input: toPaymentRequest(paymentDraft, selectedDebt, ledger) },
      {
        onSuccess: () => {
          // 那筆債務可能已結清、從未結清清單消失，回到「請選擇」最乾淨。
          setPaymentDebtId('');
          setPaymentDraft(null);
        },
      },
    );
  }

  return (
    <div>
      {/* 三選一的分段控制，樣式與互動比照 TransactionForm 的型別列（滑動方塊）。 */}
      <div className={styles.types}>
        <span className={styles.thumbTrack} aria-hidden="true">
          <span
            className={styles.thumb}
            style={{
              width: `${100 / kindOptions.length}%`,
              transform: `translateX(${selectedKindIndex * 100}%)`,
            }}
          />
        </span>
        {kindOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={styles.type}
            aria-pressed={kind === option.value}
            onClick={() => setKind(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <FormError error={error} />

      {isPayment ? (
        <>
          {openDebts.error && <FormError error={openDebts.error} />}
          {!openDebts.isLoading && (openDebts.data?.items.length ?? 0) === 0 ? (
            /* 沒有未結清的債務就沒有東西可以還：與其放一個空下拉，不如說清楚。 */
            <p className={styles.notice}>目前沒有未結清的借還，無法記還款。</p>
          ) : (
            <form onSubmit={handleSubmitPayment} noValidate>
              <Select
                label="債務"
                value={paymentDebtId}
                required
                onChange={(event) => handlePaymentDebtChange(event.target.value)}
              >
                <option value="">請選擇</option>
                {openDebts.data?.items.map((debt) => (
                  <option key={debt.id} value={debt.id}>
                    {debtOptionLabel(debt)}
                  </option>
                ))}
              </Select>
              {/* GET /debts 一頁最多 100 筆（plan R3）。超過時說清楚，別讓人以為就這些。 */}
              {(openDebts.data?.total ?? 0) > (openDebts.data?.items.length ?? 0) && (
                <p className={styles.hint}>未結清的借還超過 100 筆，這裡只列出最近的 100 筆。</p>
              )}

              {selectedDebt && paymentDraft && (
                <>
                  <PaymentFields
                    debt={selectedDebt}
                    ledger={ledger}
                    value={paymentDraft}
                    onChange={setPaymentDraft}
                  />
                  <div className={styles.actions}>
                    <Button
                      type="submit"
                      block
                      disabled={pending || !canSubmitPayment(paymentDraft, selectedDebt, ledger)}
                    >
                      {pending ? '新增中…' : '新增'}
                    </Button>
                  </div>
                </>
              )}
            </form>
          )}
        </>
      ) : (
        <form onSubmit={handleSubmitDebt} noValidate>
          {/*
            對方名字用 <input list> + datalist：輸入時提示既有名字（取自每人淨額），
            避免「小明」「小明 」被當成兩個人（spec §4.1）。名字本身仍是自由輸入。
          */}
          <TextField
            label="對方名字"
            list={nameListId}
            value={counterpartyName}
            required
            maxLength={100}
            onChange={(event) => setCounterpartyName(event.target.value)}
          />
          <datalist id={nameListId}>
            {/* 3b-2 之後同名的單邊與連動記錄是兩列（spec §5.4），提示只要名字，先去重。 */}
            {[...new Set(summary.data?.items.map((item) => item.counterpartyName))].map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>

          {/* 金額自成一列並放大，比照交易表單。 */}
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

          {ledger.tracksBalance ? (
            <>
              <Select
                label="帳戶"
                value={selectedAccountId}
                required
                disabled={isOldDebt}
                onChange={(event) => setAccountId(event.target.value)}
              >
                {accounts.data?.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
              {isOldDebt && <p className={styles.notice}>帳戶餘額不會變動</p>}
            </>
          ) : (
            // 非連動帳本沒有帳戶欄（規則與一般交易相同），但要說明為什麼。
            <p className={styles.notice}>這本帳本不影響你的帳戶餘額，因此不需要選擇帳戶。</p>
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
              checked={isOldDebt}
              onChange={(event) => setIsOldDebt(event.target.checked)}
            />
            這是舊債，不記入帳本
          </label>

          <div className={styles.actions}>
            <Button type="submit" block disabled={pending}>
              {pending ? '新增中…' : '新增'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** 下拉的每一項：「借給小明 · 剩 $3,000」／「向阿華借 · 剩 $1,200」（spec §4.1）。 */
function debtOptionLabel(debt: Debt): string {
  const who =
    debt.direction === 'LENT' ? `借給${debt.counterpartyName}` : `向${debt.counterpartyName}借`;
  return `${who} · 剩 ${formatMoney(debt.outstanding)}`;
}
