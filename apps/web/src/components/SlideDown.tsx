import { useEffect, useState, type ReactNode } from 'react';
import styles from './SlideDown.module.css';

interface SlideDownProps {
  open: boolean;
  children: ReactNode;
}

/** 收起動畫的保險時間。正常情況由 transitionend 先觸發，這個只防它沒來。 */
const CLOSE_FALLBACK_MS = 300;

/**
 * 使用者要求「不要動畫」，或環境根本無法判斷（jsdom 沒有 matchMedia）時，直接收起。
 * 這不是斷點判斷——與版面寬度無關，所以不違反「斷點只寫在 CSS」（phase-2h D10）。
 */
function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== 'function') {
    return true;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 往下展開、往上收起的容器（phase-2h D20、SC-30）。管理頁的「建立帳本」
 * 「新增帳戶」等表單用它取代小視窗。
 *
 * 內容**收起後整個卸載**。這延續 `Dialog` 的保證：下次打開一定是乾淨的，
 * 不會殘留上次打到一半的字。難處在於「先播完收起動畫，再卸載」——
 * 所以 `open` 變成 false 時先保留內容、套上收起的樣式，動畫結束才真的拿掉。
 *
 * 展開的動畫交給 CSS 的 `@starting-style`（見 module.css），不必在 JS 裡等一幀再加 class。
 */
export function SlideDown({ open, children }: SlideDownProps) {
  // present：內容還在 DOM 裡（展開中、已展開、或正在收起）。
  const [present, setPresent] = useState(open);

  // 在 render 期間依 props 調整 state（React 官方建議的寫法），不用 effect——
  // effect 會多一輪渲染，第一幀會先畫出「沒有內容」再補上。
  if (open && !present) {
    setPresent(true);
  }
  if (!open && present && prefersReducedMotion()) {
    setPresent(false);
  }

  const closing = !open && present;

  // 收起的保險：transitionend 沒來（例如元素被 display: none）也要卸載。
  useEffect(() => {
    if (!closing) {
      return;
    }
    const timer = window.setTimeout(() => setPresent(false), CLOSE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);

  if (!present) {
    return null;
  }

  return (
    <div
      className={closing ? `${styles.wrap} ${styles.closing}` : styles.wrap}
      onTransitionEnd={(event) => {
        // 只認自己的收起動畫；裡面的按鈕 hover 之類的 transition 也會冒泡上來。
        if (closing && event.target === event.currentTarget) {
          setPresent(false);
        }
      }}
    >
      <div className={styles.inner}>{children}</div>
    </div>
  );
}
