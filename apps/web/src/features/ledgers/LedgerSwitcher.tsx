import { Icon } from '../../components/Icon';
import { useActiveLedger } from './use-active-ledger';
import styles from './LedgerSwitcher.module.css';

/**
 * 上方橫條的作用中帳本切換器——決定記帳會寫進哪一本（spec 2i SC-33、SC-38.2、plan D26）。
 *
 * 2h 時它住在側欄的帳本卡裡；2i 把它搬到總覽與交易頁**中間區最上方的橫條左邊**
 * （第二輪修訂 3），並換成**膠囊外觀**：帳本 icon、粗體帳本名、「私人／共享」小標籤、
 * 向下箭頭。滑過時邊框與文字轉成強調色——外觀本身就要說出「這個可以點」。側欄收合
 * 狀態的樣式一併移除，這個元件不再出現在側欄裡。
 *
 * 放進橫條的是頁面（`HomePage`、`TransactionsPage` 用 `PageToolbarStart`），不是這裡；
 * 管理頁不放，所以管理頁沒有切換器（SC-33.4）。
 *
 * 只列**未封存**的帳本（2h · D8）。封存帳本切過去之後，記帳表單的每一次送出都會是
 * 409；與其做一個註定失敗的表單，不如讓它只在 `/ledgers` 與明細頁看得到。清單來自
 * `ActiveLedgerProvider`，它取的就是未封存的那一份，所以這裡不必再過濾一次。
 *
 * 只有一本帳本時**不畫下拉**——沒有東西可以切換，一個永遠只有一個選項的下拉只會
 * 誤導人。外觀仍是同一顆膠囊，只是少了箭頭，也沒有滑過效果。
 *
 * **外觀與元素分開（2h · D18）**：畫面上看到的是那顆膠囊，但 DOM 裡的 `<select>`
 * 從頭到尾是**同一個**，`aria-label` 也一直是「作用中帳本」——它被做成透明、鋪滿
 * 整顆膠囊疊在上面，點哪裡都是點它，原生下拉與鍵盤操作照常。刻意不為不同狀態
 * 另外渲染一份：那會讓「作用中帳本」在 DOM 裡出現兩個，e2e 與螢幕閱讀器都會分不清
 * 該用哪一個。
 */
export function LedgerSwitcher() {
  const { ledger, ledgers, setActiveLedgerId } = useActiveLedger();

  // 還沒載入完或一本都沒有時什麼都不顯示。橫條不是講這件事的地方，
  // 「找不到任何帳本」由總覽、交易頁與 `/ledgers` 各自處理。
  if (!ledger) {
    return null;
  }

  const kindLabel = ledger.kind === 'PERSONAL' ? '私人' : '共享';
  const canSwitch = ledgers.length > 1;

  return (
    // `data-switchable` 是滑過效果的開關：只有一本帳本時整顆膠囊不是可點的東西，
    // 給它 hover 效果會讓人一直去點一個沒有反應的地方。
    <span className={styles.field} data-switchable={canSwitch ? '' : undefined}>
      <Icon name="book" className={styles.icon} />
      {/* 有 `<select>` 時，無障礙名稱由它自己提供；這兩段再讀一次只會重複，所以
          都 aria-hidden。沒有 select 時這個 span 就是名稱的唯一來源，不能藏。 */}
      <span className={styles.name} aria-hidden={canSwitch ? 'true' : undefined}>
        {ledger.name}
      </span>
      <span className={styles.kind} aria-hidden="true">
        {kindLabel}
      </span>

      {canSwitch && (
        <>
          <Icon name="chevronDown" className={styles.chevron} />
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
        </>
      )}
    </span>
  );
}
