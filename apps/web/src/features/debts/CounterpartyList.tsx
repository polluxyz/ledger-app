import { useState } from 'react';
import { DebtArrow } from '../../components/DebtArrow';
import { FormError } from '../../components/FormError';
import { Pagination } from '../../components/Pagination';
import { formatMoney } from '../../lib/format';
import { useCounterparties } from './use-debts';
import styles from './CounterpartyList.module.css';

interface CounterpartyListProps {
  /** 每列都用按鈕，滑鼠、鍵盤與螢幕閱讀器走同一個開啟入口。 */
  onSelectCounterparty: (counterpartyId: string) => void;
}

/** 對象清單由 API 分頁與排序；列上的金額文字只呈現回傳餘額，不自行推算。 */
export function CounterpartyList({ onSelectCounterparty }: CounterpartyListProps) {
  const [page, setPage] = useState(1);
  const counterparties = useCounterparties({ page, limit: 20 });

  if (counterparties.isLoading) {
    return <p className={styles.status}>載入中…</p>;
  }
  if (counterparties.error) {
    return <FormError error={counterparties.error} />;
  }
  if (!counterparties.data || counterparties.data.items.length === 0) {
    return <p className={styles.empty}>還沒有借還紀錄，從『新增交易 → 借還』開始記第一筆</p>;
  }

  return (
    <>
      <ul className={styles.list}>
        {counterparties.data.items.map((counterparty) => (
          <li key={counterparty.id} className={styles.item}>
            <button
              type="button"
              className={styles.row}
              onClick={() => onSelectCounterparty(counterparty.id)}
            >
              <span className={styles.nameGroup}>
                <span className={styles.name}>{counterparty.displayName}</span>
                {counterparty.link !== null && <span className={styles.linkBadge}>連動</span>}
              </span>
              <span className={styles.balance}>
                {formatCounterpartyBalance(counterparty.displayName, counterparty.balance)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Pagination
        page={counterparties.data.page}
        limit={counterparties.data.limit}
        total={counterparties.data.total}
        onChange={setPage}
      />
    </>
  );
}

/** 清單用箭頭呈現 API 回傳的往來方向；零餘額維持簡短的「兩清」。 */
function formatCounterpartyBalance(displayName: string, balance: number) {
  if (balance > 0) {
    return (
      <DebtArrow
        from={displayName}
        to="我"
        amount={balance}
        label="需要支付"
        srText={`${displayName}欠你 ${formatMoney(balance)}`}
      />
    );
  }
  if (balance < 0) {
    return (
      <DebtArrow
        from="我"
        to={displayName}
        amount={Math.abs(balance)}
        label="需要支付"
        srText={`你欠${displayName} ${formatMoney(Math.abs(balance))}`}
      />
    );
  }
  return '兩清';
}
