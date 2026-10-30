import { useLayoutEffect, useRef } from 'react';
import { isMotionEnabled } from '../../app/use-motion';
import {
  particlePath,
  planTransition,
  sampleTransition,
  staticFrame,
  type VoiceGlyphTarget,
} from './voice-glyph-geometry';
import styles from './AiEntry.module.css';

const INITIAL_FRAME = staticFrame('idle');

/** 動畫不參與語音狀態；每個世代最多一個 rAF，只更新五筆 path，不重繪 React。 */
export function VoiceGlyph({ target, active }: { target: VoiceGlyphTarget; active: boolean }) {
  const pathsRef = useRef<(SVGPathElement | null)[]>([]);
  const currentRef = useRef(INITIAL_FRAME);
  const frameIdRef = useRef<number | null>(null);
  const generationRef = useRef(0);

  useLayoutEffect(() => {
    function cancel() {
      generationRef.current += 1;
      if (frameIdRef.current !== null) cancelAnimationFrame(frameIdRef.current);
      frameIdRef.current = null;
    }
    function draw(frame: typeof currentRef.current) {
      currentRef.current = frame;
      frame.particles.forEach((particle, index) => {
        pathsRef.current[index]?.setAttribute('d', particlePath(particle));
      });
    }
    function start() {
      cancel();
      if (!isMotionEnabled()) {
        draw(staticFrame(target));
        return;
      }
      const generation = generationRef.current;
      const plan = planTransition(currentRef.current, target);
      const started = performance.now();
      // 新轉場第 0 幀就是目前實際畫面，事件的語意狀態由父元件在同次 commit 更新。
      draw(sampleTransition(plan, 0));
      function tick(now: number) {
        if (generation !== generationRef.current) return;
        frameIdRef.current = null;
        // MutationObserver 尚未送達的間隙，也不可多畫一幀或再排幀。
        if (!isMotionEnabled()) {
          cancel();
          draw(staticFrame(target));
          return;
        }
        const elapsed = Math.max(0, now - started);
        draw(sampleTransition(plan, elapsed));
        if (target !== 'idle' || elapsed < plan.durationMs) {
          frameIdRef.current = requestAnimationFrame(tick);
        }
      }
      if (target !== 'idle' || plan.durationMs > 0) {
        frameIdRef.current = requestAnimationFrame(tick);
      }
    }
    start();
    const observer = new MutationObserver(start);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion'],
    });
    return () => {
      cancel();
      observer.disconnect();
    };
  }, [target]);

  return (
    <span className={styles.voiceGlyph} aria-hidden="true">
      <svg
        className={styles.microphoneIcon}
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        pointerEvents="none"
      >
        {INITIAL_FRAME.particles.map((particle, index) => (
          <path
            key={particle.id}
            data-particle={particle.id}
            ref={(element) => {
              pathsRef.current[index] = element;
            }}
            d={particlePath(particle)}
          />
        ))}
      </svg>
      {active && (
        <svg
          className={styles.cancelMark}
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          aria-hidden="true"
          focusable="false"
          pointerEvents="none"
        >
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      )}
    </span>
  );
}
