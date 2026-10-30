import { describe, expect, it } from 'vitest';
import {
  particlePath,
  planTransition,
  sampleTransition,
  staticFrame,
  type GlyphFrame,
  type VoiceGlyphTarget,
} from './voice-glyph-geometry';

// 期望幾何直接取自規格與原圖，不由受測函式產生。
const IDS = ['left', 'top', 'right', 'bottom', 'center'];
const EXPECTED_SLOTS = [16, 20, 8, 4, 12];
const EXPECTED_HEIGHTS = [12, 6, 12, 6, 18];
const EXPECTED_HOME_POINTS = [
  [
    [5.5, 11.5],
    [5.5, 11.5],
    [12, 18],
    [12, 18],
    [12, 18],
  ],
  [
    [12, 18],
    [12, 18],
    [18.5, 11.5],
    [18.5, 11.5],
    [18.5, 11.5],
  ],
  [
    [12, 18],
    [12, 21],
    [12, 21],
    [12, 21],
    [12, 21],
  ],
  [
    [8, 21],
    [16, 21],
    [16, 21],
    [16, 21],
    [16, 21],
  ],
  [
    [15, 6],
    [15, 12],
    [9, 12],
    [9, 6],
    [15, 6],
  ],
];
const EXPECTED_RADII = [
  [6.5, 0],
  [6.5, 0],
  [0, 0],
  [0, 0],
  [3, 3],
];

function waitingAt(phase: number, velocity: number): GlyphFrame {
  const angles = [Math.PI, -Math.PI / 2, 0, Math.PI / 2, 0];
  return {
    target: 'waiting',
    phase: 'orbit',
    phaseMs: 0,
    particles: IDS.map((id, index) => {
      const angle = angles[index]! + phase;
      return {
        id: id as GlyphFrame['particles'][number]['id'],
        x: index === 4 ? 12 : 12 + 8 * Math.cos(angle),
        y: index === 4 ? 12 : 12 + 8 * Math.sin(angle),
        angle,
        radius: index === 4 ? 0 : 8,
        velocity: index === 4 ? 0 : velocity,
        shape: {
          points: [
            [0, 0],
            [0, 0.000001],
            [0, 0.000001],
            [0, 0.000001],
            [0, 0.000001],
          ],
          radii: [0, 0],
        },
      };
    }),
  };
}

function expectRecording(frame: GlyphFrame) {
  expect(frame.phase).toBe('wave');
  expect(frame.particles.map((particle) => particle.id)).toEqual(IDS);
  frame.particles.forEach((particle, index) => {
    expect(particle.x).toBe(EXPECTED_SLOTS[index]);
    expect(particle.y).toBe(12);
    expect(particle.shape.radii).toEqual([0, 0]);
    expect(particle.shape.points.every(([x]) => x === 0)).toBe(true);
    expect(particle.shape.points[1][1] - particle.shape.points[0][1] + 1.8).toBeCloseTo(
      EXPECTED_HEIGHTS[index]!,
      6,
    );
  });
}

/** SC-SR18 (4)：獨立幾何常數、跨圈取樣與中斷快照驗證純函式，不接觸語音或 React。 */
describe('voice glyph geometry', () => {
  it('閒置的兩段 U 弧、支桿、底座與膠囊保留原圖的精確圓弧', () => {
    const frame = staticFrame('idle');
    frame.particles.forEach((particle, index) => {
      expect(particle.shape.radii).toEqual(EXPECTED_RADII[index]);
      particle.shape.points.forEach(([x, y], pointIndex) => {
        expect(x + particle.x).toBeCloseTo(EXPECTED_HOME_POINTS[index]![pointIndex]![0]!, 8);
        expect(y + particle.y).toBeCloseTo(EXPECTED_HOME_POINTS[index]![pointIndex]![1]!, 8);
      });
    });
    expect(particlePath(frame.particles[4]!)).toBe('M15,6L15,12A3,3 0 0 1 9,12L9,6A3,3 0 0 1 15,6');
  });

  it.each([0, 0.4, 5.9, 6.5, 21.2])('相位 %s 的固定身分落在第 4、5、2、1、3 根', (phase) => {
    const plan = planTransition(waitingAt(phase, 0.005), 'recording');
    expectRecording(sampleTransition(plan, 700));
  });

  it.each([0, 6.1, 13.7])(
    '相位 %s 在不同速度與中斷點都只順時針，座標與未取餘數角度相符',
    (phase) => {
      for (const velocity of [0, 0.005, 0.025]) {
        const initial = waitingAt(phase, velocity);
        const orbit = planTransition(initial, 'waiting');
        let previous = initial;
        for (let time = 0; time <= 1500; time += 10) {
          const frame = sampleTransition(orbit, time);
          expectPolar(frame, previous);
          previous = frame;
        }
        const landing = planTransition(initial, 'recording');
        for (const interruption of [140, 350, 560]) {
          const snapshot = sampleTransition(landing, interruption);
          const returning = planTransition(snapshot, 'waiting');
          expect(sampleTransition(returning, 0)).toEqual(snapshot);
          for (const plan of [landing, returning]) {
            let before = plan.from;
            for (let time = 0; time <= 900; time += 5) {
              const frame = sampleTransition(plan, time);
              expectPolar(frame, before);
              before = frame;
            }
          }
        }
      }
    },
  );

  function expectPolar(frame: GlyphFrame, previous: GlyphFrame) {
    const center = frame.particles[4]!;
    frame.particles.slice(0, 4).forEach((particle, index) => {
      expect(particle.angle + 1e-10).toBeGreaterThanOrEqual(previous.particles[index]!.angle);
      expect(particle.velocity).toBeGreaterThanOrEqual(-1e-10);
      expect(particle.x).toBeCloseTo(12 + particle.radius * Math.cos(particle.angle), 7);
      expect(particle.y).toBeCloseTo(12 + particle.radius * Math.sin(particle.angle), 7);
      // 旋轉時外圈已縮成點，半徑下限 4 大於兩點合計的 1.8 線寬。
      expect(Math.hypot(particle.x - 12, particle.y - 12)).toBeGreaterThanOrEqual(4 - 1e-8);
      // 這幾段的筆畫只有點或直立線。計入兩段實際線段與圓端，不能只量粒子中心。
      const top = particle.y + particle.shape.points[0][1];
      const bottom = particle.y + particle.shape.points[1][1];
      const centerTop = center.y + center.shape.points[0][1];
      const centerBottom = center.y + center.shape.points[1][1];
      const gap = Math.max(0, top - centerBottom, centerTop - bottom);
      expect(Math.hypot(particle.x - center.x, gap) - 1.8).toBeGreaterThan(0);
    });
  }

  it('拆解到外圈的接點沒有跳位，接續繞圈的角度與座標一致', () => {
    const plan = planTransition(staticFrame('idle'), 'waiting');
    const before = sampleTransition(plan, 499.99);
    const after = sampleTransition(plan, 500);
    expectPolar(after, before);
    after.particles.forEach((particle, index) => {
      const previous = before.particles[index]!;
      expect(Math.hypot(particle.x - previous.x, particle.y - previous.y)).toBeLessThan(0.001);
    });
  });

  it.each([60, 120, 'jump'] as const)('%s 推進都在時間上限到位，沒有逐幀累積誤差', (frequency) => {
    const cases: readonly [VoiceGlyphTarget, VoiceGlyphTarget, number, GlyphFrame['phase']][] = [
      ['idle', 'waiting', 500, 'orbit'],
      ['waiting', 'recording', 700, 'wave'],
      ['recording', 'waiting', 700, 'orbit'],
      ['recording', 'idle', 900, 'idle'],
      ['waiting', 'idle', 600, 'idle'],
    ];
    for (const [from, target, limit, phase] of cases) {
      const plan = planTransition(staticFrame(from), target);
      expect(plan.durationMs).toBeLessThanOrEqual(limit);
      const step = frequency === 'jump' ? limit + 3000 : 1000 / frequency;
      let time = 0;
      while (time + step < limit) {
        time += step;
        sampleTransition(plan, time);
      }
      const final = sampleTransition(plan, time + step);
      expect(final.phase).toBe(phase);
      expect(final.target).toBe(target);
      if (target === 'idle') expect(final).toEqual(staticFrame('idle'));
      if (target === 'waiting')
        final.particles.slice(0, 4).forEach((particle) => expect(particle.radius).toBe(8));
      if (target === 'recording')
        expect(final.particles.map((particle) => particle.x)).toEqual(EXPECTED_SLOTS);
    }
  });

  it.each([0.2, 0.5, 0.8])(
    '在 %s 中斷時保留所有筆畫，能跳過等待直接 final 或從合併重啟',
    (fraction) => {
      const unfold = planTransition(staticFrame('idle'), 'waiting');
      const landing = planTransition(waitingAt(7.1, 0.01), 'recording');
      const merge = planTransition(staticFrame('recording'), 'idle');
      for (const [plan, target] of [
        [unfold, 'recording'],
        [unfold, 'idle'],
        [landing, 'idle'],
        [merge, 'waiting'],
      ] as const) {
        const snapshot = sampleTransition(plan, plan.durationMs * fraction);
        const copy = structuredClone(snapshot);
        const next = planTransition(snapshot, target);
        expect(sampleTransition(next, 0)).toEqual(snapshot);
        expect(sampleTransition(next, 16)).not.toEqual(snapshot);
        sampleTransition(next, 5000);
        expect(snapshot).toEqual(copy);
      }
    },
  );

  it('辨識等待不會自行合回麥克風，跨多圈仍保留未取餘數角度', () => {
    const plan = planTransition(staticFrame('recording'), 'waiting');
    const frame = sampleTransition(plan, 30000);
    expect(frame.phase).toBe('orbit');
    frame.particles.slice(0, 4).forEach((particle) => {
      expect(particle.angle).toBeGreaterThan(100);
      expect(particle.shape.radii).toEqual([0, 0]);
      expect(particle.shape.points[1][1]).toBe(0.000001);
    });
  });
});
