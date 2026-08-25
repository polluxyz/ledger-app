import type { LedgerSummary, Transaction } from '@ledger/shared';
import { Dialog } from '../../components/Dialog';
import { TransactionForm } from './TransactionForm';

interface TransactionDialogProps {
  ledger: LedgerSummary;
  /** 要編輯的那一筆；null＝彈窗關閉。 */
  transaction: Transaction | null;
  onClose: () => void;
}

/**
 * 編輯交易的彈窗外殼。
 *
 * 它只決定「開不開、標題是什麼」，表單與 mutation 都在 `TransactionForm` 裡。
 * `Dialog` 關閉時會整個卸載子樹，所以改到一半的欄位不會留到下一次開啟——
 * 這件事不必在這裡處理，也就不可能忘記。
 */
export function TransactionDialog({ ledger, transaction, onClose }: TransactionDialogProps) {
  return (
    <Dialog open={transaction !== null} title="編輯交易" onClose={onClose}>
      {transaction && (
        <TransactionForm ledger={ledger} transaction={transaction} onSaved={onClose} />
      )}
    </Dialog>
  );
}
