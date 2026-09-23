import { Icon } from '../../components/Icon';
import { useActiveLedger } from './use-active-ledger';
import styles from './LedgerSwitcher.module.css';

/**
 * 側欄帳本卡裡的作用中帳本切換器——決定首頁記帳會寫進哪一本。
 *
 * 只列**未封存**的帳本（D8）。封存帳本切過去之後，記帳表單的每一次送出都會是 409；
 * 與其做一個註定失敗的表單，不如讓它只在 `/ledgers` 與明細頁看得到。清單來自
 * `ActiveLedgerProvider`，它取的就是未封存的那一份，所以這裡不必再過濾一次。
 *
 * 只有一本帳本時不畫下拉——沒有東西可以切換，一個永遠只有一個選項的下拉只會誤導人。
 *
 * **外觀與元素分開（2h · D18）**：畫面上看到的是「粗體帳本名 ＋ 箭頭」的一行，
 * 側欄收合時縮成一個顯示首字的方塊。但 DOM 裡的 `<select>` 從頭到尾是**同一個**，
 * `aria-label` 也一直是「作用中帳本」——它被做成透明、鋪滿整行疊在上面，點哪裡
 * 都是點它，原生下拉與鍵盤操作照常。刻意不為收合狀態另外渲染一份：那會讓
 * 「作用中帳本」在 DOM 裡出現兩個，e2e 與螢幕閱讀器都會分不清該用哪一個。
 */
export function LedgerSwitcher() {
  const { ledger, ledgers, setActiveLedgerId } = useActiveLedger();

  // 還沒載入完或一本都沒有時什麼都不顯示。帳本卡不是講這件事的地方，
  // 「找不到任何帳本」由首頁與 `/ledgers` 各自處理。
  if (!ledger) {
    return null;
  }

  // 收合時方塊裡的那個字。`Array.from` 而不是 `[0]`，否則 emoji 會被切成半個。
  const initial = Array.from(ledger.name)[0] ?? '';

  if (ledgers.length === 1) {
    return (
      <div className={styles.field}>
        {/* 沒有 select 可以承載名稱，這個 span 就是唯一的來源，不能 aria-hidden。 */}
        <span className={styles.name}>{ledger.name}</span>
        <span className={styles.initial} aria-hidden="true">
          {initial}
        </span>
      </div>
    );
  }

  return (
    <div className={styles.field}>
      {/* 名稱與箭頭純粹是 `<select>` 的外觀。無障礙名稱由 select 自己提供，
          這兩個再讀一次只會重複，所以都 aria-hidden。 */}
      <span className={styles.name} aria-hidden="true">
        {ledger.name}
      </span>
      <Icon name="chevronDown" className={styles.chevron} />
      <span className={styles.initial} aria-hidden="true">
        {initial}
      </span>

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
    </div>
  );
}
