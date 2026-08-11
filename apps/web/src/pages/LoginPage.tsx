import { Link } from 'react-router-dom';

/** 佔位頁：真正的登入表單於 Slice 0（Step 3）實作。 */
export default function LoginPage() {
  return (
    <section>
      <h1>登入</h1>
      <p>登入表單建置中。</p>
      <Link to="/register">還沒有帳號？註冊</Link>
    </section>
  );
}
