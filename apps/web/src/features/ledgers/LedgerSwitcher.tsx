import { useActiveLedger } from './use-active-ledger';
import styles from './LedgerSwitcher.module.css';

/**
 * 頁首的作用中帳本切換器——決定首頁記帳會寫進哪一本。
 *
 * 只列**未封存**的帳本（D8）。封存帳本切過去之後，記帳表單的每一次送出都會是 409；
 * 與其做一個註定失敗的表單，不如讓它只在 `/ledgers` 與明細頁看得到。清單來自
 * `ActiveLedgerProvider`，它取的就是未封存的那一份，所以這裡不必再過濾一次。
 *
 * 只有一本帳本時不畫下拉——沒有東西可以切換，一個永遠只有一個選項的下拉只會誤導人。
 */
export function LedgerSwitcher() {
  const { ledger, ledgers, setActiveLedgerId } = useActiveLedger();

  // 還沒載入完或一本都沒有時什麼都不顯示。頁首不是講這件事的地方，
  // 「找不到任何帳本」由首頁與 `/ledgers` 各自處理。
  if (!ledger) {
    return null;
  }

  if (ledgers.length === 1) {
    return <span className={styles.single}>{ledger.name}</span>;
  }

  return (
    <select
      className={styles.select}
      aria-label="作用中帳本"
      value={ledger.id}
      onChange={(event) => setActiveLedgerId(event.target.value)}
    >
      {ledgers.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </select>
  );
}
