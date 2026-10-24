import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BalanceTrend } from '@ledger/shared';
import { getFinalLabelYPositions } from './balance-trend-chart-layout';
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

  it.each([
    {
      name: '最後一段從上方進來時放在點下方',
      previous: { x: 0, y: 80 },
      expected: { valueY: 123, monthY: 140 },
    },
    {
      name: '最後一段從下方進來時放在點上方',
      previous: { x: 0, y: 120 },
      expected: { valueY: 71, monthY: 88 },
    },
    {
      name: '最後一段水平時放在點上方',
      previous: { x: 0, y: 100 },
      expected: { valueY: 71, monthY: 88 },
    },
    {
      name: '只有一個點時放在點上方',
      previous: undefined,
      expected: { valueY: 71, monthY: 88 },
    },
  ])('$name', ({ previous, expected }) => {
    expect(getFinalLabelYPositions(previous, { x: 200, y: 100 }, { top: 0, bottom: 200 })).toEqual(
      expected,
    );
  });

  it('keeps both label boxes inside the chart when the final point is near either edge', () => {
    const bounds = { top: 0, bottom: 100 };
    const upperPoint = { x: 200, y: 14 };
    const upper = getFinalLabelYPositions({ x: 0, y: 40 }, upperPoint, bounds);
    expect(upper.valueY - 14).toBeGreaterThanOrEqual(bounds.top);
    expect(upper.monthY + 3).toBeLessThanOrEqual(bounds.bottom);
    expect(upper.valueY - 14).toBeGreaterThan(upperPoint.y + 7);

    const lowerPoint = { x: 200, y: 86 };
    const lower = getFinalLabelYPositions({ x: 0, y: 60 }, lowerPoint, bounds);
    expect(lower.valueY - 14).toBeGreaterThanOrEqual(bounds.top);
    expect(lower.monthY + 3).toBeLessThanOrEqual(bounds.bottom);
    expect(lower.monthY + 3).toBeLessThan(lowerPoint.y - 7);
  });

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
    expect(screen.getByRole('heading', { name: '資產趨勢' })).toBeInTheDocument();
  });

  it('uses the measured SVG dimensions as its viewBox', () => {
    class MockResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}

      observe(target: Element) {
        const contentRect = {
          x: 0,
          y: 0,
          top: 0,
          right: 320,
          bottom: 180,
          left: 0,
          width: 320,
          height: 180,
          toJSON: () => ({}),
        } as DOMRectReadOnly;
        this.callback(
          [
            {
              target,
              contentRect,
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            },
          ],
          this,
        );
      }

      disconnect() {}
      unobserve() {}
    }

    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    try {
      render(
        <BalanceTrendChart months={series([10000, 15000, 30000])} isLoading={false} error={null} />,
      );

      expect(screen.getByRole('group')).toHaveAttribute('viewBox', '0 0 320 180');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses the original viewBox when ResizeObserver is unavailable or measures zero', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    try {
      const { unmount } = render(
        <BalanceTrendChart months={series([10000, 15000, 30000])} isLoading={false} error={null} />,
      );
      expect(screen.getByRole('group')).toHaveAttribute('viewBox', '0 0 640 230');
      unmount();
    } finally {
      vi.unstubAllGlobals();
    }

    class ZeroSizeResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}

      observe(target: Element) {
        const contentRect = {
          x: 0,
          y: 0,
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          width: 0,
          height: 0,
          toJSON: () => ({}),
        } as DOMRectReadOnly;
        this.callback(
          [
            {
              target,
              contentRect,
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            },
          ],
          this,
        );
      }

      disconnect() {}
      unobserve() {}
    }

    vi.stubGlobal('ResizeObserver', ZeroSizeResizeObserver);
    try {
      render(
        <BalanceTrendChart months={series([10000, 15000, 30000])} isLoading={false} error={null} />,
      );
      expect(screen.getByRole('group')).toHaveAttribute('viewBox', '0 0 640 230');
    } finally {
      vi.unstubAllGlobals();
    }
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

  it('keeps the asset trend title visible while loading', () => {
    render(<BalanceTrendChart months={undefined} isLoading error={null} />);

    expect(screen.getByRole('heading', { name: '資產趨勢' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('載入中…');
  });

  it('shows a local error instead of a zero chart when loading fails', () => {
    render(<BalanceTrendChart months={undefined} isLoading={false} error={new Error('failed')} />);

    expect(screen.getByRole('status')).toHaveTextContent('資產暫時無法載入');
    expect(screen.getByRole('heading', { name: '資產趨勢' })).toBeInTheDocument();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
  });
});
