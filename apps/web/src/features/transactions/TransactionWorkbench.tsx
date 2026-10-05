import { useEffect, useId, useRef, useState } from 'react';
import type { Cents, LedgerSummary, Transaction } from '@ledger/shared';
import { RightPanelContent } from '../../app/RightPanel';
import { useRightPanel } from '../../app/right-panel-context';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';
import { CounterpartyDetail } from '../debts/CounterpartyDetail';
import { DebtEntryEditForm } from '../debts/DebtEntryEditDialog';
import { TransactionDialog } from './TransactionDialog';
import { TransactionForm } from './TransactionForm';
import { SplitEditPanel } from './SplitEditPanel';
import { getTransactionLabel } from './transaction-label';
import { FillAccountForm } from '../settlements/FillAccountForm';
import { SettlementForm } from '../settlements/SettlementForm';
import styles from './TransactionWorkbench.module.css';

/**
 * 右側欄顯示的目標（plan §2.5、3b-1 W5）：
 *
 * - `new`：新增表單（預設）。
 * - `transaction`：編輯一筆一般交易。
 * - `counterparty`：檢視對象的往來帳與紀錄。
 * - `debtTransaction`：編輯一筆往來紀錄產生的交易。
 * - `settlement`：共享帳本的結清表單（3e W116～W121）。帶 `settlement`＝編輯那一筆結清
 *   （`transaction.settlement` 有值的交易）；帶 `prefill`＝從結清建議打開；兩者都沒有＝空白新增。
 * - `fillAccount`：補帳戶（3e W125），只有一個帳戶下拉。交易本身是一般交易或結清皆可。
 */
export type PanelTarget =
  | { kind: 'new'; debtCounterparty?: string }
  | { kind: 'transaction'; transaction: Transaction }
  | { kind: 'counterparty'; counterpartyId: string }
  | { kind: 'debtTransaction'; transaction: Transaction }
  | { kind: 'settlement'; settlement?: Transaction; prefill?: SettlementPrefill }
  | { kind: 'fillAccount'; transaction: Transaction };

/** 從結清建議打開結清表單時預填的值（W119）。金額是分。 */
export interface SettlementPrefill {
  fromPersonId: string;
  toPersonId: string;
  amount: Cents;
}

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
 * 借還往來與編輯目標都以 `Dialog variant="panel"` 包裹；頁面負責關閉時收起側欄。
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
  onEditDone,
}: TransactionWorkbenchProps) {
  const { close, focusRequest } = useRightPanel();
  const amountFieldId = useId();
  // 初值就是目前的計數，所以「第一次 render」永遠不算一次 focus 要求。
  const seenFocusRequest = useRef(focusRequest);
  const [editingSplitId, setEditingSplitId] = useState<string | null>(null);

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
        <Dialog
          open={true}
          title={editingSplitId ? '編輯交易' : '借還往來'}
          variant="panel"
          onClose={editingSplitId ? () => setEditingSplitId(null) : handleClose}
        >
          {editingSplitId ? (
            <SplitEditPanel
              ledger={ledger}
              splitId={editingSplitId}
              onClose={() => setEditingSplitId(null)}
            />
          ) : (
            <CounterpartyDetail
              key={activeTarget.counterpartyId}
              counterpartyId={activeTarget.counterpartyId}
              onRecordEntry={onRecordEntry ?? (() => {})}
              onEditSplit={setEditingSplitId}
            />
          )}
        </Dialog>
      )}
      {activeTarget.kind === 'debtTransaction' && activeTarget.transaction.debt && (
        <Dialog open={true} title="編輯交易" variant="panel" onClose={handleClose}>
          <p>{getTransactionLabel(activeTarget.transaction)}</p>
          <DebtEntryEditForm
            key={activeTarget.transaction.debt.entryId}
            entryId={activeTarget.transaction.debt.entryId}
            amount={activeTarget.transaction.amount}
            date={activeTarget.transaction.date}
            note={activeTarget.transaction.debt.note}
            paired={activeTarget.transaction.debt.paired}
            displayName={activeTarget.transaction.debt.counterpartyName}
            onClose={handleClose}
          />
        </Dialog>
      )}
      {activeTarget.kind === 'settlement' && (
        <Dialog open={true} title="結清" variant="panel" onClose={handleClose}>
          <SettlementForm
            key={
              activeTarget.settlement?.id ??
              (activeTarget.prefill
                ? `${activeTarget.prefill.fromPersonId}-${activeTarget.prefill.toPersonId}-${activeTarget.prefill.amount}`
                : 'new')
            }
            ledger={ledger}
            transaction={activeTarget.settlement}
            prefill={activeTarget.prefill}
            onSaved={handleClose}
            onDeleted={handleClose}
          />
        </Dialog>
      )}
      {activeTarget.kind === 'fillAccount' && (
        <Dialog open={true} title="補帳戶" variant="panel" onClose={handleClose}>
          <FillAccountForm
            key={activeTarget.transaction.id}
            ledger={ledger}
            transaction={activeTarget.transaction}
            onSaved={handleClose}
          />
        </Dialog>
      )}
    </RightPanelContent>
  );
}
