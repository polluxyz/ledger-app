import { isDebtTransactionType, type Transaction } from '@ledger/shared';
import { TRANSACTION_TYPE_LABELS } from '../../lib/format';

/** 交易列與編輯面板共用的標籤，讓借還與代付名稱保持一致。 */
export function getTransactionLabel(transaction: Transaction): string {
  if (transaction.debt) {
    const splitDebtLabel: Partial<Record<typeof transaction.debt.kind, string>> = {
      PAID_FOR_THEM: '代墊',
      PAID_FOR_ME: '幫我付',
      RECEIVED_FOR_THEM: '代收',
      RECEIVED_FOR_ME: '幫我收',
    };
    const debtLabel = splitDebtLabel[transaction.debt.kind];
    if (debtLabel) {
      return `${transaction.category ? `${transaction.category.name} · ` : ''}${debtLabel} · ${transaction.debt.counterpartyName}`;
    }
  }
  if (isDebtTransactionType(transaction.type) && transaction.debt) {
    return `${TRANSACTION_TYPE_LABELS[transaction.type]} · ${transaction.debt.counterpartyName}`;
  }
  return transaction.category?.name ?? TRANSACTION_TYPE_LABELS[transaction.type];
}
