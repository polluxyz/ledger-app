import styles from './App.module.css';

/**
 * 骨架首頁。功能（註冊 / 登入 / 帳本 / 交易）於後續 slice 陸續加入；
 * 這裡先證明建置、樣式與測試管線都通。
 */
export default function App() {
  return (
    <main className={styles.container}>
      <h1 className={styles.title}>記帳系統</h1>
      <p className={styles.subtitle}>前端雛形建置中。</p>
    </main>
  );
}
