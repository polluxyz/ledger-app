import { useLayoutEffect, useRef, type RefObject } from 'react';
import { isMotionEnabled } from '../../app/use-motion';
import type { FinancialTrendLayout } from './financial-trend-layout';

interface Frame {
  metric: string;
  baseline: number;
  ends: number[];
  width: number;
  height: number;
}

/** 每次保存實際柱高供連點接續；位置插值只用於繪圖，卸載與關閉動畫會取消。 */
export function useTrendAnimation(
  ref: RefObject<SVGSVGElement | null>,
  layout: FinancialTrendLayout | null,
  metric: string,
) {
  const currentFrame = useRef<Frame | null>(null);
  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg || !layout) {
      currentFrame.current = null;
      return;
    }
    const previous = currentFrame.current;
    const target: Frame = {
      metric,
      baseline: layout.baseline,
      ends: layout.bars.map((bar) => bar.end),
      width: layout.width,
      height: layout.height,
    };
    const bars = [...svg.querySelectorAll<SVGRectElement>('[data-trend-bar]')];
    const zero = svg.querySelector<SVGLineElement>('[data-trend-zero]');
    const markers = [...svg.querySelectorAll<SVGLineElement>('[data-zero-marker]')];
    let frameId = 0;
    let cancelled = false;
    function draw(frame: Frame) {
      currentFrame.current = frame;
      zero?.setAttribute('y1', String(frame.baseline));
      zero?.setAttribute('y2', String(frame.baseline));
      markers.forEach((marker) => {
        marker.setAttribute('y1', String(frame.baseline));
        marker.setAttribute('y2', String(frame.baseline));
      });
      bars.forEach((bar, index) => {
        const end = frame.ends[index] ?? frame.baseline;
        bar.setAttribute('y', String(Math.min(end, frame.baseline)));
        bar.setAttribute('height', String(Math.abs(end - frame.baseline)));
      });
    }
    function finish() {
      cancelled = true;
      cancelAnimationFrame(frameId);
      draw(target);
      svg?.removeAttribute('data-animating');
    }
    const shouldAnimate =
      previous &&
      previous.metric !== metric &&
      previous.width === target.width &&
      previous.height === target.height &&
      previous.ends.length === target.ends.length &&
      isMotionEnabled();
    if (!shouldAnimate) {
      draw(target);
      return;
    }
    const started = performance.now(),
      duration = 320;
    const ease = (value: number) => value * value * (3 - 2 * value);
    svg.setAttribute('data-animating', 'true');
    function animate(now: number) {
      if (cancelled || !previous) return;
      const elapsed = now - started,
        progress = Math.min(1, Math.max(0, elapsed / duration));
      draw({
        ...target,
        baseline: previous.baseline + (target.baseline - previous.baseline) * ease(progress),
        ends: target.ends.map((end, index) => {
          const start = previous.ends[index] ?? previous.baseline;
          const progress = Math.min(1, Math.max(0, (elapsed - index * 5) / duration));
          return start + (end - start) * ease(progress);
        }),
      });
      if (elapsed < duration + 55) frameId = requestAnimationFrame(animate);
      else finish();
    }
    animate(started);
    const observer = new MutationObserver(() => {
      if (!isMotionEnabled()) finish();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion'],
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      observer.disconnect();
      svg.removeAttribute('data-animating');
    };
  }, [layout, metric, ref]);
}
