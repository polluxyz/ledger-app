import { useEffect, useId, useRef } from 'react';
import {
  actualAmountOf,
  type Cents,
  type LedgerSummary,
  type Transaction,
  type TransactionDraft,
} from '@ledger/shared';
import { RightPanelContent } from '../../app/RightPanel';
import { useRightPanel } from '../../app/right-panel-context';
import { Dialog } from '../../components/Dialog';
import { FormError } from '../../components/FormError';
import { Icon } from '../../components/Icon';
import { DebtEntryEditForm } from '../debts/DebtEntryEditDialog';
import { TransactionDialog } from './TransactionDialog';
import { TransactionForm } from './TransactionForm';
import { SplitEditPanel } from './SplitEditPanel';
import { getTransactionLabel } from './transaction-label';
import { FillAccountForm } from '../settlements/FillAccountForm';
import { SettlementForm } from '../settlements/SettlementForm';
import { isLedgerWritable, useLedgers } from '../ledgers/use-ledgers';
import styles from './TransactionWorkbench.module.css';

/**
 * 右側欄顯示的目標（plan §2.5、3b-1 W5）：
 *
 * - `new`：新增表單（預設）。
 * - `transaction`：編輯一筆一般交易。
 * - `debtTransaction`：編輯一筆往來紀錄產生的交易。
 * - `split`：編輯一筆分帳。
 * - `settlement`：首頁既有的結清編輯入口；交易頁新增結清已移到共享分頁的帳本組內。
 * - `fillAccount`：補帳戶（3e W125），只有一個帳戶下拉。交易本身是一般交易或結清皆可。
 */
export type PanelTarget =
  | { kind: 'new' }
  | { kind: 'draft'; item: { key: string; draft: TransactionDraft } }
  | { kind: 'transaction'; transaction: Transaction; initialDeleteOpen?: boolean }
  | { kind: 'copy'; transaction: Transaction }
  | { kind: 'debtTransaction'; transaction: Transaction }
  | { kind: 'split'; splitId: string }
  | { kind: 'settlement'; settlement?: Transaction; prefill?: SettlementPrefill }
  | { kind: 'fillAccount'; transaction: Transaction };

const noop = () => {};

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
  /** AI 草稿表單寫入成功後由頁面移除對應草稿。 */
  onDraftSaved?: (key: string) => void;
  /** 讓草稿列在表單送出期間鎖住同一筆，避免兩個入口同時寫入。 */
  onDraftSavingChange?: (key: string, saving: boolean) => void;
  /** @deprecated 相容舊的 onEditDone prop */
  onEditDone?: () => void;
}

/**
 * 右側欄的內容（spec 2i §4.5、plan D25、3b-1 W5）。
 *
 * 總覽與交易頁兩頁都要用同一個面板：頁面各自持有目標狀態，面板依 `target.kind`
 * 渲染新增、交易編輯、分帳編輯、首頁既有結清編輯或補帳戶內容。
 *
 * ## 各面板目標互斥
 *
 * 欄位標籤與焦點必須清晰，同一時間只會渲染一種內容；表單對話框由頁面負責關閉。
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
  onDraftSaved,
  onDraftSavingChange,
  onEditDone,
}: TransactionWorkbenchProps) {
  const { close, focusRequest, isOpen } = useRightPanel();
  const amountFieldId = useId();
  // 初值就是目前的計數，所以「第一次 render」永遠不算一次 focus 要求。
  const seenFocusRequest = useRef(focusRequest);

  const handleClose = onClose ?? onEditDone ?? noop;
  const activeTarget: PanelTarget =
    target ?? (editing ? { kind: 'transaction', transaction: editing } : { kind: 'new' });
  const ledgers = useLedgers(
    true,
    activeTarget.kind === 'debtTransaction' || activeTarget.kind === 'draft',
  );
  const debtLedger = ledgers.data?.find((item) => item.id === ledger.id);
  const draftLedger =
    activeTarget.kind === 'draft'
      ? (ledgers.data?.find((item) => item.id === activeTarget.item.draft.ledgerId) ??
        (ledger.id === activeTarget.item.draft.ledgerId ? ledger : undefined))
      : undefined;

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

  useEffect(() => {
    if (!isOpen && activeTarget.kind === 'draft') handleClose();
  }, [activeTarget.kind, handleClose, isOpen]);

  return (
    <RightPanelContent>
      {(activeTarget.kind === 'new' ||
        activeTarget.kind === 'copy' ||
        (activeTarget.kind === 'draft' && draftLedger !== undefined)) && (
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
            onClick={activeTarget.kind === 'draft' ? handleClose : close}
          >
            <Icon name="chevronRight" size={18} />
          </button>
          <TransactionForm
            key={
              activeTarget.kind === 'copy'
                ? activeTarget.transaction.id
                : activeTarget.kind === 'draft'
                  ? activeTarget.item.key
                  : 'new'
            }
            ledger={activeTarget.kind === 'draft' ? draftLedger! : ledger}
            amountFieldId={amountFieldId}
            copyFrom={activeTarget.kind === 'copy' ? activeTarget.transaction : undefined}
            draft={activeTarget.kind === 'draft' ? activeTarget.item.draft : undefined}
            onSaved={
              activeTarget.kind === 'draft'
                ? () => onDraftSaved?.(activeTarget.item.key)
                : undefined
            }
            onDraftSavingChange={
              activeTarget.kind === 'draft'
                ? (saving) => onDraftSavingChange?.(activeTarget.item.key, saving)
                : undefined
            }
          />
        </div>
      )}
      {activeTarget.kind === 'draft' && !draftLedger && (
        <p role={ledgers.isLoading ? undefined : 'alert'}>
          {ledgers.isLoading ? '載入中…' : '找不到草稿的帳本，請重新解析。'}
        </p>
      )}
      {activeTarget.kind === 'transaction' && (
        <TransactionDialog
          key={`${activeTarget.transaction.id}:${activeTarget.initialDeleteOpen ? 'delete' : 'edit'}`}
          ledger={ledger}
          transaction={activeTarget.transaction}
          initialDeleteOpen={activeTarget.initialDeleteOpen}
          onClose={handleClose}
        />
      )}
      {activeTarget.kind === 'split' && (
        <Dialog open={true} title="編輯交易" variant="panel" onClose={handleClose}>
          <SplitEditPanel ledger={ledger} splitId={activeTarget.splitId} onClose={handleClose} />
        </Dialog>
      )}
      {activeTarget.kind === 'debtTransaction' && activeTarget.transaction.debt && (
        <Dialog open={true} title="編輯交易" variant="panel" onClose={handleClose}>
          {ledgers.isLoading ? (
            <p>載入中…</p>
          ) : ledgers.error ? (
            <FormError error={ledgers.error} />
          ) : (
            isLedgerWritable(debtLedger) && (
              <>
                <p>{getTransactionLabel(activeTarget.transaction)}</p>
                <DebtEntryEditForm
                  key={activeTarget.transaction.debt.entryId}
                  entryId={activeTarget.transaction.debt.entryId}
                  amount={editableAmountOf(activeTarget.transaction)}
                  date={activeTarget.transaction.date}
                  note={activeTarget.transaction.debt.note}
                  title={activeTarget.transaction.title}
                  accountId={activeTarget.transaction.account?.id ?? null}
                  categoryId={activeTarget.transaction.category?.id ?? null}
                  ledgerId={ledger.id}
                  kind={activeTarget.transaction.debt.kind}
                  paired={activeTarget.transaction.debt.paired}
                  counterpartyName={activeTarget.transaction.debt.counterpartyName}
                  hasRecordedTransaction
                  onClose={handleClose}
                />
              </>
            )
          )}
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

/**
 * 往來紀錄的修改表單要帶入實際收付（`PATCH /debt-entries/{id}` 的 `amount` 就是實際收付）。
 * 有分支的還款，交易本身的金額是還清的欠款，要加減分支才是實收；其他交易就是交易金額。
 */
function editableAmountOf(transaction: Transaction): Cents {
  if ((transaction.type === 'COLLECT' || transaction.type === 'REPAY') && transaction.difference) {
    return actualAmountOf(transaction.type, transaction.amount, transaction.difference);
  }
  return transaction.amount;
}
