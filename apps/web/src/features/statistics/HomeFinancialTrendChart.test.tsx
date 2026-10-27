import { act } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { HomeFinancialTrendChart } from './HomeFinancialTrendChart';
import { getFinancialTrendLayout } from './financial-trend-layout';
import { HomeTrendHeader } from './HomeTrendHeader';

const series = (totals: number[]) =>
  totals.map((total, index) => ({ month: `2026-${String(index + 8).padStart(2, '0')}`, total }));

/** 原值、座標、鍵盤與中途取消分開驗證；不呼叫 API，也不由資產推算結餘。 */
describe('Home financial trend', () => {
  afterEach(() => document.documentElement.removeAttribute('data-motion'));

  it.each([
    [0, 0, 0],
    [500, 500, 500],
    [-5000, 0, 8000],
    [-8000, -5000, -1],
    [Number.MAX_SAFE_INTEGER, 0, -Number.MAX_SAFE_INTEGER],
  ])('keeps zero-based finite coordinates for %j', (...totals) => {
    const layout = getFinancialTrendLayout(totals, 309, 180);
    expect(Number.isFinite(layout.baseline)).toBe(true);
    layout.bars.forEach((bar, index) => {
      expect(Number.isFinite(bar.height)).toBe(true);
      expect(bar.height).toBeGreaterThanOrEqual(0);
      expect(bar.y).toBeGreaterThanOrEqual(12 - 0.01);
      expect(bar.y + bar.height).toBeLessThanOrEqual(146.01);
      if (totals[index] === 0) expect(bar.height).toBe(0);
      else if (totals[index]! < 0) expect(bar.y).toBeCloseTo(layout.baseline);
      else expect(bar.y + bar.height).toBeCloseTo(layout.baseline);
    });
  });

  it('shows exact cents, latest total and a zero marker without a line chart', () => {
    const { container } = render(
      <HomeFinancialTrendChart
        months={series([-5000, 0, 166667])}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByLabelText('總資產 $1,666.67')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2026年8月 -$50' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-trend-bar]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-zero-marker]')).toHaveLength(1);
    expect(container.querySelector('path')).not.toBeInTheDocument();
  });

  it('shows a selected month using pointer and keyboard without replacing the latest total', async () => {
    const user = userEvent.setup();
    render(
      <HomeFinancialTrendChart
        months={series([10000, 25000, 30000])}
        isLoading={false}
        error={null}
        metric="net"
      />,
    );
    const first = screen.getByRole('button', { name: '2026年8月 $100' });
    await user.hover(first);
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('本月結餘 $300')).toBeInTheDocument();
    act(() => first.focus());
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: '2026年9月 $250' })).toHaveFocus();
    expect(screen.getByRole('button', { name: '2026年9月 $250' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('keeps local loading and error states distinct from zero', () => {
    const view = render(
      <HomeFinancialTrendChart months={undefined} isLoading error={null} metric="net" />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('載入中');
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
    view.rerender(
      <HomeFinancialTrendChart
        months={undefined}
        isLoading={false}
        error={new Error('private')}
        metric="net"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('結餘暫時無法載入');
    expect(screen.queryByText('private')).not.toBeInTheDocument();
  });

  it('stops an active transition when the site animation switch is turned off', async () => {
    const view = render(
      <HomeFinancialTrendChart
        months={series([10000, 20000, 30000])}
        isLoading={false}
        error={null}
      />,
    );
    view.rerender(
      <HomeFinancialTrendChart
        months={series([-5000, 0, 10000])}
        isLoading={false}
        error={null}
        metric="net"
      />,
    );
    expect(screen.getByRole('group')).toHaveAttribute('data-animating', 'true');
    act(() => document.documentElement.setAttribute('data-motion', 'off'));
    await waitFor(() => expect(screen.getByRole('group')).not.toHaveAttribute('data-animating'));
    const bar = screen
      .getByRole('button', { name: '2026年8月 -$50' })
      .querySelector('[data-trend-bar]')!;
    const zero = screen.getByRole('group').querySelector('[data-trend-zero]')!;
    expect(Number(bar.getAttribute('y'))).toBeCloseTo(Number(zero.getAttribute('y1')));
  });

  it('places assets left and net right and disables net without a ledger', () => {
    render(<HomeTrendHeader metric="assets" onChange={() => {}} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '總資產變化',
      '每月結餘',
    ]);
    expect(screen.getByRole('button', { name: '每月結餘' })).toBeDisabled();
  });
});
