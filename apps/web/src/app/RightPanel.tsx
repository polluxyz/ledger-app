import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRightPanel } from './right-panel-context';
import styles from './RightPanel.module.css';

/**
 * 外殼裡的右側欄位置（`App` 的第三欄，spec 2i §4.2）。
 *
 * 它本身沒有內容，只是一個 portal 目標；寬度由「有沒有頁面登記、是不是打開的」
 * 決定，用 CSS 過渡。外殼 grid 的第三欄是 `auto`，所以這個元素的寬度逐格變化時，
 * 中間欄也逐格變寬變窄——內容置中的移動是連續的，不需要 JS 算位置。
 *
 * 收起時裡面的內容設 `inert`：寬度 0 的表單仍然在 DOM 裡，少了它，鍵盤使用者按
 * Tab 會走進看不見的欄位。
 */
export function RightPanel() {
  const { isRegistered, isOpen, setSlot } = useRightPanel();

  return (
    <div
      className={styles.column}
      data-registered={isRegistered ? '' : undefined}
      data-open={isOpen ? '' : undefined}
    >
      <div ref={setSlot} className={styles.inner} inert={!isOpen} />
    </div>
  );
}

/**
 * 記帳頁用它把面板內容放進右側欄，並登記「這一頁有右側欄」。
 *
 * 為什麼用 portal 而不是把 ReactNode 交給外殼：面板的 state（編輯中的那一筆、
 * 表單輸入）要留在頁面元件裡，換頁時跟著頁面一起消失。交給外殼的話，state 的
 * 擁有者就變成外殼了。
 *
 * 第一次 render 時 `slot` 可能還是 null（`RightPanel` 的 ref 在同一次 commit 才
 * 設好），下一次 render 就會出現，使用者看不出差別。
 */
export function RightPanelContent({ children }: { children: ReactNode }) {
  const { slot, register } = useRightPanel();

  useEffect(() => register(), [register]);

  return slot ? createPortal(children, slot) : null;
}
