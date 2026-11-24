import type { ReactNode } from 'react';
import { LineArt } from '../components/LineArt';
import styles from './AuthPage.module.css';

/** 登入與註冊路由共用品牌欄，表單彈窗另由 AuthDialog 提供外框。 */
export function AuthPageLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.page}>
      <div className={styles.brand}>
        <span className={styles.logo} aria-hidden="true">
          帳
        </span>
        <p>記帳系統</p>
        <LineArt subject="ledger" placement="brand" />
      </div>
      <div className={styles.fields}>
        <h2 className={styles.title}>{title}</h2>
        {children}
      </div>
    </section>
  );
}
