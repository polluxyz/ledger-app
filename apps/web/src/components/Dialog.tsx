import { useEffect, useRef, type ReactNode } from 'react';
import styles from './Dialog.module.css';

interface DialogProps {
  /** false 代表關閉——此時整個元件不渲染，見下方說明。 */
  open: boolean;
  /** 標題列文字，同時作為彈窗的無障礙名稱（`aria-label`）。 */
  title: string;
  /** 使用者按關閉鈕、Esc 或其他方式關閉時呼叫；由呼叫端負責把 `open` 改成 false。 */
  onClose: () => void;
  children: ReactNode;
}

/**
 * 所有彈窗共用的外殼。
 *
 * 採用瀏覽器原生的 `<dialog showModal()>`，可直接獲得焦點鎖定（focus trap）、
 * Esc 關閉、背景遮罩與背景 inert——這些無障礙行為不必自行實作，也省下一個相依套件。
 *
 * 之所以抽成元件而不是讓每個彈窗各寫一次：除了避免重複，更重要的是把「彈窗用什麼
 * 技術做」隔離在這一個檔案裡。日後若要換成別的實作，呼叫端一行都不必動——它們只
 * 知道 `open` / `title` / `onClose` 三件事。
 */
export function Dialog({ open, title, onClose, children }: DialogProps) {
  // 關閉時整個卸載（而非只是隱藏），因此下次開啟的內容必定是乾淨的——不會殘留
  // 上一次輸入到一半的文字或錯誤訊息。這件事刻意由 Dialog 自己負責，呼叫端就
  // 不可能忘記；忘記的症狀是「第二次打開還留著上次的東西」，很難聯想到原因。
  if (!open) {
    return null;
  }
  return (
    <DialogFrame title={title} onClose={onClose}>
      {children}
    </DialogFrame>
  );
}

function DialogFrame({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
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
      <div className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label="關閉">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
