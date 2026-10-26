import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_HOME_LAYOUT_V1 } from '@ledger/shared';
import { describe, expect, it, vi } from 'vitest';
import { HomeBandResizeHandle } from './HomeBandResizeHandle';
import { bandResizeDeltaForKey } from './home-layout-resize-keys';

/** 這組測試釘住根列高度把手的方向鍵步距、Home／End 邊界與 separator 語意。 */
describe('HomeBandResizeHandle', () => {
  it('uses 16px and 64px keyboard steps and supports Home and End', () => {
    expect(bandResizeDeltaForKey({ key: 'ArrowUp', shiftKey: false, extraHeightPx: 20 })).toBe(-16);
    expect(bandResizeDeltaForKey({ key: 'ArrowDown', shiftKey: true, extraHeightPx: 20 })).toBe(64);
    expect(bandResizeDeltaForKey({ key: 'Home', shiftKey: false, extraHeightPx: 20 })).toBe(-20);
    expect(bandResizeDeltaForKey({ key: 'End', shiftKey: false, extraHeightPx: 20 })).toBe(1580);
  });

  it('exposes the current row height and applies keyboard resizing through resizeBand', () => {
    const onLayoutChange = vi.fn();
    render(
      <HomeBandResizeHandle
        layout={DEFAULT_HOME_LAYOUT_V1}
        bandIndex={2}
        disabled={false}
        measuredHeightPx={240}
        onLayoutChange={onLayoutChange}
      />,
    );

    const handle = screen.getByRole('separator', { name: '第 3 列高度' });
    expect(handle).toHaveAttribute('aria-valuenow', '240');
    expect(handle).toHaveAttribute('aria-valuetext', '240 像素');
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(onLayoutChange).toHaveBeenCalledWith({
      ...DEFAULT_HOME_LAYOUT_V1,
      bands: DEFAULT_HOME_LAYOUT_V1.bands.map((band, index) =>
        index === 2 ? { ...band, extraHeightPx: 16 } : band,
      ),
    });
  });
});
