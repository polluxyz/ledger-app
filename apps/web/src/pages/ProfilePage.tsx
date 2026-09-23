import { useState, type FormEvent } from 'react';
import type { AuthUser } from '@ledger/shared';
import { Button } from '../components/Button';
import { FormError } from '../components/FormError';
import { PageHeader } from '../components/PageHeader';
import { TextField } from '../components/TextField';
import { useCurrentUser, useUpdateProfile } from '../features/auth/use-current-user';
import styles from './ProfilePage.module.css';

/**
 * 個人資料頁：檢視 email、改顯示名稱。
 *
 * 這一頁能改的只有名稱。email 是登入身分的主鍵，後端根本沒有提供修改的端點，
 * 畫面上也如實呈現「不可變更」——不做 disabled 的輸入框，那會讓人誤以為
 * 之後會開放。
 *
 * 表單刻意拆成內層元件：資料從後端非同步抵達，等它到了才渲染表單，
 * `useState` 就能直接以使用者名稱初始化，不必事後同步（那是 effect 最容易
 * 踩坑的用法——一不小心就會把使用者正在打的字蓋掉）。
 */
export default function ProfilePage() {
  const user = useCurrentUser();

  // 載入中與載入失敗也戴上頁首：標題一開始就落在該在的位置，
  // 資料回來時只有卡片出現，標題不會晚一拍才跳出來。
  if (user.isLoading) {
    return (
      <section className={styles.page}>
        <PageHeader title="個人資料" />
        <p className={styles.status}>載入中…</p>
      </section>
    );
  }

  if (user.error || !user.data) {
    return (
      <section className={styles.page}>
        <PageHeader title="個人資料" />
        <p className={styles.status}>無法載入個人資料，請稍後再試。</p>
      </section>
    );
  }

  return <ProfileForm user={user.data} />;
}

function ProfileForm({ user }: { user: AuthUser }) {
  const updateProfile = useUpdateProfile();
  const [name, setName] = useState(user.name);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // 只送 name——多送任何欄位都會被後端退成 400（見 useUpdateProfile 的說明）。
    updateProfile.mutate({ name });
  }

  return (
    <section className={styles.page}>
      <PageHeader title="個人資料" />

      {/* 一張卡片裝完這一頁：上半是看的（Email），分隔線以下是改的（顯示名稱）。 */}
      <div className={styles.card}>
        <div>
          <span className={styles.emailLabel}>Email</span>
          <p className={styles.emailValue}>
            {user.email}
            <span className={styles.emailNote}>Email 不可變更</span>
          </p>
        </div>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <FormError error={updateProfile.error} />

          <TextField
            label="顯示名稱"
            value={name}
            required
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
          />

          {/* 失敗時什麼都不清、不重設——使用者剛打的字不能消失。 */}
          <Button type="submit" disabled={updateProfile.isPending}>
            {updateProfile.isPending ? '儲存中…' : '儲存'}
          </Button>
        </form>
      </div>
    </section>
  );
}
