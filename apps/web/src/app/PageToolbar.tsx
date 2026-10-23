import { useAuth } from '../features/auth/use-auth';
import { usePageToolbarSlot } from './PageToolbarSlotContext';
import styles from './PageToolbar.module.css';

/**
 * 中間區最上方的橫條（spec 2i SC-38）。捲動時固定在上方，與下方的內容包裝同寬。
 *
 * 只有交易頁會把 AI 文字輸入列 portal 到裡層；它從 2i 起就預留給 AI，固定入口
 * 又不額外佔用交易明細的首屏高度。其他頁仍保留空白橫條，讓頁面標題位置一致。
 *
 * 只有登入後才有：訪客首頁沒有側欄，也沒有需要放在這裡的東西。空著的時候仍然
 * 保留高度——每一頁的標題都要從同一條線開始，橫條時有時無的話標題會上下跳。
 */
export function PageToolbar() {
  const { isAuthenticated } = useAuth();
  const { setElement } = usePageToolbarSlot();

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className={styles.bar}>
      <div className={styles.inner} ref={setElement} />
    </div>
  );
}
