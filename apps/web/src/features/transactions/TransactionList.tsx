import { useState, type MouseEvent } from 'react';
import { isDebtTransactionType, type Transaction } from '@ledger/shared';
import { CategoryIcon } from '../../components/CategoryIcon';
import { DebtArrow } from '../../components/DebtArrow';
import { FormError } from '../../components/FormError';
import { getTransactionLabel } from './transaction-label';
import {
  formatDate,
  formatGroupDate,
  formatMoney,
  formatTransactionAmount,
} from '../../lib/format';
import styles from './TransactionList.module.css';

interface TransactionListProps {
  transactions: Transaction[];
  isLoading: boolean;
  error: unknown;
  /** 目前有沒有套用篩選條件——決定空清單要說哪一句話。 */
  isFiltered?: boolean;
  /** 總覽最近交易沿用同一列樣式，但不顯示日期分組。 */
  variant?: 'grouped' | 'recent';
  /** 首頁摘要使用自己的空狀態文案。 */
  emptyMessage?: string;
  /** 正在編輯的那一筆的 id，該列會標成選取中。沒有就傳 null 或不傳。 */
  selectedId?: string | null;
  onEdit: (transaction: Transaction) => void;
  /** 點選自己有關聯對象的借還或代付交易時，編輯那筆往來紀錄。 */
  onEditDebtTransaction?: (transaction: Transaction) => void;
  /** 點「待補」（`accountPending: true`）時，打開補帳戶表單（3e W125）。 */
  onFillAccount?: (transaction: Transaction) => void;
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
 * 一列的口語描述，給編輯／刪除鈕當無障礙名稱用。
 *
 * 列表上每一列的按鈕只有圖示，光靠圖示分不出是哪一筆——螢幕閱讀器的使用者會
 * 聽到一串一模一樣的按鈕。加上日期與分類才指得明確。
 */
/**
 * 第一行：這筆是什麼（3d 修訂 1，T13）。永遠是分類；沒有分類的借還與轉帳用它們的標籤
 * （「借出 · 小明」「轉帳」）。每一列的這個位置都是同一種資訊，掃過去才不會亂。
 */
function rowLabel(transaction: Transaction): string {
  if (transaction.category) return transaction.category.name;
  return getTransactionLabel(transaction);
}

/** 第二行：交易名稱；沒有名稱就是空的，不拿分類來補（補了就又混在一起）。 */
function rowName(transaction: Transaction): string {
  return transaction.title?.trim() ?? '';
}

function describe(transaction: Transaction): string {
  const name = rowName(transaction);
  return `${formatDate(transaction.date)} 的${rowLabel(transaction)}${name ? ` ${name}` : ''}`;
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
 * 每列只保留分類圖示、名稱、金額與分帳展開鈕；首頁摘要也直接使用這個列元件，
 * 讓兩處的列高與長字截斷規則只有一份來源。
 */
export function TransactionList({
  transactions,
  isLoading,
  error,
  isFiltered = false,
  variant = 'grouped',
  emptyMessage,
  selectedId = null,
  onEdit,
  onEditDebtTransaction,
}: TransactionListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
        {emptyMessage ??
          (isFiltered ? '沒有符合條件的交易。' : '還沒有任何交易，從上方新增第一筆吧。')}
      </p>
    );
  }

  /**
   * 整列可點就是編輯（D17）。分帳展開鈕在列之內，點它會一路冒泡上來，
   * 所以略過按鈕目標，避免展開時同時打開編輯面板。
   *
   * 往來紀錄產生的交易不能從一般交易端點刪除或編輯。自己的紀錄有 `debt` 時，
   * 點列直接編輯那筆往來紀錄；其他人的借還交易與未提供編輯入口時保持不可點。
   */
  function handleRowClick(event: MouseEvent<HTMLLIElement>, transaction: Transaction) {
    if ((event.target as Element).closest('button')) {
      return;
    }
    openRow(transaction);
  }

  /** 點一列（或它的第一格按鈕）要做的事：一般交易或自己的往來紀錄進入編輯。 */
  function openRow(transaction: Transaction) {
    if (transaction.debt) {
      onEditDebtTransaction?.(transaction);
      return;
    }
    if (isDebtTransactionType(transaction.type)) {
      return;
    }
    onEdit(transaction);
  }

  const groups =
    variant === 'recent'
      ? [{ key: 'recent', heading: '', transactions }]
      : groupByDate(transactions);

  return (
    <div className={styles.list}>
      {groups.map((group) => (
        <div key={group.key} className={styles.dateGroup}>
          {variant === 'grouped' && <p className={styles.groupHeading}>{group.heading}</p>}
          <ul className={styles.rows}>
            {group.transactions.map((transaction) => {
              const isDebt = isDebtTransactionType(transaction.type);
              const split = transaction.split;
              const expanded = expandedId === transaction.id;
              const isClickable = transaction.debt ? Boolean(onEditDebtTransaction) : !isDebt;
              const amount = split
                ? split.payer === null
                  ? split.total
                  : split.myShare
                : transaction.amount;
              const rowClassNames = [
                styles.row,
                isClickable ? styles.clickable : '',
                transaction.id === selectedId ? styles.selected : '',
                expanded ? styles.rowExpanded : '',
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <li
                  key={transaction.id}
                  className={rowClassNames}
                  onClick={(event) => handleRowClick(event, transaction)}
                >
                  {/* 圓形底色＋金色圖示，與提案頁樣板一致（3d 修訂 2）。 */}
                  <span className={styles.iconBadge} aria-hidden="true">
                    <CategoryIcon
                      className={styles.categoryIcon}
                      icon={transaction.category?.icon}
                      transactionType={transaction.category ? undefined : transaction.type}
                    />
                  </span>
                  {/*
                    名稱格在可點的列上是一顆「看起來不像按鈕」的按鈕：滑鼠點整列就夠了，
                    但鍵盤與螢幕閱讀器需要一個聚焦得到的入口，否則拿掉鉛筆圖示之後就
                    再也進不了編輯。它的點擊由自己處理，列的 onClick 看到目標在按鈕裡會略過。
                  */}
                  {isClickable ? (
                    <button
                      type="button"
                      className={`${styles.main} ${styles.mainButton}`}
                      aria-label={`編輯${describe(transaction)}`}
                      onClick={() => openRow(transaction)}
                    >
                      <span className={styles.title}>{rowLabel(transaction)}</span>
                      <span className={styles.subtitle}>
                        <span className={styles.name}>{rowName(transaction)}</span>
                        {split && <span className={styles.splitBadge}>分帳</span>}
                      </span>
                    </button>
                  ) : (
                    <span className={styles.main}>
                      <span className={styles.title}>{rowLabel(transaction)}</span>
                      <span className={styles.subtitle}>
                        <span className={styles.name}>{rowName(transaction)}</span>
                        {split && <span className={styles.splitBadge}>分帳</span>}
                      </span>
                    </span>
                  )}
                  <span className={`${styles.amount} ${AMOUNT_COLOR[transaction.type]}`}>
                    {formatTransactionAmount(transaction.type, amount)}
                  </span>
                  <span className={styles.actions}>
                    {split && (
                      <button
                        type="button"
                        className={`${styles.action} ${expanded ? styles.expandedAction : ''}`}
                        aria-label={`${expanded ? '收合' : '展開'}分帳明細`}
                        aria-expanded={expanded}
                        onClick={() => setExpandedId(expanded ? null : transaction.id)}
                      >
                        ›
                      </button>
                    )}
                  </span>
                  {expanded && split && (
                    <div className={styles.details}>
                      {split.counterparts.map((counterpart) => (
                        <DebtArrow
                          key={counterpart.counterpartyId}
                          from={counterpart.direction === 'THEY_OWE_ME' ? counterpart.name : '我'}
                          to={counterpart.direction === 'THEY_OWE_ME' ? '我' : counterpart.name}
                          amount={counterpart.amount}
                          srText={
                            counterpart.direction === 'THEY_OWE_ME'
                              ? `${counterpart.name}欠你 ${formatMoney(counterpart.amount)}`
                              : `你欠${counterpart.name} ${formatMoney(counterpart.amount)}`
                          }
                        />
                      ))}
                      {split.myShare > 0 && (
                        <span className={styles.myShare}>我 {formatMoney(split.myShare)}</span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
