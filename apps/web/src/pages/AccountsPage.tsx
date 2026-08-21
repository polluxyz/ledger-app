import { Link } from 'react-router-dom';
import styles from './AccountsPage.module.css';

/**
 * 帳戶管理頁。
 *
 * 目前是佔位版本：Step 2 先讓路由與 ProtectedRoute 就位並可被驗證，
 * 列表、餘額與新增 / 編輯 / 刪除於 Step 4 補上。
 *
 * 之所以不等 Step 4 一起做：那樣「守門有沒有生效」與「頁面內容對不對」會混在
 * 一起除錯；先有一個最小的頁面，轉址行為就能單獨驗收。
 */
export default function AccountsPage() {
  return (
    <section>
      <header className={styles.header}>
        <h1 className={styles.title}>帳戶</h1>
        <Link className={styles.back} to="/">
          回首頁
        </Link>
      </header>
      <p className={styles.placeholder}>帳戶列表與餘額即將推出。</p>
    </section>
  );
}
