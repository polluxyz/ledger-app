import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../features/auth/use-auth';
import { PageToolbarContext, usePageToolbar } from './page-toolbar-context';
import styles from './PageToolbar.module.css';

/** 提供橫條的兩個插槽位置。掛在外殼，包住橫條與頁面。 */
export function PageToolbarProvider({ children }: { children: ReactNode }) {
  const [start, setStart] = useState<HTMLElement | null>(null);
  const [end, setEnd] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ start, end, setStart, setEnd }), [start, end]);
  return <PageToolbarContext.Provider value={value}>{children}</PageToolbarContext.Provider>;
}

/**
 * 中間區最上方的橫條（spec 2i SC-38）。捲動時固定在上方，內容與下方的包裝同寬。
 *
 * 只有登入後才有：訪客首頁沒有側欄，也沒有需要放在這裡的東西。左邊空著的時候
 * 仍然保留高度——之後的功能會放在這裡（開發者 2026-09-23：「目前先保留」），
 * 而且每一頁的標題高度要一致，橫條時有時無的話標題會上下跳。
 */
export function PageToolbar() {
  const { isAuthenticated } = useAuth();
  const { setStart, setEnd } = usePageToolbar();

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className={styles.bar}>
      <div className={styles.inner}>
        <div ref={setStart} className={styles.start} />
        <div ref={setEnd} className={styles.end} />
      </div>
    </div>
  );
}

/** 放到橫條左邊（帳本切換器、返回連結）。 */
export function PageToolbarStart({ children }: { children: ReactNode }) {
  const { start } = usePageToolbar();
  return start ? createPortal(children, start) : null;
}

/** 放到橫條右邊：頁面層級的主要按鈕（「＋ 新增交易」「新增帳戶」……）。 */
export function PageToolbarActions({ children }: { children: ReactNode }) {
  const { end } = usePageToolbar();
  return end ? createPortal(children, end) : null;
}
