import { useAuth } from '../features/auth/use-auth';
import styles from './PageToolbar.module.css';

/**
 * 中間區最上方的橫條（spec 2i SC-38）。捲動時固定在上方，與下方的內容包裝同寬。
 *
 * 2026-10-07 起刻意空著：帳本切換與各頁的主要按鈕移回頁面內容（借還已不分帳本，
 * 會跟著作用中帳本變化的只剩交易頁的「明細」），這一排留給之後的 AI 功能。
 * 原本讓頁面把東西 portal 進來的插槽（`PageToolbarStart`／`PageToolbarActions`）
 * 一併移除——沒有使用者還留著，等於留一條「其實不該走」的路；AI 功能動工時再
 * 依它的實際需求決定怎麼把內容放進來。
 *
 * 只有登入後才有：訪客首頁沒有側欄，也沒有需要放在這裡的東西。空著的時候仍然
 * 保留高度——每一頁的標題都要從同一條線開始，橫條時有時無的話標題會上下跳。
 */
export function PageToolbar() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className={styles.bar}>
      <div className={styles.inner} />
    </div>
  );
}
