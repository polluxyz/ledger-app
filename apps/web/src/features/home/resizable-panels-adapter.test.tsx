import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_HOME_LAYOUT_V1 } from '@ledger/shared';
import { resizeSplit } from './layout-ops';
import { ResizableSplitView } from './resizable-panels-adapter';
import { splitResizeDeltaForKey } from './home-layout-resize-keys';

const originalResizeObserver = window.ResizeObserver;

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** 這組測試驗證套件分隔線的鍵盤步距、邊界、separator 語意與專案權重回寫。 */
describe('ResizableSplitView', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: TestResizeObserver,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalResizeObserver) {
      Object.defineProperty(window, 'ResizeObserver', {
        configurable: true,
        value: originalResizeObserver,
      });
    } else {
      Reflect.deleteProperty(window, 'ResizeObserver');
    }
  });

  const layout = DEFAULT_HOME_LAYOUT_V1;
  const node = layout.bands[1]!.root;

  it('maps arrows, Shift, Home, and End to 16px or 64px and legal boundaries', () => {
    expect(
      splitResizeDeltaForKey({
        key: 'ArrowRight',
        shiftKey: false,
        currentFirstSize: 400,
        pairSize: 900,
        firstMinimum: 300,
        secondMinimum: 300,
      }),
    ).toBe(16);
    expect(
      splitResizeDeltaForKey({
        key: 'ArrowLeft',
        shiftKey: true,
        currentFirstSize: 400,
        pairSize: 900,
        firstMinimum: 300,
        secondMinimum: 300,
      }),
    ).toBe(-64);
    expect(
      splitResizeDeltaForKey({
        key: 'Home',
        shiftKey: false,
        currentFirstSize: 400,
        pairSize: 900,
        firstMinimum: 300,
        secondMinimum: 300,
      }),
    ).toBe(-100);
    expect(
      splitResizeDeltaForKey({
        key: 'End',
        shiftKey: false,
        currentFirstSize: 400,
        pairSize: 900,
        firstMinimum: 300,
        secondMinimum: 300,
      }),
    ).toBe(200);
    expect(
      splitResizeDeltaForKey({
        key: 'Escape',
        shiftKey: false,
        currentFirstSize: 400,
        pairSize: 900,
        firstMinimum: 300,
        secondMinimum: 300,
      }),
    ).toBeNull();
  });

  it('exposes an accessible separator and writes keyboard changes as HomeLayout weights', () => {
    const onLayoutChange = vi.fn();
    const { container } = render(
      <ResizableSplitView
        node={node as Extract<typeof node, { type: 'split' }>}
        path={{ bandIndex: 1, nodePath: [] }}
        layout={layout}
        disabled={false}
        cardNames={['資產趨勢', '本月支出']}
        onLayoutChange={onLayoutChange}
        renderChild={(child) => <span>{child.type === 'card' ? child.cardId : child.axis}</span>}
      />,
    );
    const group = container.querySelector<HTMLElement>('[data-group]')!;
    Object.defineProperty(group, 'clientWidth', { configurable: true, value: 900 });
    const separator = screen.getByRole('separator', {
      name: '資產趨勢與本月支出分隔線',
    });

    expect(separator).toHaveAttribute('aria-valuenow', '66.67');
    expect(separator).toHaveAttribute('aria-valuetext', '資產趨勢 67%');
    fireEvent.keyDown(separator, { key: 'ArrowRight' });

    expect(onLayoutChange).toHaveBeenCalledWith(
      resizeSplit(layout, { bandIndex: 1, nodePath: [] }, 0, 16, 884, [352, 314]),
    );
  });
});
