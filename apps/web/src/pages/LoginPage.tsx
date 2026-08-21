import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LoginForm } from '../features/auth/LoginForm';
import { toSafeRedirect } from '../lib/safe-redirect';
import styles from './AuthPage.module.css';

/**
 * 登入的「整頁」版本。首頁的主要入口是彈窗，這個路由仍保留給直接連結，
 * 以及日後「請先登入」的轉址使用；表單本身與彈窗共用同一份元件。
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();

  // 轉址過來時會把來源頁夾帶在 state 裡，登入後送回原本想去的地方。
  // state 可被任意寫入，因此**絕不原樣採信**——先收斂成站內路徑，否則就是一個
  // 開放轉址漏洞（見 lib/safe-redirect.ts）。
  const from = toSafeRedirect((location.state as { from?: unknown } | null)?.from);

  return (
    <section className={styles.page}>
      <h1 className={styles.title}>登入</h1>
      <LoginForm
        onSuccess={() => navigate(from, { replace: true })}
        footer={
          <p className={styles.switch}>
            還沒有帳號？<Link to="/register">註冊</Link>
          </p>
        }
      />
    </section>
  );
}
