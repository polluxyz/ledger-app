import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { FormError } from '../components/FormError';
import { TextField } from '../components/TextField';
import { useAuth } from '../features/auth/use-auth';
import styles from './AuthPage.module.css';

/** 登入頁。成功後回到使用者原本想去的頁面（沒有則回首頁）。 */
export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  // ProtectedRoute 轉址時會把來源頁夾帶在 state 裡。
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ email, password });
      await navigate(from, { replace: true });
    } catch (caught) {
      // 帳密錯誤時後端一律回同一則 401 訊息（不透露 email 是否存在）。
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={styles.page}>
      <h1 className={styles.title}>登入</h1>

      <FormError error={error} />

      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <TextField
          label="Email"
          type="email"
          value={email}
          autoComplete="email"
          required
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          label="密碼"
          type="password"
          value={password}
          autoComplete="current-password"
          required
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button type="submit" block disabled={submitting}>
          {submitting ? '登入中…' : '登入'}
        </Button>
      </form>

      <p className={styles.switch}>
        還沒有帳號？<Link to="/register">註冊</Link>
      </p>
    </section>
  );
}
