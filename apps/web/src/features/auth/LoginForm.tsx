import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormError';
import { TextField } from '../../components/TextField';
import { useAuth } from './use-auth';

interface LoginFormProps {
  /** 登入成功後要做什麼：整頁版是導向頁面，彈窗版是關閉自己。 */
  onSuccess: () => void | Promise<void>;
  /** 底部的「還沒有帳號？」區塊——整頁版用連結，彈窗版用切換按鈕。 */
  footer?: ReactNode;
}

/**
 * 登入表單本身。刻意不決定「成功之後去哪」，把它交給使用它的容器，
 * 因此同一份表單能同時服務 /login 整頁與首頁的彈窗，不必複製一份。
 */
export function LoginForm({ onSuccess, footer }: LoginFormProps) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ email, password });
      await onSuccess();
    } catch (caught) {
      // 帳密錯誤時後端一律回同一則 401 訊息（不透露 email 是否存在）。
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
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

      {footer}
    </>
  );
}
