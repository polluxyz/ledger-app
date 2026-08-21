import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';
import styles from './AuthDialog.module.css';

export type AuthDialogMode = 'login' | 'register';

interface AuthDialogProps {
  /** null 代表關閉；給值則開啟並決定先顯示哪張表單。 */
  mode: AuthDialogMode | null;
  onClose: () => void;
}

/**
 * 登入 / 註冊彈窗。使用者停留在原本的頁面，登入完成後當場看到自己的資料，
 * 不必跳走再跳回來。
 *
 * 外殼（原生 `<dialog>`、標題列、關閉鈕、關閉時卸載）由共用的 `Dialog` 提供；
 * 這裡只負責「顯示哪一張表單」與兩者之間的切換。
 */
export function AuthDialog({ mode, onClose }: AuthDialogProps) {
  // 這一層的卸載決定的是「表單的狀態」：關閉後重開時 view 會回到呼叫端指定的
  // 那一張，而不是停在上次切過去的那張。
  if (!mode) {
    return null;
  }
  return <AuthDialogContent initialMode={mode} onClose={onClose} />;
}

function AuthDialogContent({
  initialMode,
  onClose,
}: {
  initialMode: AuthDialogMode;
  onClose: () => void;
}) {
  const [view, setView] = useState<AuthDialogMode>(initialMode);
  const title = view === 'login' ? '登入' : '註冊';

  return (
    <Dialog open title={title} onClose={onClose}>
      {view === 'login' ? (
        <LoginForm
          onSuccess={onClose}
          footer={
            <p className={styles.switch}>
              還沒有帳號？
              <button type="button" className={styles.link} onClick={() => setView('register')}>
                改用註冊
              </button>
            </p>
          }
        />
      ) : (
        <RegisterForm
          onSuccess={onClose}
          footer={
            <p className={styles.switch}>
              已經有帳號？
              <button type="button" className={styles.link} onClick={() => setView('login')}>
                改用登入
              </button>
            </p>
          }
        />
      )}
    </Dialog>
  );
}
