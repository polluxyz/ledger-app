import type { StatisticsTrendMonth } from '@ledger/shared';
import { formatMoney } from '../../../lib/format';
import styles from './TrendTable.module.css';

/** 趨勢表格照 API 提供的舊到新順序呈現每月三項精確金額。 */
export interface TrendTableProps {
  months: readonly StatisticsTrendMonth[];
  title?: string;
}

export function TrendTable({ months, title = '趨勢表格' }: TrendTableProps) {
  return (
    <div className={styles.wrapper}>
      <table className={styles.table} aria-label={title}>
        <thead>
          <tr>
            <th scope="col">月份</th>
            <th scope="col">收入</th>
            <th scope="col">支出</th>
            <th scope="col">結餘</th>
          </tr>
        </thead>
        <tbody>
          {months.length > 0 ? (
            months.map((month) => (
              <tr key={month.month}>
                <th scope="row" aria-label={formatMonth(month.month)}>
                  <span className={styles.monthYear}>{formatMonthYear(month.month)}年</span>
                  <span className={styles.monthNumber}>{formatMonthNumber(month.month)}月</span>
                </th>
                <td>{formatMoney(month.income)}</td>
                <td>{formatMoney(month.expense)}</td>
                <td>{formatMoney(month.net)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={4} className={styles.empty}>
                沒有資料
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function formatMonthYear(month: string): string {
  const [year] = month.split('-');
  return year ?? '';
}

function formatMonthNumber(month: string): number {
  return Number(month.split('-')[1]);
}

function formatMonth(month: string): string {
  return `${formatMonthYear(month)}年${formatMonthNumber(month)}月`;
}
