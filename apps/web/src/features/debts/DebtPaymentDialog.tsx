import { useState, type FormEvent } from 'react';
import type { Debt, LedgerSummary } from '@ledger/shared';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { useCreateDebtPayment } from './use-debts';
import {
  canSubmitPayment,
  emptyPaymentDraft,
  PaymentFields,
  toPaymentRequest,
  type PaymentDraft,
} from './PaymentFields';
import styles from './DebtPaymentDialog.module.css';

/**
 * 債務詳情右側欄裡的「記還款」彈窗（spec §4.3、plan §2.4）。
 *
 * 債務本身已由呼叫端決定，所以不用再從下拉挑債務；還款的欄位、金額預設值、帳戶規則
 * 與「以此結清」全部共用 `PaymentFields`。
 *
 * 送出失敗時不關閉彈窗，由 `FormError` 就地顯示後端的錯誤代碼在地化訊息；成功後才關閉。
 */
export interface DebtPaymentDialogProps {
  debt: Debt;
  ledger: LedgerSummary;
  open: boolean;
  onClose: () => void;
}

export function DebtPaymentDialog({ debt, ledger, open, onClose }: DebtPaymentDialogProps) {
  if (!open) {
    return null;
  }
  return <DebtPaymentDialogContent debt={debt} ledger={ledger} onClose={onClose} />;
}

function DebtPaymentDialogContent({
  debt,
  ledger,
  onClose,
}: {
  debt: Debt;
  ledger: LedgerSummary;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<PaymentDraft>(() => emptyPaymentDraft(debt));
  const createPayment = useCreateDebtPayment();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitPayment(draft, debt, ledger)) {
      return;
    }
    createPayment.mutate(
      { debtId: debt.id, input: toPaymentRequest(draft, debt, ledger) },
      {
        onSuccess: () => {
          onClose();
        },
      },
    );
  }

  const isPending = createPayment.isPending;
  const canSubmit = canSubmitPayment(draft, debt, ledger);

  return (
    <Dialog open={true} title="記還款" onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <FormError error={createPayment.error} />
        <PaymentFields debt={debt} ledger={ledger} value={draft} onChange={setDraft} />
        <div className={styles.actions}>
          <Button type="submit" block disabled={isPending || !canSubmit}>
            {isPending ? '儲存中…' : '新增'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
