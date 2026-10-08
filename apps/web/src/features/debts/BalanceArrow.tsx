import { DebtArrow } from '../../components/DebtArrow';
import { formatMoney } from '../../lib/format';

interface BalanceArrowProps {
  /** 對方的顯示名稱。 */
  name: string;
  /** 對象清單計算後的頭貼標籤；未提供時仍用名字首字。 */
  nameLabel?: string;
  /** API 給的金額（分）：正數＝對方欠我，負數＝我欠對方。 */
  amount: number;
}

/**
 * 借還清單每一列右邊的「頭貼＋箭頭＋需要支付＋金額」。對象列與沒指向的共享帳本列共用，
 * 兩種列看起來才會一致。方向只看 API 金額的正負，前端不算錢。
 */
export function BalanceArrow({ name, nameLabel, amount }: BalanceArrowProps) {
  if (amount > 0) {
    return (
      <DebtArrow
        from={name}
        fromLabel={nameLabel}
        to="我"
        amount={amount}
        label="需要支付"
        srText={`${name}欠你 ${formatMoney(amount)}`}
      />
    );
  }
  if (amount < 0) {
    return (
      <DebtArrow
        from="我"
        to={name}
        toLabel={nameLabel}
        amount={Math.abs(amount)}
        label="需要支付"
        srText={`你欠${name} ${formatMoney(Math.abs(amount))}`}
      />
    );
  }
  return <>兩清</>;
}
