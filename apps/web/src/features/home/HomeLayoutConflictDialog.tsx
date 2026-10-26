import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Button } from '../../components/Button';
import styles from './HomeLayoutConflictDialog.module.css';

/** 衝突彈窗只提供標題與兩個決策，原生焦點導引由此元件明確維護。 */
export function HomeLayoutConflictDialog({
  open,
  isSaving,
  onLoadLatest,
  onOverwrite,
  onClose,
}: {
  open: boolean;
  isSaving: boolean;
  onLoadLatest: () => void;
  onOverwrite: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => previousFocus?.focus();
  }, [open]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!isSaving) onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    const first = buttons?.[0];
    const last = buttons?.[buttons.length - 1];
    if (!first || !last) return;
    event.preventDefault();
    if (event.shiftKey) {
      (document.activeElement === first ? last : first).focus();
    } else {
      (document.activeElement === last ? first : last).focus();
    }
  }

  if (!open) return null;
  return (
    <div className={styles.backdrop}>
      <div
        aria-labelledby="home-layout-conflict-title"
        aria-modal="true"
        className={styles.dialog}
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <h2 id="home-layout-conflict-title">版面已在其他地方更新</h2>
        <div className={styles.actions}>
          <Button disabled={isSaving} onClick={onLoadLatest}>
            載入最新
          </Button>
          <Button variant="secondary" disabled={isSaving} onClick={onOverwrite}>
            用我的覆蓋
          </Button>
        </div>
      </div>
    </div>
  );
}
