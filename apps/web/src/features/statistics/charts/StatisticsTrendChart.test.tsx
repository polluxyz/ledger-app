/** 驗證收支圖的座標、月份互動與讀屏內容。 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StatisticsTrendChart } from './StatisticsTrendChart';

const months = Array.from({ length: 12 }, (_, index) => ({
  month: `2026-${String(index + 1).padStart(2, '0')}`,
  income: 12000,
  expense: 40000,
  net: -31050,
  movingAverageIncome: null as number | null,
  movingAverageExpense: null as number | null,
  movingAverageMonthCount: 0,
}));

/** 用固定金額核對柱子與平均線位置，再模擬鍵盤與滑鼠操作月份。 */
describe('StatisticsTrendChart', () => {
  const props = {
    months,
    selectedMonth: '2026-12',
    showSelectedDetails: false,
    onSelectMonth: vi.fn(),
  };

  it('同欄繪製 12 根收入柱與 12 根支出柱，省略結餘圖形', () => {
    const { container } = render(<StatisticsTrendChart {...props} />);
    const zero = coordinate(container, '[data-trend-zero]', 'y1');
    const income = container.querySelectorAll('[data-series="income"]');
    const expense = container.querySelectorAll('[data-series="expense"]');
    expect(income).toHaveLength(12);
    expect(expense).toHaveLength(12);
    income.forEach((bar, index) => {
      expect(Number(bar.getAttribute('y'))).toBeLessThan(zero);
      expect(expense[index]).toHaveAttribute('y', String(zero));
      expect(Number(expense[index]!.getAttribute('height'))).toBeGreaterThan(0);
      expect(expense[index]).toHaveAttribute('x', bar.getAttribute('x')!);
    });
    expect(container.querySelector('polyline, [data-series="net"]')).toBeNull();
  });

  it('依後端金額繪製折線點，空白月斷開，並讀出實際月數', () => {
    const { container } = render(
      <StatisticsTrendChart
        {...props}
        showSelectedDetails
        months={months.map((month, index) => ({
          ...month,
          movingAverageIncome: index === 5 ? null : 6000,
          movingAverageExpense: index === 5 ? null : 20000,
          movingAverageMonthCount: index === 5 ? 0 : 3,
        }))}
      />,
    );
    const zero = coordinate(container, '[data-trend-zero]', 'y1');
    const incomeY = coordinate(container, '[data-series="income"]', 'y');
    const expenseHeight = coordinate(container, '[data-series="expense"]', 'height');
    expect(coordinate(container, '[data-average="income"] circle', 'cy')).toBeCloseTo(
      (zero + incomeY) / 2,
    );
    expect(coordinate(container, '[data-average="expense"] circle', 'cy')).toBeCloseTo(
      zero + expenseHeight / 2,
    );
    expect(container.querySelectorAll('[data-average-point]')).toHaveLength(22);
    expect(
      container.querySelector('[data-average="income"] path')?.getAttribute('d')?.match(/M/g),
    ).toHaveLength(2);
    expect(screen.getByText('收入近 6 月均')).toBeVisible();
    expect(screen.getByText('支出近 6 月均')).toBeVisible();
    expect(screen.getByText('收入近 3 月均')).toBeVisible();
    expect(screen.getByText('$60')).toBeVisible();
    expect(
      screen.getByRole('button', { name: /2026年12月：.*收入近 3 月均 .*支出近 3 月均/ }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /2026年6月：/ })).not.toHaveAccessibleName(/月均/);
  });

  it('兩條移動平均全為 null 時，只列收入與支出', () => {
    const { container } = render(<StatisticsTrendChart {...props} />);
    expect(container.querySelector('[data-average]')).toBeNull();
    const legend = screen.getByRole('list', { name: '圖例' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['收入', '支出']);
  });

  it('只畫有值的折線，零仍為有效點', () => {
    const { container } = render(
      <StatisticsTrendChart
        {...props}
        months={months.map((month) => ({
          ...month,
          movingAverageIncome: 0,
          movingAverageMonthCount: 2,
        }))}
      />,
    );
    expect(container.querySelectorAll('[data-average]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-average-point]')).toHaveLength(12);
    expect(screen.getByText('收入近 6 月均')).toBeVisible();
    expect(screen.queryByText('支出近 6 月均')).not.toBeInTheDocument();
  });

  it('全零時保留零線，所有柱高都是 0', () => {
    const { container } = render(
      <StatisticsTrendChart
        {...props}
        months={months.map((month) => ({ ...month, income: 0, expense: 0, net: 0 }))}
      />,
    );
    expect(Number.isFinite(coordinate(container, '[data-trend-zero]', 'y1'))).toBe(true);
    const bars = container.querySelectorAll('[data-series]');
    expect(bars).toHaveLength(24);
    bars.forEach((bar) => expect(bar).toHaveAttribute('height', '0'));
  });

  it('大額月份下仍保留小額柱，超出柱高的月平均也在刻度內', () => {
    const { container } = render(
      <StatisticsTrendChart
        {...props}
        months={months.map((month, index) => ({
          ...month,
          income: index === 0 ? 1_000_000_000_000 : month.income,
          movingAverageIncome: 2_000_000_000_000,
          movingAverageExpense: 80000,
          movingAverageMonthCount: 6,
        }))}
      />,
    );
    container.querySelectorAll('[data-series]').forEach((bar) => {
      expect(Number(bar.getAttribute('height'))).toBeGreaterThanOrEqual(1);
    });
    const tickYs = Array.from(container.querySelectorAll('svg line:not([data-average])'), (line) =>
      Number(line.getAttribute('y1')),
    );
    const zero = coordinate(container, '[data-trend-zero]', 'y1');
    const incomeAverage = coordinate(container, '[data-average="income"] circle', 'cy');
    const expenseAverage = coordinate(container, '[data-average="expense"] circle', 'cy');
    expect(incomeAverage).toBeGreaterThanOrEqual(Math.min(...tickYs));
    expect(incomeAverage).toBeLessThan(zero);
    expect(expenseAverage).toBeGreaterThan(zero);
    expect(expenseAverage).toBeLessThanOrEqual(Math.max(...tickYs));
  });

  it('只在期間最後一月是台灣本月時顯示截至今天', () => {
    vi.setSystemTime(new Date('2026-11-30T16:00:00Z'));
    try {
      const view = render(<StatisticsTrendChart {...props} />);
      expect(screen.getByText('截至今天')).toBeVisible();
      expect(screen.getByRole('button', { name: /2026年12月：.*截至今天/ })).toBeVisible();

      view.rerender(<StatisticsTrendChart {...props} months={months.slice(0, -1)} />);
      expect(screen.queryByText('截至今天')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /截至今天/ })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('切換月份焦點、以 Enter 或點擊選月，詳情列保留精確結餘', async () => {
    const user = userEvent.setup();
    const onSelectMonth = vi.fn();
    const view = render(<StatisticsTrendChart {...props} onSelectMonth={onSelectMonth} />);
    const chart = screen.getByRole('region', { name: '每月收支圖' });
    const buttons = within(chart).getAllByRole('button');
    const previous = buttons[10]!;
    const current = buttons[11]!;
    expect(previous).toHaveAccessibleName('2026年11月：收入 $120，支出 $400，結餘 -$310.50');
    expect(within(chart).queryByText('結餘')).not.toBeInTheDocument();
    current.focus();
    await user.keyboard('{ArrowLeft}');
    expect(previous).toHaveFocus();
    expect(within(chart).getByText('結餘')).toBeVisible();
    expect(within(chart).getByText('-$310.50')).toBeVisible();
    await user.keyboard('{Enter}');
    expect(onSelectMonth).toHaveBeenLastCalledWith('2026-11');
    await user.keyboard('{ArrowRight}');
    expect(current).toHaveFocus();
    expect(within(chart).queryByText('結餘')).not.toBeInTheDocument();

    await user.click(buttons[0]!);
    expect(onSelectMonth).toHaveBeenLastCalledWith('2026-01');
    current.focus();
    view.rerender(
      <StatisticsTrendChart {...props} showSelectedDetails onSelectMonth={onSelectMonth} />,
    );
    expect(within(chart).getByText('-$310.50')).toBeVisible();
  });
});

function coordinate(container: HTMLElement, selector: string, attribute: string): number {
  return Number(container.querySelector(selector)?.getAttribute(attribute));
}
