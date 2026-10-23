import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(document.querySelector('path')?.getAttribute('d')).toContain('A 84 84 0 0 1 110 194');
  });

  it('selects category slices with a click and with Enter or Space', () => {
    const onSelect = vi.fn();
    const category = {
      kind: 'CATEGORY' as const,
      category: { id: 'food', name: '餐飲', icon: null },
      amount: 5_000,
      percentageBps: 10_000,
    };
    render(
      <DonutChart
        direction="expense"
        totalAmount={5_000}
        data={{ kind: 'groups', items: [category], onSelect }}
      />,
    );

    const slice = screen.getByRole('button', { name: '餐飲 $50' });
    expect(slice).toHaveAttribute('tabindex', '0');
    fireEvent.click(slice);
    fireEvent.keyDown(slice, { key: 'Enter' });
    fireEvent.keyDown(slice, { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(onSelect).toHaveBeenCalledWith(category);
  });

  it('does not make fixed groups or groups without onSelect clickable', () => {
    const onSelect = vi.fn();
    const fixed = {
      kind: 'BAD_DEBT' as const,
      category: null,
      amount: 2_000,
      percentageBps: 10_000,
    };
    const { rerender } = render(
      <DonutChart
        direction="expense"
        totalAmount={2_000}
        data={{ kind: 'groups', items: [fixed], onSelect }}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('group', { name: /呆帳/ }));
    expect(onSelect).not.toHaveBeenCalled();

    rerender(
      <DonutChart
        direction="expense"
        totalAmount={2_000}
        data={{ kind: 'groups', items: [fixed] }}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
