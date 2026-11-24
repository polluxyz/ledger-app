import { Link, useNavigate } from 'react-router-dom';
import { RegisterForm } from '../features/auth/RegisterForm';
import formStyles from '../features/auth/AuthForm.module.css';
import { AuthPageLayout } from './AuthPageLayout';

/**
 * 註冊的「整頁」版本；與登入頁一樣，表單與彈窗共用同一份元件。
 */
export default function RegisterPage() {
  const navigate = useNavigate();

  return (
    <AuthPageLayout title="註冊">
      <RegisterForm
        onSuccess={() => navigate('/', { replace: true })}
        footer={
          <p className={formStyles.switch}>
            已經有帳號？ <Link to="/login">登入</Link>
          </p>
        }
      />
    </AuthPageLayout>
  );
}
