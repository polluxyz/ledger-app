import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { FormError } from '../../components/FormError';
import { TextField } from '../../components/TextField';
import { useAuth } from './use-auth';

interface RegisterFormProps {
  /** 註冊（並自動登入）成功後要做什麼，由容器決定。 */
  onSuccess: () => void | Promise<void>;
  /** 底部的「已經有帳號？」區塊。 */
  footer?: ReactNode;
}

/**
 * 註冊表單。成功後 AuthProvider 會以同一組帳密自動登入，使用者不必再輸入一次。
 *
 * 這裡只做「體驗性」的前置檢查（required、密碼長度提示），真正的驗證一律以
 * 後端為準——規則變更時前端不會落後。
 */
export function RegisterForm({ onSuccess, footer }: RegisterFormProps) {
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register({ name, email, password });
      await onSuccess();
    } catch (caught) {
      // 例如 email 已被註冊（409 EMAIL_ALREADY_EXISTS）。
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
          label="名稱"
          value={name}
          autoComplete="name"
          required
          onChange={(event) => setName(event.target.value)}
        />
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
          autoComplete="new-password"
          hint="至少 8 個字元"
          required
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button type="submit" block disabled={submitting}>
          {submitting ? '註冊中…' : '註冊'}
        </Button>
      </form>

      {footer}
    </>
  );
}
