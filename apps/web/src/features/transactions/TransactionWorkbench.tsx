import { useEffect, useId, useRef } from 'react';
import type { LedgerSummary, Transaction } from '@ledger/shared';
import { RightPanelContent } from '../../app/RightPanel';
import { useRightPanel } from '../../app/right-panel-context';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { CounterpartyDetail } from '../debts/CounterpartyDetail';
import { TransactionDialog } from './TransactionDialog';
import { TransactionForm } from './TransactionForm';
import styles from './TransactionWorkbench.module.css';

/**
 * 右側欄顯示的目標（plan §2.5、3b-1 W5）：
 *
 * - `new`：新增表單（預設）。
 * - `transaction`：編輯一筆一般交易。
 * - `counterparty`：檢視對象的往來帳與紀錄。
 */
export type PanelTarget =
  | { kind: 'new'; debtCounterparty?: string }
  | { kind: 'transaction'; transaction: Transaction }
  | { kind: 'counterparty'; counterpartyId: string };

export interface TransactionWorkbenchProps {
  ledger: LedgerSummary;
  /** 右側欄當前顯示目標。 */
  target?: PanelTarget;
  /** @deprecated 相容舊的 editing prop */
  editing?: Transaction | null;
  /** 關閉面板（儲存成功、取消、關閉、Esc）時呼叫。 */
  onClose?: () => void;
  /** 從往來帳按「記一筆」時，要求新增表單開啟借還並預帶對象。 */
  onRecordEntry?: (name: string) => void;
  /** 對象刪除成功時，讓頁面切回新增表單。 */
  onCounterpartyDeleted?: () => void;
  /** @deprecated 相容舊的 onEditDone prop */
  onEditDone?: () => void;
}

/**
 * 右側欄的內容（spec 2i §4.5、plan D25、3b-1 W5）。
 *
 * 總覽與交易頁兩頁都要用同一個面板：頁面各自持有目標狀態，
 * 面板依 `target.kind` 渲染新增表單、交易編輯面板或債務詳情。
 *
 * ## 新增、交易編輯與債務詳情互斥
 *
 * 欄位標籤與焦點必須清晰，同一時間只會渲染其中一種內容。
 * 債務詳情以 `Dialog variant="panel"` 包裹，關閉時回到新增表單。
 *
 * ## 焦點怎麼進來（SC-35.3）
 *
 * 頁首的「＋ 新增交易」呼叫 `requestFocus()`，`focusRequest` 就加 1。這裡看到它
 * 變大才把焦點送到金額欄——初次 mount 不搶焦點。
 */
export function TransactionWorkbench({
  ledger,
  target,
  editing,
  onClose,
  onRecordEntry,
  onCounterpartyDeleted,
  onEditDone,
}: TransactionWorkbenchProps) {
  const { close, focusRequest } = useRightPanel();
  const amountFieldId = useId();
  // 初值就是目前的計數，所以「第一次 render」永遠不算一次 focus 要求。
  const seenFocusRequest = useRef(focusRequest);

  const handleClose = onClose ?? onEditDone ?? (() => {});
  const activeTarget: PanelTarget =
    target ?? (editing ? { kind: 'transaction', transaction: editing } : { kind: 'new' });

  useEffect(() => {
    if (focusRequest === seenFocusRequest.current) {
      return;
    }
    seenFocusRequest.current = focusRequest;
    const amountField = document.getElementById(amountFieldId);
    if (amountField instanceof HTMLInputElement) {
      amountField.focus({ preventScroll: true });
    }
  }, [focusRequest, amountFieldId]);

  return (
    <RightPanelContent>
      {activeTarget.kind === 'new' && (
        <div className={styles.add}>
          {/*
            收起鈕疊在表單標題那一列的右邊，而不是放進 `<legend>` 裡：legend 的文字
            就是 fieldset 的無障礙名稱，把一顆有 `aria-label` 的按鈕放進去，名稱會
            變成「新增一筆交易 收起新增面板」，既有的選取器全部對不到。
          */}
          <button
            type="button"
            className={styles.collapse}
            aria-label="收起新增面板"
            onClick={close}
          >
            <Icon name="chevronRight" size={18} />
          </button>
          <TransactionForm
            ledger={ledger}
            amountFieldId={amountFieldId}
            initialDebtCounterparty={activeTarget.debtCounterparty}
          />
        </div>
      )}
      {activeTarget.kind === 'transaction' && (
        <TransactionDialog
          key={activeTarget.transaction.id}
          ledger={ledger}
          transaction={activeTarget.transaction}
          onClose={handleClose}
        />
      )}
      {activeTarget.kind === 'counterparty' && (
        <Dialog open={true} title="借還往來" variant="panel" onClose={handleClose}>
          <CounterpartyDetail
            key={activeTarget.counterpartyId}
            counterpartyId={activeTarget.counterpartyId}
            onRecordEntry={onRecordEntry ?? (() => {})}
            onDeleted={onCounterpartyDeleted ?? handleClose}
          />
        </Dialog>
      )}
    </RightPanelContent>
  );
}
