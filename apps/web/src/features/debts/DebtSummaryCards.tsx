import { FormError } from '../../components/FormError';
import { formatMoney } from '../../lib/format';
import { useDebtSummary } from './use-debts';
import styles from './DebtSummaryCards.module.css';

/**
 * 借還檢視最上方的「每人淨額」卡片（spec 4.2）。
 *
 * 淨額的正負號是後端算好的（spec W9）：正數＝對方欠我、負數＝我欠對方，而且只
 * 計未結清的債務。這裡只做兩件事：把正負號換成「欠我／我欠」兩個字、把絕對值
 * 格式化——**不在前端做任何加總或抵銷**。
 *
 * 資料自己在內部取（`useDebtSummary`）：它與債務列表是兩份獨立的資料，由
 * `use-debts` 的快取失效一起保鮮，呼叫端不必多管一份 query。
 */
export function DebtSummaryCards() {
  const summary = useDebtSummary();

  if (summary.isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }
  if (summary.error) {
    return <FormError error={summary.error} />;
  }

  const items = summary.data?.items ?? [];
  if (items.length === 0) {
    // 淨額只計未結清的債務，所以空清單的說法是「沒有未結清」，不是「沒有資料」。
    return <p className={styles.status}>目前沒有未結清的借還</p>;
  }

  return (
    <div className={styles.cards}>
      {items.map((item) => (
        // 3b-2 之後，同名的單邊記錄與連動記錄會是兩列（spec §5.4），key 不能只用名字。
        <div
          key={`${item.counterpartyUserId ?? ''}:${item.counterpartyName}`}
          className={styles.card}
        >
          <span className={styles.name}>{item.counterpartyName}</span>
          {/* 正負號只換文字，金額一律取 API 給的數字：net 直接用，net < 0 取絕對值。 */}
          <span className={`${styles.net} ${item.net > 0 ? styles.lent : styles.borrowed}`}>
            {netText(item.net)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * 淨額換成白話。借出與借入剛好抵銷時淨額是 0；兩筆債務其實都還沒結清，寫「兩清」會誤導，
 * 所以照實寫「淨額 $0」，也不寫成「我欠 $0」。
 */
function netText(net: number): string {
  if (net > 0) {
    return `欠我 ${formatMoney(net)}`;
  }
  if (net < 0) {
    return `我欠 ${formatMoney(-net)}`;
  }
  return '淨額 $0';
}
