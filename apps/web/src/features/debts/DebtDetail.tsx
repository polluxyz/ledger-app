import { useState } from 'react';
import type { Debt, DebtPayment, DebtStatus, LedgerSummary } from '@ledger/shared';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FormError } from '../../components/FormError';
import { Icon } from '../../components/Icon';
import { formatAmount, formatDate, formatMoney } from '../../lib/format';
import { DebtEditDialog } from './DebtEditDialog';
import { DebtPaymentDialog } from './DebtPaymentDialog';
import { useDebt, useDeleteDebt, useDeleteDebtPayment, useForgiveDebt } from './use-debts';
import styles from './DebtDetail.module.css';

/**
 * 債務詳情（右側欄，spec §4.3、W5）。
 *
 * 從兩個地方打開：借還檢視點一列；明細檢視點一筆借還交易（`debtId` 有值時）。
 *
 * ## 前端不算錢（W9、SC-W10）
 *
 * 未清餘額、狀態、結清差額全部取自 API 回應。
 * 畫面上**絕不顯示「已還」**：那需要在前端把本金與未清餘額相減，違反原則。
 */
export interface DebtDetailProps {
  debtId: string;
  ledger: LedgerSummary;
  /** 刪除債務成功後呼叫，通知外層關閉面板回到新增狀態。 */
  onClosed: () => void;
}

const STATUS_LABELS: Record<DebtStatus, string> = {
  OPEN: '未結清',
  SETTLED: '已結清',
  FORGIVEN: '已免除',
};

/** 依後端規則與方向格式化結清差額提示文字。 */
function formatSettlementDifference(debt: Debt): string {
  const diff = debt.settlementDifference;
  if (diff === null) {
    return '';
  }
  if (diff === 0) {
    return '結清差額 0';
  }
  const magnitude = formatAmount(Math.abs(diff));
  if (debt.direction === 'LENT') {
    return diff > 0 ? `結清差額 +${magnitude}（對方多給）` : `結清差額 -${magnitude}（對方少還）`;
  }
  return diff > 0 ? `結清差額 +${magnitude}（我少付）` : `結清差額 -${magnitude}（我多付）`;
}

export function DebtDetail({ debtId, ledger, onClosed }: DebtDetailProps) {
  const debtQuery = useDebt(debtId);
  const deleteDebt = useDeleteDebt();
  const deletePayment = useDeleteDebtPayment();
  const forgiveDebt = useForgiveDebt();

  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [confirmDeleteDebt, setConfirmDeleteDebt] = useState(false);
  const [confirmForgiveDebt, setConfirmForgiveDebt] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState<DebtPayment | null>(null);

  if (debtQuery.isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }
  if (debtQuery.error) {
    return <FormError error={debtQuery.error} />;
  }
  if (!debtQuery.data) {
    return <p className={styles.status}>找不到這筆借還。</p>;
  }

  const debt = debtQuery.data;
  const title =
    debt.direction === 'LENT' ? `借給${debt.counterpartyName}` : `向${debt.counterpartyName}借`;
  const isOpen = debt.status === 'OPEN';
  const canForgive = debt.direction === 'LENT' && isOpen;

  function handleDeleteDebt() {
    deleteDebt.mutate(debt.id, {
      onSuccess: () => {
        setConfirmDeleteDebt(false);
        onClosed();
      },
    });
  }

  function handleForgiveDebt() {
    forgiveDebt.mutate(debt.id, {
      onSuccess: () => {
        setConfirmForgiveDebt(false);
      },
    });
  }

  function handleDeletePayment() {
    if (!paymentToDelete) {
      return;
    }
    deletePayment.mutate(
      { debtId: debt.id, paymentId: paymentToDelete.id },
      {
        onSuccess: () => {
          setPaymentToDelete(null);
        },
      },
    );
  }

  return (
    <div className={styles.detail}>
      <div className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
        <span className={styles.statusBadge}>{STATUS_LABELS[debt.status]}</span>
      </div>

      <div className={styles.facts}>
        <div className={styles.factRow}>
          <span className={styles.factLabel}>日期</span>
          <span className={styles.factValue}>{formatDate(debt.date)}</span>
        </div>
        <div className={styles.factRow}>
          <span className={styles.factLabel}>本金</span>
          <span className={styles.factValue}>{formatMoney(debt.principal)}</span>
        </div>
        <div className={styles.factRow}>
          {/* 已免除時 API 照樣回傳算出的餘額，那是「被免除掉的金額」，不是還要收的錢。 */}
          <span className={styles.factLabel}>
            {debt.status === 'FORGIVEN' ? '已免除金額' : '未清餘額'}
          </span>
          <span className={styles.factValue}>{formatMoney(debt.outstanding)}</span>
        </div>
        {debt.note && (
          <div className={styles.factRow}>
            <span className={styles.factLabel}>備註</span>
            <span className={styles.factValue}>{debt.note}</span>
          </div>
        )}
      </div>

      {debt.settlementDifference !== null && (
        <p className={styles.settlementDiff}>{formatSettlementDifference(debt)}</p>
      )}

      {/* 動作按鈕依狀態顯示（spec §4.3） */}
      <div className={styles.actions}>
        {isOpen && <Button onClick={() => setShowPaymentDialog(true)}>記還款</Button>}
        <Button variant="secondary" onClick={() => setShowEditDialog(true)}>
          編輯
        </Button>
        {canForgive && (
          <Button variant="secondary" onClick={() => setConfirmForgiveDebt(true)}>
            免除剩餘
          </Button>
        )}
        <Button variant="secondary" onClick={() => setConfirmDeleteDebt(true)}>
          刪除
        </Button>
      </div>

      {/* 還款紀錄列表 */}
      <div className={styles.payments}>
        <h4 className={styles.paymentsTitle}>還款紀錄</h4>
        {debt.payments.length === 0 ? (
          <p className={styles.status}>尚無還款紀錄</p>
        ) : (
          <ul className={styles.paymentList}>
            {debt.payments.map((payment) => (
              <li key={payment.id} className={styles.paymentItem}>
                <div className={styles.paymentMain}>
                  <span className={styles.paymentDate}>{formatDate(payment.date)}</span>
                  <span className={styles.paymentAmount}>{formatMoney(payment.amount)}</span>
                  {payment.settles && <span className={styles.settledBadge}>結清</span>}
                  {payment.note && <span className={styles.paymentNote}>{payment.note}</span>}
                </div>
                <button
                  type="button"
                  className={styles.deleteButton}
                  aria-label={`刪除${formatDate(payment.date)}的還款`}
                  onClick={() => setPaymentToDelete(payment)}
                >
                  <Icon name="trash" size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 彈窗與確認對話框 */}
      <DebtPaymentDialog
        debt={debt}
        ledger={ledger}
        open={showPaymentDialog}
        onClose={() => setShowPaymentDialog(false)}
      />

      <DebtEditDialog debt={debt} open={showEditDialog} onClose={() => setShowEditDialog(false)} />

      <ConfirmDialog
        open={confirmForgiveDebt}
        title="免除剩餘金額"
        message="確定要免除剩餘金額嗎？免除後不可撤銷。"
        confirmLabel="免除"
        error={forgiveDebt.error}
        isPending={forgiveDebt.isPending}
        onConfirm={handleForgiveDebt}
        onCancel={() => {
          setConfirmForgiveDebt(false);
          forgiveDebt.reset();
        }}
      />

      <ConfirmDialog
        open={confirmDeleteDebt}
        title="刪除借還"
        message="確定要刪除這筆借還嗎？連同所有還款與交易一起刪除，帳戶餘額會回到記這筆借還之前。"
        confirmLabel="刪除"
        error={deleteDebt.error}
        isPending={deleteDebt.isPending}
        onConfirm={handleDeleteDebt}
        onCancel={() => {
          setConfirmDeleteDebt(false);
          deleteDebt.reset();
        }}
      />

      <ConfirmDialog
        open={paymentToDelete !== null}
        title="刪除還款"
        message="確定要刪除這筆還款？對應的交易會一起刪除。"
        confirmLabel="刪除"
        error={deletePayment.error}
        isPending={deletePayment.isPending}
        onConfirm={handleDeletePayment}
        onCancel={() => {
          setPaymentToDelete(null);
          deletePayment.reset();
        }}
      />
    </div>
  );
}
