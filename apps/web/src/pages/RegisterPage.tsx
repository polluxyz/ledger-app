import { Link } from 'react-router-dom';

/** 佔位頁：真正的註冊表單於 Slice 0（Step 3）實作。 */
export default function RegisterPage() {
  return (
    <section>
      <h1>註冊</h1>
      <p>註冊表單建置中。</p>
      <Link to="/login">已經有帳號？登入</Link>
    </section>
  );
}
