import { clamp } from './math.js';
import type { TrackBranch } from './track.js';
import type { TrackPoint, TrackShape } from './types.js';

/**
 * Geometry of authored track areas: point-in-shape tests, bands that follow a branch, and the
 * polygons the layout view and the art draw them with. Build-time code: the 30 Hz loop never
 * calls anything here; it reads the grids the track builder bakes from these shapes.
 */

export function pointInPolygon(points: readonly TrackPoint[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from a point to segment AB. */
export function segmentDistance(
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
  const t = len2 > 1e-12 ? clamp(((px - ax) * abx + (py - ay) * aby) / len2, 0, 1) : 0;
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/** Arc length on a branch of the centerline point nearest a world point. */
export function nearestOnBranch(branch: TrackBranch, px: number, py: number): number {
  let best = Infinity;
  let bestS = 0;
  const links = branch.closed ? branch.count : branch.count - 1;
  for (let i = 0; i < links; i++) {
    const j = (i + 1) % branch.count;
    const ax = branch.x[i]!;
    const ay = branch.y[i]!;
    const abx = branch.x[j]! - ax;
    const aby = branch.y[j]! - ay;
    const len2 = abx * abx + aby * aby;
    const t = len2 > 1e-12 ? clamp(((px - ax) * abx + (py - ay) * aby) / len2, 0, 1) : 0;
    const d = Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
    if (d < best) {
      best = d;
      bestS = branch.s[i]! + Math.sqrt(len2) * t;
    }
  }
  return bestS;
}

/** A band resolved onto its branch: arc lengths and offsets. `s1` may be below `s0` on a loop. */
export type ResolvedBand = {
  branch: TrackBranch;
  s0: number;
  s1: number;
  l0: number;
  l1: number;
};

export function resolveBand(
  shape: Extract<TrackShape, { type: 'band' }>,
  branches: readonly TrackBranch[],
): ResolvedBand {
  const branch = branches.find((b) => b.id === shape.branch);
  if (!branch) throw new Error(`band on unknown branch ${shape.branch}`);
  const s0 = nearestOnBranch(branch, shape.from.x, shape.from.y);
  const s1 = nearestOnBranch(branch, shape.to.x, shape.to.y);
  const l0 = Math.min(shape.lateral[0], shape.lateral[1]);
  const l1 = Math.max(shape.lateral[0], shape.lateral[1]);
  return { branch, s0, s1, l0, l1 };
}

/** Length of a band along its branch, following travel (wrapping on a loop). */
export function bandSpan(band: ResolvedBand): number {
  const { branch, s0, s1 } = band;
  if (s1 >= s0) return s1 - s0;
  return branch.closed ? branch.length - s0 + s1 : 0;
}

/** Sample indices a band covers, in order of travel. */
function bandSamples(band: ResolvedBand): number[] {
  const { branch } = band;
  const out: number[] = [];
  const step = branch.length / (branch.closed ? branch.count : branch.count - 1);
  const first = Math.floor(band.s0 / step);
  const n = Math.ceil(bandSpan(band) / step) + 1;
  for (let k = 0; k <= n; k++) {
    let i = first + k;
    if (branch.closed) i = ((i % branch.count) + branch.count) % branch.count;
    else if (i >= branch.count) break;
    out.push(i);
  }
  return out;
}

/**
 * Whether a world point lies in a band: its nearest centerline point among the samples the
 * band covers is inside the band's arc length range, and its signed offset is inside the band.
 */
export function pointInBand(band: ResolvedBand, samples: readonly number[], x: number, y: number) {
  const { branch } = band;
  let best = Infinity;
  let bestS = 0;
  let bestLat = 0;
  for (let k = 0; k + 1 < samples.length; k++) {
    const i = samples[k]!;
    const j = samples[k + 1]!;
    const ax = branch.x[i]!;
    const ay = branch.y[i]!;
    const abx = branch.x[j]! - ax;
    const aby = branch.y[j]! - ay;
    const len2 = abx * abx + aby * aby;
    const t = len2 > 1e-12 ? clamp(((x - ax) * abx + (y - ay) * aby) / len2, 0, 1) : 0;
    const dx = x - (ax + abx * t);
    const dy = y - (ay + aby * t);
    const d = Math.hypot(dx, dy);
    if (d < best) {
      best = d;
      const len = Math.sqrt(len2) || 1;
      // Arc length from the band's start, and the signed offset to the right of travel.
      bestS = k + t;
      bestLat = (dx * -aby + dy * abx) / len;
    }
  }
  if (best === Infinity) return false;
  // The ends are cut square at the band's own arc lengths.
  const step = branch.length / (branch.closed ? branch.count : branch.count - 1);
  const along = bestS * step + branch.s[samples[0]!]!;
  let rel = along - band.s0;
  if (branch.closed && rel < -branch.length / 2) rel += branch.length;
  if (rel < 0 || rel > bandSpan(band)) return false;
  return bestLat >= band.l0 && bestLat <= band.l1;
}

/** A shape made ready for repeated point tests. */
export type ShapeTester = {
  bounds: { x0: number; y0: number; x1: number; y1: number };
  contains: (x: number, y: number) => boolean;
};

export function shapeTester(shape: TrackShape, branches: readonly TrackBranch[]): ShapeTester {
  if (shape.type === 'circle') {
    const { x, y, radius } = shape;
    return {
      bounds: { x0: x - radius, y0: y - radius, x1: x + radius, y1: y + radius },
      contains: (px, py) => (px - x) * (px - x) + (py - y) * (py - y) <= radius * radius,
    };
  }
  if (shape.type === 'polygon') {
    const pts = shape.points;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return { bounds: { x0, y0, x1, y1 }, contains: (px, py) => pointInPolygon(pts, px, py) };
  }
  const band = resolveBand(shape, branches);
  const samples = bandSamples(band);
  const reach = Math.max(Math.abs(band.l0), Math.abs(band.l1)) + 2;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const i of samples) {
    x0 = Math.min(x0, band.branch.x[i]! - reach);
    y0 = Math.min(y0, band.branch.y[i]! - reach);
    x1 = Math.max(x1, band.branch.x[i]! + reach);
    y1 = Math.max(y1, band.branch.y[i]! + reach);
  }
  return { bounds: { x0, y0, x1, y1 }, contains: (px, py) => pointInBand(band, samples, px, py) };
}

/** Outline of a shape as a polygon, for drawing. Circles get 24 sides; bands follow the road. */
export function shapeOutline(shape: TrackShape, branches: readonly TrackBranch[]): TrackPoint[] {
  if (shape.type === 'polygon') return shape.points.map((p) => ({ x: p.x, y: p.y }));
  if (shape.type === 'circle') {
    const out: TrackPoint[] = [];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      out.push({
        x: shape.x + Math.cos(a) * shape.radius,
        y: shape.y + Math.sin(a) * shape.radius,
      });
    }
    return out;
  }
  const band = resolveBand(shape, branches);
  const { branch } = band;
  const span = bandSpan(band);
  const left: TrackPoint[] = [];
  const right: TrackPoint[] = [];
  const steps = Math.max(1, Math.ceil(span / 8));
  for (let k = 0; k <= steps; k++) {
    const s = band.s0 + (span * k) / steps;
    const p = branchPointAt(branch, s);
    left.push({ x: p.x - p.ty * band.l0, y: p.y + p.tx * band.l0 });
    right.push({ x: p.x - p.ty * band.l1, y: p.y + p.tx * band.l1 });
  }
  return [...left, ...right.reverse()];
}

/** Interpolated centerline position and unit tangent at arc length `s`. */
export function branchPointAt(
  branch: TrackBranch,
  sIn: number,
): { x: number; y: number; tx: number; ty: number } {
  let s = sIn;
  if (branch.closed) s = ((s % branch.length) + branch.length) % branch.length;
  else s = clamp(s, 0, branch.length);
  const intervals = branch.closed ? branch.count : branch.count - 1;
  const step = branch.length / intervals;
  let i = Math.floor(s / step);
  if (i >= intervals) i = intervals - 1;
  const f = clamp(s / step - i, 0, 1);
  const j = branch.closed ? (i + 1) % branch.count : i + 1;
  let tx = branch.tx[i]! + (branch.tx[j]! - branch.tx[i]!) * f;
  let ty = branch.ty[i]! + (branch.ty[j]! - branch.ty[i]!) * f;
  const d = Math.hypot(tx, ty) || 1;
  tx /= d;
  ty /= d;
  return {
    x: branch.x[i]! + (branch.x[j]! - branch.x[i]!) * f,
    y: branch.y[i]! + (branch.y[j]! - branch.y[i]!) * f,
    tx,
    ty,
  };
}
