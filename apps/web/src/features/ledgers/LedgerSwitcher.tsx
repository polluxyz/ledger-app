import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { LedgerSummary } from '@ledger/shared';
import { Icon } from '../../components/Icon';
import { useActiveLedger } from './use-active-ledger';
import styles from './LedgerSwitcher.module.css';

/**
 * 上方橫條的作用中帳本切換器——決定記帳會寫進哪一本（spec 2i SC-33、SC-38.2、SC-40）。
 *
 * 2h 時它住在側欄的帳本卡裡；2i 把它搬到總覽與交易頁**中間區最上方的橫條左邊**
 * （第二輪修訂 3），並換成**膠囊外觀**：帳本 icon、粗體帳本名、「私人／共享」小標籤、
 * 向下箭頭。滑過時邊框與文字轉成強調色——外觀本身就要說出「這個可以點」。
 *
 * 放進橫條的是頁面（`HomePage`、`TransactionsPage` 用 `PageToolbarStart`），不是這裡；
 * 管理頁不放，所以管理頁沒有切換器（SC-33.4）。
 *
 * 只列**未封存**的帳本（2h · D8）。封存帳本切過去之後，記帳表單的每一次送出都會是
 * 409；與其做一個註定失敗的表單，不如讓它只在 `/ledgers` 與明細頁看得到。清單來自
 * `ActiveLedgerProvider`，它取的就是未封存的那一份，所以這裡不必再過濾一次。
 *
 * 只有一本帳本時**不畫下拉**——沒有東西可以切換，一個永遠只有一個選項的下拉只會
 * 誤導人。外觀仍是同一顆膠囊，只是少了箭頭，也沒有滑過效果，而且**不掛**
 * 「作用中帳本」這個名稱：沒有控制項的時候，那個名稱沒有東西可以指。
 *
 * **第三輪：自己做的清單，不用原生 `<select>`（SC-40）。** 2h 的做法是把一個透明的
 * `<select>` 疊在膠囊上，操作與無障礙都交給瀏覽器。代價是打開之後跳出來的是**作業
 * 系統的**白底藍框清單，在黑金主題裡像是別的網站的東西（開發者的回饋）。換成自己
 * 畫的 listbox 之後，鍵盤與焦點要自己接，那些都在 `LedgerListbox` 裡。
 */
export function LedgerSwitcher() {
  const { ledger, ledgers, setActiveLedgerId } = useActiveLedger();

  // 還沒載入完或一本都沒有時什麼都不顯示。橫條不是講這件事的地方，
  // 「找不到任何帳本」由總覽、交易頁與 `/ledgers` 各自處理。
  if (!ledger) {
    return null;
  }

  if (ledgers.length > 1) {
    return <LedgerListbox ledger={ledger} ledgers={ledgers} onSelect={setActiveLedgerId} />;
  }

  return (
    <span className={styles.field}>
      <Icon name="book" className={styles.icon} />
      <span className={styles.name}>{ledger.name}</span>
      <span className={styles.kind}>{kindLabelOf(ledger)}</span>
    </span>
  );
}

interface LedgerListboxProps {
  ledger: LedgerSummary;
  /** 一定有兩本以上——只有一本時呼叫端根本不會渲染這個元件。 */
  ledgers: LedgerSummary[];
  onSelect: (ledgerId: string) => void;
}

/**
 * 膠囊 ＋ 自己畫的下拉清單（SC-40）。
 *
 * 三個決定值得先說明：
 *
 * 1. **名稱掛在外面那層 `role="group"` 上，不在按鈕上。** 「作用中帳本」要指的是
 *    「按鈕加清單」這整件事；掛在按鈕上的話，按鈕就得在「作用中帳本」與「目前是
 *    哪一本」之間二選一。按鈕自己的名稱因此來自膠囊裡的文字（帳本名 ＋ 私人／共享）。
 * 2. **選項一直在 DOM 裡**，收起時靠 CSS 的 `visibility` 藏（不是移除、也不是
 *    `display: none`）。「切換器裡有沒有某一本帳本」因此不必打開就查得到——`e2e/
 *    ledgers.spec.ts` 驗「封存的帳本從切換器消失」時讀的就是這一整塊的文字。
 *    `visibility: hidden` 同時把它排除在 Tab 順序與無障礙樹之外，收起時不會有
 *    看不見卻按得到的東西。
 * 3. **焦點一直留在按鈕上**，用 `aria-activedescendant` 指出「鍵盤現在停在哪一項」。
 *    真的把焦點移進清單的話，收起時還要自己把焦點送回來；少一段狀態就少一種錯。
 */
function LedgerListbox({ ledger, ledgers, onSelect }: LedgerListboxProps) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  /** 鍵盤停在第幾項。打開的瞬間對齊目前這一本，不是從頭開始。 */
  const [highlighted, setHighlighted] = useState(0);

  const currentIndex = Math.max(
    ledgers.findIndex((item) => item.id === ledger.id),
    0,
  );
  const optionId = (ledgerId: string) => `${baseId}-option-${ledgerId}`;

  const openList = useCallback(() => {
    setHighlighted(currentIndex);
    setOpen(true);
  }, [currentIndex]);

  /** 收起並把焦點送回按鈕——鍵盤使用者不該在清單關掉之後掉到頁面最上面。 */
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const select = useCallback(
    (ledgerId: string) => {
      onSelect(ledgerId);
      close();
    },
    [close, onSelect],
  );

  // 點清單外面就收起來。它浮在內容上，不給這條路就只能再回頭找那顆按鈕。
  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  /*
   * 鍵盤：Enter／Space／↓ 打開、↑↓ 移動、Enter 選取、Esc 收起（SC-40.2）。
   *
   * 都寫在按鈕上，因為焦點一直在按鈕上（見元件說明第 3 點）。
   * `preventDefault()` 有兩個作用：擋掉 Space 的捲動，以及擋掉瀏覽器把 Enter／Space
   * 轉成 click——不擋的話「打開」會緊接著被 click 的「切換」關回去。
   */
  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        close();
      }
      return;
    }
    if (event.key === 'Tab') {
      // 離開這顆按鈕就收起來，不留一塊浮在別的東西上的清單。
      setOpen(false);
      return;
    }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      setHighlighted((index) => (index + step + ledgers.length) % ledgers.length);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      const target = ledgers[highlighted];
      if (target) {
        select(target.id);
      }
    }
  }

  return (
    <div ref={rootRef} className={styles.root} role="group" aria-label="作用中帳本">
      <button
        ref={triggerRef}
        type="button"
        className={styles.field}
        data-switchable=""
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(ledgers[highlighted]?.id ?? ledger.id) : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={handleKeyDown}
      >
        <Icon name="book" className={styles.icon} />
        <span className={styles.name}>{ledger.name}</span>
        <span className={styles.kind}>{kindLabelOf(ledger)}</span>
        <Icon name="chevronDown" className={styles.chevron} />
      </button>

      <ul id={listId} role="listbox" className={styles.list} data-open={open ? '' : undefined}>
        {ledgers.map((item, index) => {
          const selected = item.id === ledger.id;
          return (
            <li
              key={item.id}
              id={optionId(item.id)}
              role="option"
              aria-selected={selected}
              className={styles.option}
              data-highlighted={open && index === highlighted ? '' : undefined}
              onClick={() => select(item.id)}
              onMouseEnter={() => setHighlighted(index)}
            >
              {/* 勾選記號佔固定寬度，沒被選中的那幾項名稱才不會往左跑一格。 */}
              <span className={styles.check} aria-hidden="true">
                {selected ? '✓' : ''}
              </span>
              {/* `data-ledger-name` 是「帳本名」這一格的穩定抓取點：清單的樣式是
                  CSS Modules（class 名是編譯出來的），測試不該去猜它。 */}
              <span className={styles.optionName} data-ledger-name={item.name}>
                {item.name}
              </span>
              <span className={styles.kind}>{kindLabelOf(item)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 膠囊與清單共用的「私人／共享」小標籤。 */
function kindLabelOf(ledger: LedgerSummary): string {
  return ledger.kind === 'PERSONAL' ? '私人' : '共享';
}
