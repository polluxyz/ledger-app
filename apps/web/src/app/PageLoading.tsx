import { PageContent } from '../components/PageContent';
import styles from './PageLoading.module.css';

/** 頁面程式載入期間保留內容區的位置，避免整塊空白。 */
export function PageLoading() {
  return (
    <PageContent>
      <div className={styles.skeleton} role="status" aria-label="載入中">
        <div className={styles.title} />
        <div className={styles.cards}>
          <div className={styles.card} />
          <div className={styles.card} />
          <div className={styles.card} />
        </div>
        <div className={styles.panel} />
      </div>
    </PageContent>
  );
}
