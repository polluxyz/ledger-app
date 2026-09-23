import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './Dialog.module.css';

/**
 * - `modal`：蓋在頁面上的彈窗，背景被鎖住。編輯、改名、所有確認都用這個。
 * - `panel`：嵌在版面裡的非 modal 面板（phase-2h D8）。首頁右側的「編輯交易」、
 *   管理頁往下展開的建立表單都用這個——使用者可以一邊看清單一邊填。
 */
export type DialogVariant = 'modal' | 'panel';

interface DialogProps {
  /** false 代表關閉——此時整個元件不渲染，見下方說明。 */
  open: boolean;
  /** 標題列文字，同時作為彈窗的無障礙名稱（`aria-label`）。 */
  title: string;
  /** 使用者按關閉鈕、Esc 或其他方式關閉時呼叫；由呼叫端負責把 `open` 改成 false。 */
  onClose: () => void;
  /** 預設 `modal`，既有呼叫端不必改。 */
  variant?: DialogVariant;
  children: ReactNode;
}

/**
 * 所有彈窗與面板共用的外殼。
 *
 * 採用瀏覽器原生的 `<dialog>`。`modal` 用 `showModal()`，可直接獲得焦點鎖定
 * （focus trap）、Esc 關閉、背景遮罩與背景 inert——這些無障礙行為不必自行實作，
 * 也省下一個相依套件。
 *
 * 之所以抽成元件而不是讓每個彈窗各寫一次：除了避免重複，更重要的是把「彈窗用什麼
 * 技術做」隔離在這一個檔案裡。日後若要換成別的實作，呼叫端一行都不必動——它們只
 * 知道 `open` / `title` / `onClose` / `variant`。
 */
export function Dialog({ open, title, onClose, variant = 'modal', children }: DialogProps) {
  // 關閉時整個卸載（而非只是隱藏），因此下次開啟的內容必定是乾淨的——不會殘留
  // 上一次輸入到一半的文字或錯誤訊息。這件事刻意由 Dialog 自己負責，呼叫端就
  // 不可能忘記；忘記的症狀是「第二次打開還留著上次的東西」，很難聯想到原因。
  if (!open) {
    return null;
  }
  return variant === 'panel' ? (
    <PanelFrame title={title} onClose={onClose}>
      {children}
    </PanelFrame>
  ) : (
    <ModalFrame title={title} onClose={onClose}>
      {children}
    </ModalFrame>
  );
}

interface FrameProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className={styles.header}>
      <h2 className={styles.title}>{title}</h2>
      <button type="button" className={styles.close} onClick={onClose} aria-label="關閉">
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

function ModalFrame({ title, onClose, children }: FrameProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // 掛載後才開啟：必須呼叫 showModal() 才會有焦點鎖定與遮罩，
  // 單純加上 open 屬性並不會。
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog
      className={styles.dialog}
      ref={dialogRef}
      aria-label={title}
      // 使用者按 Esc（或其他方式）關閉時，讓父層狀態跟著同步。
      onClose={onClose}
    >
      <Header title={title} onClose={onClose} />
      {children}
    </dialog>
  );
}

/** 面板打開時，焦點要落在的第一個欄位。 */
const FIRST_FIELD =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * 非 modal 的面板。
 *
 * `show()` 不鎖焦點、不擋背景，所以原生 `<dialog>` 幫 modal 做的兩件事要自己補：
 *
 * 1. **Esc 關閉**：非 modal 的 dialog 按 Esc 不會觸發 `close`，要自己接 keydown。
 * 2. **焦點的去與回**：打開時移到第一個欄位；關閉時回到打開它的那顆按鈕。
 *    少了第二件，鍵盤使用者按完「取消」焦點會掉回頁面最上面，得從頭 Tab 一次。
 */
function PanelFrame({ title, onClose, children }: FrameProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // 打開前焦點所在的元素，通常就是觸發面板的那顆按鈕。
  const returnFocusRef = useRef<Element | null>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    returnFocusRef.current = document.activeElement;
    dialog.show();
    const first = dialog.querySelector<HTMLElement>(FIRST_FIELD);
    (first ?? dialog).focus();

    return () => {
      // 只在焦點還在面板裡時才搬回去。使用者若已經點到別處（例如直接點另一列），
      // 不該把他的焦點硬拉回來。這一段必須是 layout effect：卸載時它在 DOM 被移除
      // 之前執行，才讀得到「焦點是不是在面板裡」。
      const previous = returnFocusRef.current;
      if (
        dialog.contains(document.activeElement) &&
        previous instanceof HTMLElement &&
        previous.isConnected
      ) {
        previous.focus();
      }
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <dialog
      className={styles.panel}
      ref={dialogRef}
      aria-label={title}
      // 沒有欄位可聚焦時，焦點落在面板本身，Esc 才接得到。
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <Header title={title} onClose={onClose} />
      {children}
    </dialog>
  );
}
