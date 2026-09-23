import type { MouseEvent } from 'react';
import { isDebtTransactionType, type Transaction } from '@ledger/shared';
import { FormError } from '../../components/FormError';
import { Icon } from '../../components/Icon';
import {
  formatDate,
  formatGroupDate,
  formatTransactionAmount,
  TRANSACTION_TYPE_LABELS,
} from '../../lib/format';
import styles from './TransactionList.module.css';

interface TransactionListProps {
  transactions: Transaction[];
  isLoading: boolean;
  error: unknown;
  /** 目前有沒有套用篩選條件——決定空清單要說哪一句話。 */
  isFiltered?: boolean;
  /** 正在編輯的那一筆的 id，該列會標成選取中。沒有就傳 null 或不傳。 */
  selectedId?: string | null;
  onEdit: (transaction: Transaction) => void;
  onRemove: (transaction: Transaction) => void;
}

/**
 * 金額的語意色，每種型別各自對一個 class（理由見 `lib/format.ts` 的 `formatTransactionAmount`）。
 *
 * 借還的 4 種沿用轉帳的中性色：它們既不是支出也不是收入，借出的錢還會回來，
 * 染成紅色會讓人以為花掉了。
 *
 * CSS Modules 的型別是索引簽章，取出來是 `string | undefined`；`?? ''` 只是
 * 補上那個型別上的洞，class 真的少掉也不過是沒上色。
 */
const AMOUNT_COLOR: Record<Transaction['type'], string> = {
  EXPENSE: styles.expense ?? '',
  INCOME: styles.income ?? '',
  TRANSFER: styles.transfer ?? '',
  LEND: styles.transfer ?? '',
  BORROW: styles.transfer ?? '',
  COLLECT: styles.transfer ?? '',
  REPAY: styles.transfer ?? '',
};

/**
 * 一列在沒有分類時顯示的名稱。轉帳與借還的 4 種都沒有分類，拿型別的中文名當
 * 標題，才不會把借出的錢寫成「轉帳」。
 */
function typeLabel(transaction: Transaction): string {
  return transaction.category?.name ?? TRANSACTION_TYPE_LABELS[transaction.type];
}

/**
 * 一列的口語描述，給編輯／刪除鈕當無障礙名稱用。
 *
 * 列表上每一列的按鈕只有圖示，光靠圖示分不出是哪一筆——螢幕閱讀器的使用者會
 * 聽到一串一模一樣的按鈕。加上日期與分類才指得明確。
 */
function describe(transaction: Transaction): string {
  return `${formatDate(transaction.date)} 的${typeLabel(transaction)}`;
}

/** 同一天的一組交易。`key` 同時是分組依據與 React 的 key。 */
interface DateGroup {
  key: string;
  heading: string;
  transactions: Transaction[];
}

/**
 * 把**連續**同一天的交易併成一組。
 *
 * 只看前後兩筆是不是同一天，不重新排序也不重新分堆——順序是後端給的（日期新→舊），
 * 前端再排一次只會在兩邊規則不一致時默默給出不同的畫面。
 *
 * 分組的依據是 `formatDate` 的字串，與畫面上顯示的日期同一個來源；若改用
 * ISO 字串的前 10 碼，跨時區時會出現「標題寫 8/16、列卻屬於 8/17」。
 */
function groupByDate(transactions: Transaction[]): DateGroup[] {
  const groups: DateGroup[] = [];
  for (const transaction of transactions) {
    const key = formatDate(transaction.date);
    const current = groups[groups.length - 1];
    if (current && current.key === key) {
      current.transactions.push(transaction);
    } else {
      groups.push({ key, heading: formatGroupDate(transaction.date), transactions: [transaction] });
    }
  }
  return groups;
}

/**
 * 交易列表。順序完全依後端給的（日期新→舊），前端不重新排序、不加總，也不做
 * 每日小計——那些都是後端的職責。
 *
 * DOM 結構刻意寫成「一個日期標題 `<p>` ＋ 一個 `<ul>`」：標題**不是** `<li>`，
 * 這樣整個列表的 `<li>` 數量就等於交易筆數（e2e 拿它斷言筆數）。
 */
export function TransactionList({
  transactions,
  isLoading,
  error,
  isFiltered = false,
  selectedId = null,
  onEdit,
  onRemove,
}: TransactionListProps) {
  if (isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }
  if (error) {
    return <FormError error={error} />;
  }
  if (transactions.length === 0) {
    // 篩選中的空清單不是「還沒開始記帳」。叫人「新增第一筆」會讓他以為資料不見了。
    return (
      <p className={styles.empty}>
        {isFiltered ? '沒有符合條件的交易。' : '還沒有任何交易，從上方新增第一筆吧。'}
      </p>
    );
  }

  /**
   * 整列可點就是編輯（D17）。兩顆操作鈕在列之內，點它們會一路冒泡上來，
   * 所以先問這一下是不是打在按鈕上——否則按「刪除」會同時開啟編輯面板。
   *
   * 借還交易在一般交易端點是唯讀的（後端回 409 `DEBT_TRANSACTION_READ_ONLY`），
   * 所以那幾列整列都不開編輯。純粹是體驗：擋不擋得住由後端說了算。
   */
  function handleRowClick(event: MouseEvent<HTMLLIElement>, transaction: Transaction) {
    if ((event.target as Element).closest('button')) {
      return;
    }
    if (isDebtTransactionType(transaction.type)) {
      return;
    }
    onEdit(transaction);
  }

  return (
    <div className={styles.list}>
      {/* 欄位標題。純粹是視覺對位，螢幕閱讀器聽每一列自己的文字就夠了。 */}
      <div className={styles.header} aria-hidden="true">
        <span>分類／備註</span>
        <span>帳戶</span>
        <span className={styles.amountHead}>金額</span>
        <span />
      </div>

      {groupByDate(transactions).map((group) => (
        <div key={group.key}>
          <p className={styles.groupHeading}>{group.heading}</p>
          <ul className={styles.rows}>
            {group.transactions.map((transaction) => (
              <li
                key={transaction.id}
                className={`${styles.row} ${transaction.id === selectedId ? styles.selected : ''}`}
                onClick={(event) => handleRowClick(event, transaction)}
              >
                <span className={styles.main}>
                  {/* 分類為 null＝轉帳或借還交易，這兩種都沒有分類，改寫型別的中文名。 */}
                  {transaction.category ? (
                    <span className={styles.category}>{transaction.category.name}</span>
                  ) : (
                    <span className={styles.category}>
                      <Icon name="transfer" />
                      {TRANSACTION_TYPE_LABELS[transaction.type]}
                    </span>
                  )}
                  {transaction.note && <span className={styles.note}>{transaction.note}</span>}
                </span>
                {/* 帳戶為 null＝別人的帳戶（已遮蔽），或這本帳本不與餘額連動。 */}
                <span className={styles.account}>
                  {transaction.account?.name}
                  {transaction.toAccount && ` → ${transaction.toAccount.name}`}
                </span>
                <span className={`${styles.amount} ${AMOUNT_COLOR[transaction.type]}`}>
                  {formatTransactionAmount(transaction.type, transaction.amount)}
                </span>
                {/* 共享帳本裡任何 editor 都能改任何一筆（後端的決策 8），所以每一列
                    都有入口，不依成員身分判斷。唯一的例外是借還交易：它們只能從
                    債務端點改動，這裡放兩顆必定得到 409 的按鈕只是在騙人。
                    那一格仍然留著（`<span>` 照渲染），欄寬才不會一列一個樣。 */}
                <span className={styles.actions}>
                  {!isDebtTransactionType(transaction.type) && (
                    <>
                      <button
                        type="button"
                        className={styles.action}
                        title="編輯"
                        onClick={() => onEdit(transaction)}
                        aria-label={`編輯${describe(transaction)}`}
                      >
                        <Icon name="edit" />
                      </button>
                      <button
                        type="button"
                        className={`${styles.action} ${styles.remove}`}
                        title="刪除"
                        onClick={() => onRemove(transaction)}
                        aria-label={`刪除${describe(transaction)}`}
                      >
                        <Icon name="trash" />
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
