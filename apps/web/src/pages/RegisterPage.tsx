import { Link, useNavigate } from 'react-router-dom';
import { RegisterForm } from '../features/auth/RegisterForm';
import styles from './AuthPage.module.css';

/**
 * 註冊的「整頁」版本；與登入頁一樣，表單與彈窗共用同一份元件。
 */
export default function RegisterPage() {
  const navigate = useNavigate();

  return (
    <section className={styles.page}>
      <h1 className={styles.title}>註冊</h1>
      <RegisterForm
        onSuccess={() => navigate('/', { replace: true })}
        footer={
          <p className={styles.switch}>
            已經有帳號？<Link to="/login">登入</Link>
          </p>
        }
      />
    </section>
  );
}
