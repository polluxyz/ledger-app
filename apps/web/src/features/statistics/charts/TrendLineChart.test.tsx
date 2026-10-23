import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrendLineChart } from './TrendLineChart';

/** 驗證折線點位可處理零、常數與負值序列，且跨零結餘會繪出正確位置的零線。 */
describe('TrendLineChart', () => {
  it('renders finite coordinates for all-zero and constant values and draws the zero line', () => {
    const { container, rerender } = render(
      <TrendLineChart
        months={[
          { month: '2026-04', income: 0, expense: 0, net: 0 },
          { month: '2026-05', income: 0, expense: 0, net: 0 },
        ]}
      />,
    );

    expect(screen.getByRole('img')).toHaveAttribute('aria-label', expect.stringContaining('$0'));
    expect(container.querySelector('[data-zero-line="true"]')).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);

    rerender(
      <TrendLineChart
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
        months={[
          { month: '2026-04', income: 0, expense: 100, net: -100 },
          { month: '2026-05', income: 200, expense: 0, net: 200 },
        ]}
      />,
    );

    expect(container.querySelector('[data-zero-line="true"]')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', expect.stringContaining('-$1'));
  });

  it('shows an empty state without generating SVG coordinates for empty data', () => {
    const { container } = render(<TrendLineChart months={[]} />);
    expect(container.querySelector('p')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });

  it('maps negative values around zero without exceeding the viewBox', () => {
    const { container } = render(
      <TrendLineChart months={[{ month: '2026-04', income: -100, expense: 200, net: -300 }]} />,
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
});
