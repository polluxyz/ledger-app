import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { BalanceTrend } from '@ledger/shared';
import { BalanceTrendChart } from './BalanceTrendChart';

/**
 * 首頁資產圖只驗證後端資料的呈現、鍵盤操作與讀屏名稱；座標可變，但金額和月份必須原樣可讀。
 * 測試直接傳入回應，不呼叫任何 API。
 */
describe('BalanceTrendChart', () => {
  const series = (totals: number[]): BalanceTrend['months'] =>
    totals.map((total, index) => ({
      month: `2026-${String(index + 8).padStart(2, '0')}`,
      total,
    }));

  it('keeps the latest value and month visible and exposes every month to screen readers', () => {
    const months = series([10000, 15000, 30000]);
    render(<BalanceTrendChart months={months} isLoading={false} error={null} />);

    const chart = screen.getByRole('group', {
      name: '每月資產：2026年8月：$100；2026年9月：$150；2026年10月：$300',
    });
    expect(chart).toBeInTheDocument();
    expect(screen.getByText('$300')).toBeInTheDocument();
    expect(screen.getByText('2026年10月')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2026年8月 $100' })).toBeInTheDocument();
  });

  it('shows another month on hover, click, and keyboard focus', async () => {
    const user = userEvent.setup();
    render(
      <BalanceTrendChart months={series([10000, 25000, 30000])} isLoading={false} error={null} />,
    );

    const point = screen.getByRole('button', { name: '2026年9月 $250' });
    const chart = screen.getByRole('group');
    await user.hover(point);
    expect(chart).toHaveTextContent('$250 · 2026年9月');
    await user.unhover(point);
    expect(chart).not.toHaveTextContent('$250 · 2026年9月');

    await user.click(point);
    await user.unhover(point);
    expect(chart).toHaveTextContent('$250 · 2026年9月');

    const keyboardPoint = screen.getByRole('button', { name: '2026年8月 $100' });
    act(() => keyboardPoint.focus());
    expect(chart).toHaveTextContent('$100 · 2026年8月');
    fireEvent.keyDown(keyboardPoint, { key: 'Enter', code: 'Enter' });
    expect(keyboardPoint).toHaveAttribute('aria-pressed', 'true');
  });

  it('draws horizontal lines for no accounts and for accounts with only initial balances', () => {
    const noAccounts = render(
      <BalanceTrendChart months={series([0, 0, 0])} isLoading={false} error={null} />,
    );
    const emptyLine = screen.getByRole('group').querySelectorAll('circle');
    expect(screen.getByText('$0')).toBeInTheDocument();
    expect(new Set(Array.from(emptyLine, (point) => point.getAttribute('cy'))).size).toBe(1);

    noAccounts.unmount();
    render(
      <BalanceTrendChart
        months={series([125000, 125000, 125000])}
        isLoading={false}
        error={null}
      />,
    );
    const initialBalanceLine = screen.getByRole('group').querySelectorAll('circle');
    expect(screen.getByText('$1,250')).toBeInTheDocument();
    expect(new Set(Array.from(initialBalanceLine, (point) => point.getAttribute('cy'))).size).toBe(
      1,
    );
  });

  it('draws a zero line when asset totals cross zero', () => {
    render(<BalanceTrendChart months={series([-5000, 0, 8000])} isLoading={false} error={null} />);

    expect(screen.getByRole('group').querySelector('line')).toBeInTheDocument();
  });

  it('shows a local error instead of a zero chart when loading fails', () => {
    render(<BalanceTrendChart months={undefined} isLoading={false} error={new Error('failed')} />);

    expect(screen.getByRole('status')).toHaveTextContent('資產暫時無法載入');
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
  });
});
