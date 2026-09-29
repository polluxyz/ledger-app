import { isDebtTransactionType, type Transaction } from '@ledger/shared';
import { TRANSACTION_TYPE_LABELS } from '../../lib/format';

/** 交易列與編輯面板共用的標籤，讓借還與代付名稱保持一致。 */
export function getTransactionLabel(transaction: Transaction): string {
  if (isDebtTransactionType(transaction.type) && transaction.debt) {
    return `${TRANSACTION_TYPE_LABELS[transaction.type]} · ${transaction.debt.counterpartyName}`;
  }
  if (transaction.debt && transaction.category) {
    return `${transaction.category.name} · ${transaction.debt.counterpartyName}代付`;
  }
  return transaction.category?.name ?? TRANSACTION_TYPE_LABELS[transaction.type];
}
