import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TrendLineChart } from './TrendLineChart';

/** 驗證折線點位可處理零、常數與負值序列，且月份互動與無障礙標籤正確。 */
describe('TrendLineChart', () => {
  it('renders finite coordinates for all-zero and constant values and draws the zero line', () => {
    const { container, rerender } = render(
      <TrendLineChart
        selectedMonth="2026-04"
        onSelectMonth={vi.fn()}
        months={[
          { month: '2026-04', income: 0, expense: 0, net: 0 },
          { month: '2026-05', income: 0, expense: 0, net: 0 },
        ]}
      />,
    );

    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('收入 $0'),
    );
    expect(container.querySelector('[data-zero-line="true"]')).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);

    rerender(
      <TrendLineChart
        selectedMonth="2026-04"
        onSelectMonth={vi.fn()}
        months={[
          { month: '2026-04', income: 10_000, expense: 10_000, net: 0 },
          { month: '2026-05', income: 10_000, expense: 10_000, net: 0 },
        ]}
      />,
    );
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it('draws the baseline when balance moves from negative to positive', () => {
    const { container } = render(
      <TrendLineChart
        selectedMonth="2026-04"
        onSelectMonth={vi.fn()}
        months={[
          { month: '2026-04', income: 0, expense: 100, net: -100 },
          { month: '2026-05', income: 200, expense: 0, net: 200 },
        ]}
      />,
    );

    expect(container.querySelector('[data-zero-line="true"]')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('結餘 -$1'),
    );
  });

  it('shows an empty state without generating SVG coordinates for empty data', () => {
    const { container } = render(
      <TrendLineChart months={[]} selectedMonth="2026-04" onSelectMonth={vi.fn()} />,
    );
    expect(screen.getByText('沒有資料')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });

  it('maps negative values around zero without exceeding the viewBox', () => {
    const { container } = render(
      <TrendLineChart
        selectedMonth="2026-04"
        onSelectMonth={vi.fn()}
        months={[{ month: '2026-04', income: -100, expense: 200, net: -300 }]}
      />,
    );

    const zeroLine = container.querySelector('[data-zero-line="true"]');
    expect(zeroLine).toHaveAttribute('y1', '140');
    for (const point of container.querySelectorAll('circle')) {
      const x = Number(point.getAttribute('cx'));
      const y = Number(point.getAttribute('cy'));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(720);
      expect(y).toBeGreaterThanOrEqual(20);
      expect(y).toBeLessThanOrEqual(200);
    }
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it('previews months on hover and focus, then returns to selected totals', async () => {
    const user = userEvent.setup();
    const onSelectMonth = vi.fn();
    const { container } = render(
      <TrendLineChart
        selectedMonth="2026-04"
        onSelectMonth={onSelectMonth}
        months={[
          { month: '2026-04', income: 10_000, expense: 20_000, net: -10_000 },
          { month: '2026-05', income: 30_000, expense: 5_000, net: 25_000 },
        ]}
      />,
    );

    const summary = within(container.querySelector('dl') as HTMLElement);
    const mayButton = screen.getByRole('button', { name: /2026年5月/ });
    await user.hover(mayButton);
    expect(summary.getByText('$300')).toBeInTheDocument();
    expect(summary.getByText('$50')).toBeInTheDocument();
    expect(summary.getByText('$250')).toBeInTheDocument();
    expect(onSelectMonth).not.toHaveBeenCalled();

    await user.unhover(mayButton);
    expect(summary.getByText('$100')).toBeInTheDocument();
    expect(summary.getByText('$200')).toBeInTheDocument();
    expect(summary.getByText('-$100')).toBeInTheDocument();

    act(() => mayButton.focus());
    expect(summary.getByText('$300')).toBeInTheDocument();
    expect(onSelectMonth).not.toHaveBeenCalled();
    act(() => mayButton.blur());
    expect(summary.getByText('$100')).toBeInTheDocument();
  });

  it('selects a month only on click or keyboard activation', async () => {
    const user = userEvent.setup();
    const onSelectMonth = vi.fn();
    render(
      <TrendLineChart
        selectedMonth="2026-04"
        onSelectMonth={onSelectMonth}
        months={[
          { month: '2026-04', income: 10_000, expense: 20_000, net: -10_000 },
          { month: '2026-05', income: 30_000, expense: 5_000, net: 25_000 },
        ]}
      />,
    );

    const aprilButton = screen.getByRole('button', { name: /2026年4月/ });
    const mayButton = screen.getByRole('button', { name: /2026年5月/ });
    expect(aprilButton).toHaveAttribute('aria-pressed', 'true');
    expect(mayButton).toHaveAccessibleName('2026年5月：收入 $300，支出 $50，結餘 $250');
    expect(mayButton).toHaveAttribute('aria-pressed', 'false');
    await user.click(mayButton);
    expect(onSelectMonth).toHaveBeenCalledTimes(1);
    expect(onSelectMonth).toHaveBeenCalledWith('2026-05');

    onSelectMonth.mockClear();
    act(() => aprilButton.focus());
    await user.keyboard('{Enter}');
    expect(onSelectMonth).toHaveBeenCalledTimes(1);
    expect(onSelectMonth).toHaveBeenCalledWith('2026-04');

    onSelectMonth.mockClear();
    await user.keyboard(' ');
    expect(onSelectMonth).toHaveBeenCalledTimes(1);
    expect(onSelectMonth).toHaveBeenCalledWith('2026-04');
  });
});
