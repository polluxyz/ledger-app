import type { LedgerSummary, Transaction } from '@ledger/shared';
import { Dialog } from '../../components/Dialog';
import { TransactionForm } from './TransactionForm';

interface TransactionDialogProps {
  ledger: LedgerSummary;
  /** 要編輯的那一筆；null＝面板關閉。 */
  transaction: Transaction | null;
  onClose: () => void;
}

/**
 * 編輯交易的面板外殼。
 *
 * 它只決定「開不開、標題是什麼」，表單與 mutation 都在 `TransactionForm` 裡。
 * `Dialog` 關閉時會整個卸載子樹，所以改到一半的欄位不會留到下一次開啟——
 * 這件事不必在這裡處理，也就不可能忘記。
 *
 * **`variant="panel"`（phase-2h · D8）**：編輯表單嵌在首頁右側，不蓋住列表，
 * 使用者可以邊看列表邊改，也可以直接點另一列換過去。角色仍是 `dialog`、名稱
 * 仍是「編輯交易」，既有的選取器照樣對得到。
 *
 * 關閉的四條路（儲存成功、關閉鈕、Esc、取消）都走同一個 `onClose`——面板回到
 * 新增表單、焦點回到原本那顆按鈕，這些由 `Dialog` 的 panel 變體負責。
 */
export function TransactionDialog({ ledger, transaction, onClose }: TransactionDialogProps) {
  return (
    <Dialog open={transaction !== null} title="編輯交易" variant="panel" onClose={onClose}>
      {transaction && (
        <TransactionForm
          ledger={ledger}
          transaction={transaction}
          onSaved={onClose}
          onCancel={onClose}
        />
      )}
    </Dialog>
  );
}
