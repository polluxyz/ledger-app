import { Link } from 'react-router-dom';
import type { Account } from '@ledger/shared';
import { formatAmount } from '../../lib/format';
import { useAccounts } from './use-accounts';
import styles from './AccountBalances.module.css';

/**
 * 首頁的帳戶餘額列（S5-B）。
 *
 * 位置在「本月支出 / 收入 / 結餘」三張統計卡**下方、自成一列**（D4）：統計卡講的是
 * 「這段期間發生了什麼」，餘額講的是「現在還有多少」，混在一起會被誤讀成本月數字。
 *
 * 刻意**不做總餘額**——跨帳戶加總是金額運算，屬後端職責（見 `lib/format.ts`）。
 *
 * ⚠️ 本元件只能在**已登入**時渲染。hook 不能有條件呼叫，所以「未登入不要打
 * `/accounts`」這件事只能由呼叫端（`HomePage`）決定要不要渲染它來達成。
 */
export function AccountBalances() {
  const { data, isLoading, error } = useAccounts();

  return (
    <section className={styles.section} aria-labelledby="account-balances">
      <div className={styles.head}>
        <h2 className={styles.heading} id="account-balances">
          帳戶餘額
        </h2>
        {/* 三種狀態下都留著這個入口：餘額載不出來時，使用者至少走得到帳戶頁。 */}
        <Link className={styles.manage} to="/accounts">
          管理
        </Link>
      </div>

      <Body accounts={data} isLoading={isLoading} error={error} />
    </section>
  );
}

/**
 * 載入中 / 失敗 / 零帳戶 / 有資料，四種呈現（S5-C）。
 *
 * 失敗時**不用 `FormError` 的紅框**：餘額是首頁的輔助資訊，記帳表單並沒有壞掉，
 * 一塊紅框會讓人以為整頁掛了。改用一行淡色小字說明，並保留上方的「管理」連結。
 */
function Body({
  accounts,
  isLoading,
  error,
}: {
  accounts: Account[] | undefined;
  isLoading: boolean;
  error: unknown;
}) {
  // 佔位高度與資料列相同，載完不會整頁跳動。
  if (isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }
  if (error) {
    return <p className={styles.status}>餘額暫時無法載入</p>;
  }
  if (!accounts || accounts.length === 0) {
    return (
      <p className={styles.status}>
        還沒有帳戶。<Link to="/accounts">新增第一個帳戶</Link>
      </p>
    );
  }

  return (
    <div className={styles.grid}>
      {accounts.map((account) => (
        <div className={styles.cell} key={account.id}>
          <span className={styles.name}>{account.name}</span>
          <span
            className={`${styles.value} ${account.balance < 0 ? styles.negative : ''}`}
            aria-label={`${account.name}餘額`}
          >
            ${formatAmount(account.balance)}
          </span>
        </div>
      ))}
    </div>
  );
}
