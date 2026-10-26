import { useRef, type PointerEvent, type KeyboardEvent } from 'react';
import type { HomeLayoutV1 } from '@ledger/shared';
import { resizeBand } from './layout-ops';
import { bandResizeDeltaForKey } from './home-layout-resize-keys';
import styles from './HomeLayoutRenderer.module.css';

/** 根列高度把手使用 Pointer Events，讓每列（含最後一列）都能獨立增加額外高度。 */

interface PointerResizeState {
  pointerId: number;
  startY: number;
  startLayout: HomeLayoutV1;
}

export function HomeBandResizeHandle({
  layout,
  bandIndex,
  disabled,
  measuredHeightPx,
  onLayoutChange,
}: {
  layout: HomeLayoutV1;
  bandIndex: number;
  disabled: boolean;
  measuredHeightPx: number;
  onLayoutChange: (layout: HomeLayoutV1) => void;
}) {
  const pointerState = useRef<PointerResizeState | null>(null);
  const band = layout.bands[bandIndex];
  if (!band) return null;
  const extraHeightPx = band.extraHeightPx;
  const baseHeight = Math.max(0, Math.round(measuredHeightPx - extraHeightPx));
  const currentHeight = Math.max(baseHeight, Math.round(measuredHeightPx));

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    pointerState.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startLayout: layout,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = pointerState.current;
    if (!current || current.pointerId !== event.pointerId || disabled) return;
    onLayoutChange(resizeBand(current.startLayout, bandIndex, event.clientY - current.startY));
  }

  function finishPointer(event: PointerEvent<HTMLButtonElement>) {
    if (pointerState.current?.pointerId !== event.pointerId) return;
    pointerState.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    const delta = bandResizeDeltaForKey({
      key: event.key,
      shiftKey: event.shiftKey,
      extraHeightPx,
    });
    if (delta === null) return;
    event.preventDefault();
    onLayoutChange(resizeBand(layout, bandIndex, delta));
  }

  return (
    <button
      aria-label={`第 ${bandIndex + 1} 列高度`}
      aria-orientation="horizontal"
      aria-valuemax={baseHeight + 1600}
      aria-valuemin={baseHeight}
      aria-valuenow={currentHeight}
      aria-valuetext={`${currentHeight} 像素`}
      className={styles.bandResizeHandle}
      disabled={disabled}
      onKeyDown={handleKeyDown}
      onPointerCancel={finishPointer}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      role="separator"
      tabIndex={disabled ? -1 : 0}
      type="button"
    >
      <span aria-hidden="true" />
    </button>
  );
}
