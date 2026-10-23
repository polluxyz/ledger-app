import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DonutChart } from './DonutChart';

/** 驗證圓餅角度與讀屏值使用傳入的統計契約，零金額不會形成假切片。 */
describe('DonutChart', () => {
  it('shows an empty state without drawing a ring when the selected direction is zero', () => {
    render(<DonutChart direction="expense" totalAmount={0} data={{ kind: 'groups', items: [] }} />);

    expect(screen.getByText('支出')).toBeInTheDocument();
    expect(screen.getByText('$0')).toBeInTheDocument();
    expect(screen.getByText('沒有資料')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toHaveAttribute('aria-label', expect.stringContaining('$0'));
    expect(document.querySelector('svg')).not.toBeInTheDocument();
  });

  it('uses the ledger denominator for member angles and does not announce percentages', () => {
    render(
      <DonutChart
        direction="expense"
        totalAmount={10_000}
        data={{
          kind: 'people',
          denominator: 10_000,
          items: [
            { personId: 'person-a', name: '小林', isMe: true, expense: 2_500, income: 0 },
            { personId: 'person-b', name: '小陳', isMe: false, expense: 7_500, income: 0 },
          ],
        }}
      />,
    );

    const chart = screen.getByRole('img');
    expect(chart).toHaveAttribute('aria-label', expect.stringContaining('小林 $25'));
    expect(chart).toHaveAttribute('aria-label', expect.stringContaining('小陳 $75'));
    expect(chart.getAttribute('aria-label')).not.toContain('%');
    expect(document.querySelectorAll('path')).toHaveLength(2);
  });

  it('omits zero-value group arcs while preserving the nonzero amount for assistive technology', () => {
    render(
      <DonutChart
        direction="income"
        totalAmount={5_000}
        data={{
          kind: 'groups',
          items: [
            {
              kind: 'CATEGORY',
              category: { id: 'food', name: '餐飲', icon: null },
              amount: 5_000,
              percentageBps: 10_000,
            },
            {
              kind: 'CATEGORY',
              category: { id: 'unused', name: '零元', icon: null },
              amount: 0,
              percentageBps: 0,
            },
          ],
        }}
      />,
    );

    expect(document.querySelectorAll('path')).toHaveLength(1);
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('餐飲 $50'),
    );
    expect(document.querySelector('path')?.getAttribute('d')).toContain('A 84 84 0 0 1 110 194');
  });
});
