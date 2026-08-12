import { useEffect, useRef, useState } from 'react';
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
 * 採用瀏覽器原生的 `<dialog showModal()>`，可直接獲得焦點鎖定（focus trap）、
 * Esc 關閉、背景遮罩與背景 inert——這些無障礙行為不必自行實作，也省下一個
 * 相依套件。
 */
export function AuthDialog({ mode, onClose }: AuthDialogProps) {
  // 關閉時整個卸載（而非只是隱藏），因此下次開啟的表單狀態必定是乾淨的——
  // 不會殘留上一次輸入到一半的內容或錯誤訊息。
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<AuthDialogMode>(initialMode);

  // 掛載後才開啟：必須呼叫 showModal() 才會有焦點鎖定與遮罩，
  // 單純加上 open 屬性並不會。
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const title = view === 'login' ? '登入' : '註冊';

  return (
    <dialog
      className={styles.dialog}
      ref={dialogRef}
      aria-label={title}
      // 使用者按 Esc（或其他方式）關閉時，讓父層狀態跟著同步。
      onClose={onClose}
    >
      <div className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label="關閉">
          ×
        </button>
      </div>

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
    </dialog>
  );
}
