import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrendTable } from './TrendTable';

/** 驗證趨勢表依 API 的舊到新順序列出每月收入、支出與結餘。 */
describe('TrendTable', () => {
  it('renders rows from oldest month to newest and includes all exact totals', () => {
    render(
      <TrendTable
        months={[
          { month: '2026-04', income: 12_345, expense: 5_000, net: 7_345 },
          { month: '2026-05', income: 200_000, expense: 212_345, net: -12_345 },
        ]}
      />,
    );

    const rows = screen.getAllByRole('row');
    const oldestRow = rows[1];
    const newestRow = rows[2];
    if (!oldestRow || !newestRow) {
      throw new Error('Expected the trend table header and two month rows');
    }
    expect(rows).toHaveLength(3);
    expect(within(oldestRow).getByRole('rowheader')).toHaveTextContent('2026年4月');
    expect(within(newestRow).getByRole('rowheader')).toHaveTextContent('2026年5月');
    expect(within(oldestRow).getByText('$123.45')).toBeInTheDocument();
    expect(within(newestRow).getByText('-$123.45')).toBeInTheDocument();
  });

  it('shows an empty row when there are no months', () => {
    render(<TrendTable months={[]} />);
    expect(screen.getByText('沒有資料')).toBeInTheDocument();
  });
});
