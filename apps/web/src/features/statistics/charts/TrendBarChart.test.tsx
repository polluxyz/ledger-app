import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TrendBarChart } from './TrendBarChart';

/** 驗證趨勢長條圖摘要與月份選擇都呈現 API 的精確金額並能用鍵盤操作。 */
describe('TrendBarChart', () => {
  it('uses compact visible month labels and retains full dates for assistive technology', () => {
    const { container } = render(
      <TrendBarChart
        selectedMonth="2026-02"
        onSelectMonth={vi.fn()}
        months={[
          { month: '2025-11', income: 10_000, expense: 20_000, net: -10_000 },
          { month: '2025-12', income: 30_000, expense: 5_000, net: 25_000 },
          { month: '2026-01', income: 30_000, expense: 5_000, net: 25_000 },
          { month: '2026-02', income: 30_000, expense: 5_000, net: 25_000 },
        ]}
      />,
    );

    const monthButtons = [...container.querySelectorAll('button')];
    expect(
      monthButtons.map((button) =>
        button.querySelector(':scope > span:nth-of-type(2)')?.textContent?.replace(/\s/g, ''),
      ),
    ).toEqual(['11月2025', '12月', '1月2026', '2月']);
    expect(monthButtons[0]).toHaveAccessibleName('2025年11月，收入 $100，支出 $200，結餘 -$100');
  });

  it('shows the selected month totals and selects a month with the keyboard', async () => {
    const user = userEvent.setup();
    const onSelectMonth = vi.fn();
    render(
      <TrendBarChart
        selectedMonth="2026-06"
        onSelectMonth={onSelectMonth}
        months={[
          { month: '2026-05', income: 20_000, expense: 8_000, net: 12_000 },
          { month: '2026-06', income: 135_500, expense: 150_000, net: -14_500 },
        ]}
      />,
    );

    expect(screen.getByText('$1,355')).toBeInTheDocument();
    expect(screen.getByText('$1,500')).toBeInTheDocument();
    expect(screen.getByText('-$145')).toBeInTheDocument();

    const previousMonth = screen.getByRole('button', {
      name: /2026年5月，收入 \$200，支出 \$80，結餘 \$120/,
    });
    previousMonth.focus();
    await user.keyboard('{Enter}');
    expect(onSelectMonth).toHaveBeenCalledWith('2026-05');
  });

  it('previews hovered and focused months without selecting them', async () => {
    const user = userEvent.setup();
    const onSelectMonth = vi.fn();
    render(
      <TrendBarChart
        selectedMonth="2026-06"
        onSelectMonth={onSelectMonth}
        months={[
          { month: '2026-05', income: 20_000, expense: 8_000, net: 12_000 },
          { month: '2026-06', income: 135_500, expense: 150_000, net: -14_500 },
        ]}
      />,
    );

    const mayButton = screen.getByRole('button', { name: /2026年5月/ });
    await user.hover(mayButton);
    expect(screen.getByText('$200')).toBeInTheDocument();
    expect(onSelectMonth).not.toHaveBeenCalled();

    await user.unhover(mayButton);
    expect(screen.getByText('$1,355')).toBeInTheDocument();

    act(() => mayButton.focus());
    expect(screen.getByText('$200')).toBeInTheDocument();
    expect(onSelectMonth).not.toHaveBeenCalled();
    act(() => mayButton.blur());
    expect(screen.getByText('$1,355')).toBeInTheDocument();
  });

  it('renders an empty state for an empty trend', () => {
    render(<TrendBarChart months={[]} selectedMonth="2026-06" onSelectMonth={vi.fn()} />);
    expect(screen.getByText('沒有資料')).toBeInTheDocument();
  });
});
