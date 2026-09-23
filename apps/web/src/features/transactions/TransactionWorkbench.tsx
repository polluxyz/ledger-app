import { useEffect, useId, useRef } from 'react';
import type { LedgerSummary, Transaction } from '@ledger/shared';
import { RightPanelContent } from '../../app/RightPanel';
import { useRightPanel } from '../../app/right-panel-context';
import { Icon } from '../../components/Icon';
import { TransactionDialog } from './TransactionDialog';
import { TransactionForm } from './TransactionForm';
import styles from './TransactionWorkbench.module.css';

interface TransactionWorkbenchProps {
  ledger: LedgerSummary;
  /** null＝顯示新增表單；有值＝顯示那一筆的編輯面板。 */
  editing: Transaction | null;
  /** 編輯結束（儲存成功、取消、關閉、Esc）時呼叫，由頁面把 `editing` 設回 null。 */
  onEditDone: () => void;
}

/**
 * 右側欄的內容（spec 2i §4.5、plan D25）。
 *
 * 2h 時這段邏輯與交易列表一起住在首頁的 `LedgerWorkbench` 裡。2i 把它抽出來，
 * 因為總覽與交易頁**兩頁都要用同一個面板**：頁面各自持有 `editing`（點了哪一筆），
 * 面板只負責「顯示新增還是編輯」。
 *
 * ## 新增與編輯互斥（沿用 2h · D9）
 *
 * 兩張表單的欄位標籤一模一樣，同時存在的話 `getByLabelText('金額')` 會對到兩個，
 * 測試與螢幕閱讀器都分不出在改哪一筆。所以這裡是 `?:` 而不是兩段並排。
 *
 * `key={editing.id}` 讓編輯中直接點另一列時表單整個重建——少了它，React 會沿用
 * 同一個元件實例，欄位仍留著上一筆的值。
 *
 * ## 焦點怎麼進來（SC-35.3）
 *
 * 頁首的「＋ 新增交易」呼叫 `requestFocus()`，`focusRequest` 就加 1。這裡看到它
 * 變大才把焦點送到金額欄——**初次 mount 不搶焦點**，否則每次進到記帳頁，鍵盤
 * 與螢幕閱讀器的使用者都會被硬拉到表單裡。
 *
 * `TextField` 不轉送 ref，所以金額欄的 id 由這裡產生、傳給表單，再用
 * `getElementById` 找回來。`preventScroll` 是必要的：右側欄從 0 寬展開的期間
 * 聚焦，瀏覽器會把還在動的容器捲到奇怪的位置。
 */
export function TransactionWorkbench({ ledger, editing, onEditDone }: TransactionWorkbenchProps) {
  const { close, focusRequest } = useRightPanel();
  const amountFieldId = useId();
  // 初值就是目前的計數，所以「第一次 render」永遠不算一次 focus 要求。
  const seenFocusRequest = useRef(focusRequest);

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
      {editing === null ? (
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
          <TransactionForm ledger={ledger} amountFieldId={amountFieldId} />
        </div>
      ) : (
        <TransactionDialog
          key={editing.id}
          ledger={ledger}
          transaction={editing}
          onClose={onEditDone}
        />
      )}
    </RightPanelContent>
  );
}
