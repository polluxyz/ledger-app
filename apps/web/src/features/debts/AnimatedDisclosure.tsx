import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './AnimatedDisclosure.module.css';

interface AnimatedDisclosureProps {
  open: boolean;
  id: string;
  children: ReactNode;
  className?: string;
}

/** 用版內 motion token 收合內容，並在轉場結束前保留子元件與它的狀態。 */
export function AnimatedDisclosure({ open, id, children, className }: AnimatedDisclosureProps) {
  const [mounted, setMounted] = useState(open);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    if (open) {
      if (!mounted) {
        queueMicrotask(() => {
          if (!cancelled) {
            setMounted(true);
          }
        });
      }
      return () => {
        cancelled = true;
      };
    }
    if (!mounted) {
      return;
    }

    const container = containerRef.current;
    const transitionTime = container ? getTransitionTime(container) : 0;
    if (transitionTime === 0) {
      queueMicrotask(() => {
        if (!cancelled) {
          setMounted(false);
        }
      });
      return () => {
        cancelled = true;
      };
    }

    // transitionend 在 token 為 0 時不會觸發；依計算後的最長時長卸載，並留一小段繪製緩衝。
    const timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        setMounted(false);
      }
    }, transitionTime + 32);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [mounted, open]);

  return (
    <div
      ref={containerRef}
      id={id}
      className={[styles.disclosure, open ? styles.open : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      aria-hidden={!open}
    >
      {(open || mounted) && <div className={styles.content}>{children}</div>}
    </div>
  );
}

function getTransitionTime(element: HTMLElement): number {
  const style = window.getComputedStyle(element);
  const durations = parseTimeList(style.transitionDuration);
  const delays = parseTimeList(style.transitionDelay);
  const transitionCount = Math.max(durations.length, delays.length);

  return Math.max(
    0,
    ...Array.from({ length: transitionCount }, (_, index) => {
      const duration = durations[index % durations.length] ?? 0;
      const delay = delays[index % delays.length] ?? 0;
      return duration + delay;
    }),
  );
}

function parseTimeList(value: string): number[] {
  return value.split(',').map((part) => {
    const time = part.trim();
    const amount = Number.parseFloat(time);
    if (!Number.isFinite(amount)) {
      return 0;
    }
    return time.endsWith('ms') ? amount : time.endsWith('s') ? amount * 1000 : 0;
  });
}
