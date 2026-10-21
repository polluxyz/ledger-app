import { isDebtTransactionType, type Transaction } from '@ledger/shared';

/** 判斷「複製」是否可用；這只控制畫面入口，存檔仍交給既有 API 驗證。 */
export function canCopyTransaction(transaction: Transaction): boolean {
  return (
    !isDebtTransactionType(transaction.type) &&
    transaction.settlement == null &&
    transaction.merge?.share == null
  );
}

/** 與一般交易編輯表單相同：往來紀錄不能由交易端點刪除，合併來的交易可以。 */
export function canDeleteTransactionFromEditor(transaction: Transaction): boolean {
  return transaction.merge !== null || transaction.debt === null;
}
