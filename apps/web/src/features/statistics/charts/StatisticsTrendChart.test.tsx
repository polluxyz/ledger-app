import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StatisticsTrendChart } from './StatisticsTrendChart';

const months = [
  { month: '2026-09', income: 12000, expense: 40000, net: -31050 },
  { month: '2026-10', income: 60000, expense: 15000, net: 45000 },
];

/** 核對結餘原值、共用坐標和月份鍵盤互動。 */
describe('StatisticsTrendChart', () => {
  it.each([
    ['全正', [12000, 45000]],
    ['含負', [-31050, 45000]],
    ['全零', [0, 0]],
    ['常數', [15000, 15000]],
  ] as const)('保留有效座標：%s', (_case, amounts) => {
    const { container } = render(
      <StatisticsTrendChart
        months={months.map((month, index) => ({
          ...month,
          income: _case === '全零' ? 0 : _case === '常數' ? 15000 : month.income,
          expense: _case === '全零' ? 0 : _case === '常數' ? 15000 : month.expense,
          net: amounts[index]!,
        }))}
        selectedMonth="2026-10"
        showSelectedDetails={false}
        onSelectMonth={vi.fn()}
      />,
    );
    const zero = Number(container.querySelector('[data-trend-zero]')?.getAttribute('y1'));
    const ys = Array.from(container.querySelectorAll('[data-series="net"]'), (node) =>
      Number(node.getAttribute('cy')),
    );
    expect(ys).toHaveLength(amounts.length);
    expect(ys.every(Number.isFinite)).toBe(true);
    expect(ys.map((y) => (y === zero ? 0 : y > zero ? -1 : 1))).toEqual(amounts.map(Math.sign));
  });

  it('只在月期間聚焦其他月份時顯示詳情，並以 Enter 選月', async () => {
    const user = userEvent.setup();
    const onSelectMonth = vi.fn();
    const view = render(
      <StatisticsTrendChart
        months={months}
        selectedMonth="2026-10"
        showSelectedDetails={false}
        onSelectMonth={onSelectMonth}
      />,
    );
    const chart = screen.getByRole('region', { name: '收支趨勢圖' });
    const [previous, current] = within(chart).getAllByRole('button');
    expect(previous).toHaveAccessibleName('2026年9月：收入 $120，支出 $400，結餘 -$310.50');
    expect(within(chart).queryByRole('definition')).not.toBeInTheDocument();
    current!.focus();
    await user.keyboard('{ArrowLeft}');
    expect(previous).toHaveFocus();
    expect(within(chart).getByText('-$310.50')).toBeVisible();
    await user.keyboard('{Enter}');
    expect(onSelectMonth).toHaveBeenCalledWith('2026-09');
    await user.keyboard('{ArrowRight}');
    expect(current).toHaveFocus();
    expect(within(chart).queryByRole('definition')).not.toBeInTheDocument();

    view.rerender(
      <StatisticsTrendChart
        months={months}
        selectedMonth="2026-10"
        showSelectedDetails
        onSelectMonth={onSelectMonth}
      />,
    );
    expect(within(chart).getByText('$450')).toBeVisible();
  });
});
