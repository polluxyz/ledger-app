/** 五筆固定身分的 SVG 幾何；規劃只讀完整畫面，取樣只依經過時間，不依更新頻率。 */
export type VoiceGlyphTarget = 'idle' | 'waiting' | 'recording';
export type ParticleId = 'left' | 'top' | 'right' | 'bottom' | 'center';
type Point = readonly [number, number];
type Points = readonly [Point, Point, Point, Point, Point];

export interface StrokeShape {
  readonly points: Points;
  readonly radii: readonly [number, number];
}

export interface GlyphParticle {
  readonly id: ParticleId;
  readonly x: number;
  readonly y: number;
  /** 螢幕座標的正角度為順時針；保留整圈數。 */
  readonly angle: number;
  readonly radius: number;
  readonly velocity: number;
  readonly shape: StrokeShape;
}

export interface GlyphFrame {
  readonly particles: readonly GlyphParticle[];
  readonly target: VoiceGlyphTarget;
  readonly phase: 'idle' | 'unfold' | 'orbit' | 'landing' | 'wave' | 'return' | 'merge';
  readonly phaseMs: number;
}

interface Segment {
  readonly from: GlyphFrame;
  readonly to: GlyphFrame;
  readonly durationMs: number;
  readonly polar: boolean;
}

export interface GlyphTransition {
  readonly from: GlyphFrame;
  readonly target: VoiceGlyphTarget;
  readonly segments: readonly Segment[];
  readonly durationMs: number;
}

const TAU = 2 * Math.PI;
const ORBIT_SPEED = TAU / 1200;
const IDS: readonly ParticleId[] = ['left', 'top', 'right', 'bottom', 'center'];
const BASES = [Math.PI, -Math.PI / 2, 0, Math.PI / 2, 0];
const SLOTS = [16, 20, 8, 4, 12];
const HEIGHTS = [12, 6, 12, 6, 18];
const HOMES: readonly Point[] = [
  [7.86, 15.64],
  [16.14, 15.64],
  [12, 19.5],
  [12, 21],
  [12, 9],
];
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => value * value * (3 - 2 * value);
const mix = (a: number, b: number, progress: number) => a + (b - a) * progress;

function shape(points: Points, firstRadius = 0, secondRadius = 0): StrokeShape {
  return { points, radii: [firstRadius, secondRadius] };
}

const DOT = shape([
  [0, 0],
  [0, 0.000001],
  [0, 0.000001],
  [0, 0.000001],
  [0, 0.000001],
]);

function line(height: number): StrokeShape {
  const half = Math.max(0.000001, height - 1.8) / 2;
  return shape([
    [0, -half],
    [0, half],
    [0, half],
    [0, half],
    [0, half],
  ]);
}

function microphoneShape(index: number): StrokeShape {
  const [x, y] = HOMES[index]!;
  const local = (px: number, py: number): Point => [px - x, py - y];
  if (index === 0) {
    return shape(
      [local(5.5, 11.5), local(5.5, 11.5), local(12, 18), local(12, 18), local(12, 18)],
      6.5,
    );
  }
  if (index === 1) {
    return shape(
      [local(12, 18), local(12, 18), local(18.5, 11.5), local(18.5, 11.5), local(18.5, 11.5)],
      6.5,
    );
  }
  if (index === 2) {
    return shape([local(12, 18), local(12, 21), local(12, 21), local(12, 21), local(12, 21)]);
  }
  if (index === 3) {
    return shape([local(8, 21), local(16, 21), local(16, 21), local(16, 21), local(16, 21)]);
  }
  return shape(
    [
      [3, -3],
      [3, 3],
      [-3, 3],
      [-3, -3],
      [3, -3],
    ],
    3,
    3,
  );
}

/** 靜態姿態也是完整 frame；重新啟用動畫時從它直接繞圈，不重播入場。 */
export function staticFrame(target: VoiceGlyphTarget): GlyphFrame {
  return {
    target,
    phase: target === 'idle' ? 'idle' : target === 'waiting' ? 'orbit' : 'wave',
    phaseMs: 0,
    particles: IDS.map((id, index) => {
      const x =
        target === 'idle'
          ? HOMES[index]![0]
          : target === 'recording'
            ? SLOTS[index]!
            : index === 4
              ? 12
              : 12 + 8 * Math.cos(BASES[index]!);
      const y =
        target === 'idle'
          ? HOMES[index]![1]
          : target === 'recording' || index === 4
            ? 12
            : 12 + 8 * Math.sin(BASES[index]!);
      const actual = Math.atan2(y - 12, x - 12);
      return {
        id,
        x,
        y,
        angle: actual,
        radius: Math.hypot(x - 12, y - 12),
        velocity: target === 'waiting' && index < 4 ? ORBIT_SPEED : 0,
        shape:
          target === 'idle'
            ? microphoneShape(index)
            : target === 'waiting'
              ? DOT
              : line(HEIGHTS[index]!),
      };
    }),
  };
}

function morphShape(from: StrokeShape, to: StrokeShape, progress: number): StrokeShape {
  const point = (index: 0 | 1 | 2 | 3 | 4): Point => [
    mix(from.points[index][0], to.points[index][0], progress),
    mix(from.points[index][1], to.points[index][1], progress),
  ];
  return {
    points: [point(0), point(1), point(2), point(3), point(4)],
    radii: [mix(from.radii[0], to.radii[0], progress), mix(from.radii[1], to.radii[1], progress)],
  };
}

/** 選下一個正向落點；控制點保持有序，Hermite 導數就不會變成負數。 */
function forward(angle: number, target: number, minimum: number): number {
  return target + Math.max(0, Math.ceil((angle + minimum - target) / TAU)) * TAU;
}

function polarEndpoint(from: GlyphFrame, to: GlyphFrame, durationMs: number): GlyphFrame {
  return {
    ...to,
    particles: to.particles.map((particle, index) => {
      if (index === 4) return particle;
      const source = from.particles[index]!;
      const minimum = Math.max(
        0.5,
        ((source.velocity + particle.velocity) * durationMs) / 3 + 0.01,
      );
      return { ...particle, angle: forward(source.angle, particle.angle, minimum) };
    }),
  };
}

/** 不排動畫也不修改輸入。每一段都保存完整筆畫，途中重規劃時第 0 幀完全相同。 */
export function planTransition(from: GlyphFrame, target: VoiceGlyphTarget): GlyphTransition {
  const segments: Segment[] = [];
  let current = from;
  function add(to: GlyphFrame, durationMs: number, polar = false) {
    const end = polar ? polarEndpoint(current, to, durationMs) : to;
    segments.push({ from: current, to: end, durationMs, polar });
    current = end;
  }
  function shrink(durationMs: number, phase: GlyphFrame['phase']) {
    add(
      {
        ...current,
        target,
        phase,
        phaseMs: 0,
        particles: current.particles.map((particle) => ({ ...particle, velocity: 0, shape: DOT })),
      },
      durationMs,
    );
  }
  const settled = from.phase === 'idle' || from.phase === 'orbit' || from.phase === 'wave';
  if (from.target === target && settled) return { from, target, segments, durationMs: 0 };
  const hasMicrophone = from.phase === 'idle' || from.phase === 'unfold' || from.phase === 'merge';
  const isDots = from.particles.every(
    (particle) =>
      particle.shape.radii.every((radius) => radius === 0) &&
      particle.shape.points.every(([x, y]) => Math.hypot(x, y) < 0.001),
  );

  if (target === 'recording') {
    // 先把整筆收成點才旋轉，避免長筆畫在內圈掃過中心點。
    if (!isDots) shrink(110, 'landing');
    const endpoint = staticFrame('recording');
    add(
      {
        ...endpoint,
        phase: 'landing',
        particles: endpoint.particles.map((particle) => ({ ...particle, shape: DOT })),
      },
      isDots ? 580 : 470,
      true,
    );
    add(
      {
        ...endpoint,
        particles: endpoint.particles.map((particle, index) => ({
          ...particle,
          angle: current.particles[index]!.angle,
        })),
      },
      120,
    );
  } else if (target === 'waiting') {
    if (hasMicrophone || !isDots) shrink(110, hasMicrophone ? 'unfold' : 'return');
    const endpoint = staticFrame('waiting');
    if (hasMicrophone) {
      // 拆解筆畫的平移不走極座標；先縮小，再移到固定身分的外圈起點。
      add(
        {
          ...endpoint,
          phase: 'unfold',
          particles: endpoint.particles.map((particle) => ({ ...particle, velocity: 0 })),
        },
        160,
      );
      add(
        {
          ...endpoint,
          particles: endpoint.particles.map((particle, index) => {
            if (index === 4) return particle;
            const angle = current.particles[index]!.angle + (ORBIT_SPEED * 230) / 2;
            return { ...particle, angle, x: 12 + 8 * Math.cos(angle), y: 12 + 8 * Math.sin(angle) };
          }),
        },
        230,
        true,
      );
    } else {
      add(endpoint, isDots ? 700 : 590, true);
    }
  } else if (hasMicrophone) {
    add(staticFrame('idle'), 600);
  } else {
    const wasRecording = from.target === 'recording';
    if (!isDots) shrink(110, 'return');
    const orbit = staticFrame('waiting');
    add(
      {
        ...orbit,
        target: 'idle',
        phase: 'return',
        particles: orbit.particles.map((particle) => ({ ...particle, velocity: 0 })),
      },
      (wasRecording ? 400 : 230) + (isDots ? 110 : 0),
      true,
    );
    add(staticFrame('idle'), wasRecording ? 390 : 260);
  }
  return {
    from,
    target,
    segments,
    durationMs: segments.reduce((sum, segment) => sum + segment.durationMs, 0),
  };
}

function sampleSegment(segment: Segment, elapsedMs: number): GlyphFrame {
  const t = clamp(elapsedMs / segment.durationMs);
  if (t === 0) return segment.from;
  if (t === 1) return segment.to;
  const q = ease(t);
  return {
    ...segment.to,
    // 只有最後一幀才是穩定姿態，中斷時仍依正在變形的完整筆畫規劃。
    phase:
      segment.to.phase === 'orbit'
        ? 'return'
        : segment.to.phase === 'wave'
          ? 'landing'
          : segment.to.phase === 'idle'
            ? 'merge'
            : segment.to.phase,
    particles: segment.from.particles.map((particle, index) => {
      const end = segment.to.particles[index]!;
      let x = mix(particle.x, end.x, q);
      let y = mix(particle.y, end.y, q);
      let angle = particle.angle;
      let velocity = 0;
      let radius = Math.hypot(x - 12, y - 12);
      if (segment.polar && index < 4) {
        const t2 = t * t;
        const t3 = t2 * t;
        const duration = segment.durationMs;
        angle =
          (2 * t3 - 3 * t2 + 1) * particle.angle +
          (t3 - 2 * t2 + t) * particle.velocity * duration +
          (-2 * t3 + 3 * t2) * end.angle +
          (t3 - t2) * end.velocity * duration;
        velocity =
          ((6 * t2 - 6 * t) * particle.angle +
            (3 * t2 - 4 * t + 1) * particle.velocity * duration +
            (-6 * t2 + 6 * t) * end.angle +
            (3 * t2 - 2 * t) * end.velocity * duration) /
          duration;
        radius = mix(particle.radius, end.radius, q);
        x = 12 + radius * Math.cos(angle);
        y = 12 + radius * Math.sin(angle);
      } else if (radius > 0) {
        const actual = Math.atan2(y - 12, x - 12);
        angle += Math.atan2(Math.sin(actual - angle), Math.cos(actual - angle));
      }
      return {
        ...particle,
        x,
        y,
        angle,
        radius,
        velocity,
        shape: morphShape(particle.shape, end.shape, q),
      };
    }),
  };
}

function sampleLoop(frame: GlyphFrame, target: VoiceGlyphTarget, elapsedMs: number): GlyphFrame {
  if (target === 'idle' || elapsedMs === 0) return frame;
  const phaseMs = frame.phaseMs + elapsedMs;
  return {
    ...frame,
    phaseMs,
    particles: frame.particles.map((particle, index) => {
      if (target === 'waiting' && index < 4) {
        const angle = particle.angle + ORBIT_SPEED * elapsedMs;
        return {
          ...particle,
          angle,
          velocity: ORBIT_SPEED,
          x: 12 + 8 * Math.cos(angle),
          y: 12 + 8 * Math.sin(angle),
        };
      }
      if (target === 'recording') {
        const pulse =
          1 -
          0.15 *
            (1 - Math.cos(phaseMs / 180)) *
            (0.65 + 0.35 * Math.cos(index * 0.7 + phaseMs / 360));
        return { ...particle, shape: line(HEIGHTS[index]! * pulse) };
      }
      return particle;
    }),
  };
}

export function sampleTransition(plan: GlyphTransition, elapsedMs: number): GlyphFrame {
  if (elapsedMs <= 0) return plan.from;
  let remaining = elapsedMs;
  let current = plan.from;
  for (const segment of plan.segments) {
    if (remaining < segment.durationMs) return sampleSegment(segment, remaining);
    remaining -= segment.durationMs;
    current = segment.to;
  }
  return sampleLoop(current, plan.target, remaining);
}

/** 固定的 SVG 命令拓樸可保留圓弧與膠囊，且任意中斷都能逐座標連續變形。 */
export function particlePath(particle: GlyphParticle): string {
  const point = (index: number) =>
    particle.shape.points[index]!.map((value, axis) =>
      Number((value + (axis === 0 ? particle.x : particle.y)).toFixed(6)),
    ).join(',');
  const radius = (index: number) => Number(particle.shape.radii[index]!.toFixed(6));
  const sweep = particle.id === 'center' ? 1 : 0;
  return `M${point(0)}L${point(1)}A${radius(0)},${radius(0)} 0 0 ${sweep} ${point(2)}L${point(3)}A${radius(1)},${radius(1)} 0 0 ${sweep} ${point(4)}`;
}
