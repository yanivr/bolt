/**
 * Pure math helpers shared by the server simulation, client prediction, tools and tests.
 * Nothing in this file may touch the DOM, Phaser, timers or any source of nondeterminism.
 */

export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Wraps an angle to the half-open range (-PI, PI]. */
export function wrapAngle(rad: number): number {
  let a = rad % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/** Shortest signed rotation that takes `from` to `to`. */
export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * t;
}

/**
 * Frame-rate independent exponential approach. Returns the blend factor for a first-order
 * filter with the given time constant; a time constant of zero snaps immediately.
 */
export function expBlend(dt: number, timeConstant: number): number {
  if (timeConstant <= 0) return 1;
  return 1 - Math.exp(-dt / timeConstant);
}

/** Moves `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/**
 * World headings: 0 points up the screen (negative Y) and grows clockwise, so a positive yaw
 * rate is a right turn. These two helpers are the only place that convention is encoded.
 */
export function headingForwardX(heading: number): number {
  return Math.sin(heading);
}
export function headingForwardY(heading: number): number {
  return -Math.cos(heading);
}
export function headingFromVector(dx: number, dy: number): number {
  return Math.atan2(dx, -dy);
}

/** Small, fast, well-distributed 32-bit PRNG. Seeded and fully deterministic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit string hash (FNV-1a). Used for seeds and cosmetic variation only. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Integer lattice hash to [0, 1). Deterministic across engines. */
export function hash2(x: number, y: number, seed = 0): number {
  let h =
    (Math.imul(x | 0, 0x27d4eb2d) ^
      Math.imul(y | 0, 0x165667b1) ^
      Math.imul(seed | 0, 0x9e3779b1)) >>>
    0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Centripetal-free uniform Catmull-Rom position for one segment. */
export function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/** Closest point on segment AB to P. Returns the parametric position along AB in [0, 1]. */
export function projectOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 <= 1e-12) return 0;
  return clamp(((px - ax) * abx + (py - ay) * aby) / len2, 0, 1);
}

/**
 * Proper segment intersection test. Returns the parametric position along P1P2 in [0, 1] when
 * the two segments cross, or -1 when they do not.
 */
export function segmentIntersection(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  q1x: number,
  q1y: number,
  q2x: number,
  q2y: number,
): number {
  const rx = p2x - p1x;
  const ry = p2y - p1y;
  const sx = q2x - q1x;
  const sy = q2y - q1y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return -1;
  const qpx = q1x - p1x;
  const qpy = q1y - p1y;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return -1;
  return t;
}
