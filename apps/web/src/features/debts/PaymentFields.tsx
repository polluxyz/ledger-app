import type { JSX } from 'react';
import type { CreateDebtPaymentRequest, Debt, LedgerSummary } from '@ledger/shared';
import { Select } from '../../components/Select';
import { TextField } from '../../components/TextField';
import { formatAmount, toDateInputValue } from '../../lib/format';
import { useAccounts } from '../accounts/use-accounts';
import styles from './PaymentFields.module.css';

/**
 * 還款的欄位（金額、日期、帳戶、不記入帳本、以此結清、備註）。
 *
 * 交易表單「借還」分頁的還款模式（`DebtEntryForm`）與債務詳情的「記還款」視窗
 * （B4 的 `DebtPaymentDialog`）都要錄一筆還款，欄位規則完全相同（spec §4.1），
 * 所以抽成這一個**受控**元件：草稿（`PaymentDraft`）由呼叫端持有，這裡只負責
 * 呈現與回報變更。送出的 body 組裝（`toPaymentRequest`）與體驗性的可送出判斷
 * （`canSubmitPayment`）也集中在這裡，兩個呼叫端就不會各組出一份略有出入的 body。
 *
 * ## 前端不算錢，唯一的例外是結清預覽
 *
 * 未清餘額、狀態、差額一律取自 API（spec W9）。這裡唯一的減法是「以此結清」勾選
 * 後的**送出前預覽**（`settlementPreview`）——它只是讓使用者在按下送出前看得到
 * 差額會是多少，送出後畫面上的差額一律以回應的 `settlementDifference` 為準
 * （spec SC-W10 允許的例外）。
 */

/** 還款草稿。`amount` 是輸入框裡的字串，送出前才轉成數字。 */
export interface PaymentDraft {
  /** 輸入框的字串。 */
  amount: string;
  /** YYYY-MM-DD。 */
  date: string;
  /** `''` = 尚未選。 */
  accountId: string;
  /** 「不記入帳本」。 */
  unrecorded: boolean;
  /** 「以此結清」。 */
  settles: boolean;
  note: string;
}

/** 換一筆債務時的初始草稿：金額預設為它的未清餘額（API 給的數字，W9）。 */
// 以下三個純函式與元件同檔匯出（B4 的記還款視窗共用同一份介面），因此在關閉
// react-refresh 的「一檔只匯出元件」規則：代價只是改動本檔時 HMR 會整頁刷新，
// 而不是無法局部更新——比起拆檔讓兩個呼叫端各匯一半，這樣的取捨划算。
// eslint-disable-next-line react-refresh/only-export-components
export function emptyPaymentDraft(debt: Debt): PaymentDraft {
  return {
    amount: String(debt.outstanding),
    date: toDateInputValue(),
    accountId: '',
    unrecorded: false,
    settles: false,
    note: '',
  };
}

interface PaymentFieldsProps {
  debt: Debt;
  ledger: LedgerSummary;
  value: PaymentDraft;
  onChange: (next: PaymentDraft) => void;
}

export function PaymentFields({ debt, ledger, value, onChange }: PaymentFieldsProps): JSX.Element {
  const accounts = useAccounts();

  const amount = Number(value.amount);
  /** 金額剛好等於未清餘額時本來就會結清，勾選框沒有意義，整個不渲染。 */
  const settlesVisible = amount !== debt.outstanding;
  const overpaid = amount > debt.outstanding;

  function update(patch: Partial<PaymentDraft>): void {
    onChange({ ...value, ...patch });
  }

  return (
    <div>
      {/* 金額自成一列並放大，比照交易表單：它是這張表單唯一非填不可的數字。 */}
      <div className={styles.amount}>
        <TextField
          label="金額"
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={value.amount}
          required
          onChange={(event) => update({ amount: event.target.value })}
        />
      </div>

      <TextField
        label="日期"
        type="date"
        value={value.date}
        required
        onChange={(event) => update({ date: event.target.value })}
      />

      {/*
        帳戶欄刻意**不預選**（spec §4.1、假設 1）：借出記現金、還款走轉帳或
        LINE Pay 是常態，預設反而會把錢記錯地方。所以第一格是「請選擇」、必填。
        標籤照方向講清楚錢的流向：借出的債務是「收款」，借入的是「付款」。
      */}
      {ledger.tracksBalance ? (
        <>
          <Select
            label={debt.direction === 'LENT' ? '收款帳戶' : '付款帳戶'}
            value={value.accountId}
            required
            disabled={value.unrecorded}
            onChange={(event) => update({ accountId: event.target.value })}
          >
            <option value="">請選擇</option>
            {accounts.data?.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
          <p className={styles.hint}>
            {debt.direction === 'LENT' ? '這筆錢會收進哪個帳戶' : '這筆錢會從哪個帳戶付出'}
          </p>
          {value.unrecorded && <p className={styles.notice}>帳戶餘額不會變動</p>}
        </>
      ) : (
        <p className={styles.notice}>這本帳本不影響你的帳戶餘額，因此不需要選擇帳戶。</p>
      )}

      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={value.unrecorded}
          onChange={(event) => update({ unrecorded: event.target.checked })}
        />
        不記入帳本
      </label>

      {/*
        「以此結清」：金額等於未清餘額時不渲染（本來就會結清）；少於時顯示、
        預設不勾；多於時顯示並提示必須勾了才送得出去（不勾送出會得到後端的
        409 DEBT_OVERPAYMENT，這裡先講清楚，少撞一次牆）。
      */}
      {settlesVisible && (
        <div className={styles.settle}>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={value.settles}
              onChange={(event) => update({ settles: event.target.checked })}
            />
            以此結清
          </label>
          {overpaid && <p className={styles.hint}>超過未清餘額，要以此結清才能送出</p>}
          {value.settles && <p className={styles.preview}>{settlementPreview(debt, amount)}</p>}
        </div>
      )}

      <TextField
        label="備註（選填）"
        value={value.note}
        maxLength={500}
        onChange={(event) => update({ note: event.target.value })}
      />
    </div>
  );
}

/**
 * 「以此結清」勾選後的差額預覽。
 *
 * 這是整個 Web 前端**唯一允許的相減**（spec SC-W10 的例外）：`金額 − 未清餘額`，
 * 只為了讓使用者在送出前看得到差額。送出後的差額一律取自 API 回應的
 * `settlementDifference`，這裡的數字不會被用在送出的 body 或任何畫面上的餘額。
 *
 * 正負號照 API 的慣例**從擁有者的角度看**（正數＝對我有利），但文字寫成白話：
 * 借出時「對方少還／多給」，借入時「我少付／多付」（spec §4.1）。
 */
function settlementPreview(debt: Debt, amount: number): string {
  const difference = amount - debt.outstanding;
  const magnitude = formatAmount(Math.abs(difference));
  if (debt.direction === 'LENT') {
    return difference < 0
      ? `差額 -${magnitude}：對方少還 ${magnitude} 元，這筆借還會結清`
      : `差額 +${magnitude}：對方多給 ${magnitude} 元，這筆借還會結清`;
  }
  return difference < 0
    ? `差額 +${magnitude}：我少付 ${magnitude} 元，這筆借還會結清`
    : `差額 -${magnitude}：我多付 ${magnitude} 元，這筆借還會結清`;
}

/** 「以此結清」的勾選框此刻有沒有畫出來——`settles` 只在畫出來且勾了才送。 */
function settleCheckboxVisible(draft: PaymentDraft, debt: Debt): boolean {
  return Number(draft.amount) !== debt.outstanding;
}

/** 把草稿組成 `POST /debts/{id}/payments` 的 body。 */
// eslint-disable-next-line react-refresh/only-export-components
export function toPaymentRequest(
  draft: PaymentDraft,
  debt: Debt,
  ledger: LedgerSummary,
): CreateDebtPaymentRequest {
  return {
    amount: Number(draft.amount),
    // <input type="date"> 給的是 YYYY-MM-DD，補成後端要的 ISO 8601。
    date: new Date(draft.date).toISOString(),
    // 備註空字串就不帶——帶了也只是存一個空字串，沒有意義。
    ...(draft.note === '' ? {} : { note: draft.note }),
    /*
      record **一定要給**（物件或 null），不可省略（plan §2.4）：省略時後端會
      沿用本金那筆交易的帳本與帳戶，畫面上顯示的與實際記進去的可能不同。
      勾了「不記入帳本」就明確給 null；非連動帳本不帶 accountId（後端會擋）。
    */
    record: draft.unrecorded
      ? null
      : { ledgerId: ledger.id, ...(ledger.tracksBalance ? { accountId: draft.accountId } : {}) },
    ...(settleCheckboxVisible(draft, debt) && draft.settles ? { settles: true } : {}),
  };
}

/**
 * 體驗性的可送出判斷：金額空白或 ≤ 0、需要帳戶但沒選、金額多於未清餘額而沒勾
 * 結清——任一成立就把送出鈕停用。真正的驗證仍在後端，這裡只為了不讓使用者
 * 撞一次 400 / 409 才知道哪裡沒填。
 */
// eslint-disable-next-line react-refresh/only-export-components
export function canSubmitPayment(draft: PaymentDraft, debt: Debt, ledger: LedgerSummary): boolean {
  const amount = Number(draft.amount);
  if (draft.amount === '' || !Number.isFinite(amount) || amount <= 0) {
    return false;
  }
  if (ledger.tracksBalance && !draft.unrecorded && draft.accountId === '') {
    return false;
  }
  return !(amount > debt.outstanding && !draft.settles);
}
