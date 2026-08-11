import { useAuth } from '../features/auth/use-auth';

/** 佔位頁：帳本與交易列表於 Slice 0（Step 3）實作。 */
export default function HomePage() {
  const { logout } = useAuth();

  return (
    <section>
      <h1>記帳系統</h1>
      <p>已登入。帳本與交易畫面建置中。</p>
      <button type="button" onClick={logout}>
        登出
      </button>
    </section>
  );
}
