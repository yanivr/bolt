import { CAR_RESTITUTION, RAM_YAW_KICK, SWEEP_STEP } from '../balance.js';
import { clamp, wrapAngle } from '../math.js';
import type { TrackLocation, TrackRuntime } from '../track.js';
import { locate, wallDepth } from '../track.js';
import type { VehicleMotionState, VehicleParams } from '../types.js';

/**
 * Geometry the combat step shares: where a point on a car is in the world, whether a line is
 * blocked by the track's solid edges, swept circle tests for fast projectiles (Section 7.3),
 * and contact between two car bodies. Pure functions writing into caller-owned scratch.
 */

export type Vec = { x: number; y: number };

/** Chassis-local point (x right, y toward the rear) to world. */
export function localToWorld(m: VehicleMotionState, lx: number, ly: number, out: Vec): Vec {
  const fx = Math.sin(m.headingRad);
  const fy = -Math.cos(m.headingRad);
  out.x = m.x + -fy * lx - fx * ly;
  out.y = m.y + fx * lx - fy * ly;
  return out;
}

/**
 * True when a world point is inside something solid: off a walled track's corridor, in an
 * obstacle, or in a wall. A rail crossing's barrier does not stop shots: it is a boom at bumper
 * height, and line of sight over it stays open.
 */
export function pointSolid(
  track: TrackRuntime,
  x: number,
  y: number,
  radius: number,
  loc: TrackLocation,
): 0 | 1 | 2 {
  // A walled track's corridor edge is solid; on an open track only the authored walls are.
  if (track.walled) {
    locate(track, x, y, loc);
    if (loc.edge + radius > 0) return 1;
  }
  const gc = Math.floor(x / 96);
  const gr = Math.floor(y / 96);
  if (gc >= 0 && gr >= 0 && gc < track.gridCols && gr < track.gridRows) {
    const bucket = track.obstacleGrid[gr * track.gridCols + gc]!;
    for (let k = 0; k < bucket.length; k++) {
      const ob = track.obstacles[bucket[k]!]!;
      const dx = ob.x - x;
      const dy = ob.y - y;
      const reach = ob.radius + radius;
      if (dx * dx + dy * dy < reach * reach) return 2;
    }
  }
  if (track.walls.count > 0 && wallDepth(track, x, y, radius) > 0) return 1;
  return 0;
}

/**
 * Walks a segment and returns how far along it (0 to 1) something solid is first met, or 2
 * when the way is clear. `what` receives 1 for a wall and 2 for an obstacle.
 */
export function sweepSolid(
  track: TrackRuntime,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  loc: TrackLocation,
  what: { kind: number },
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(length / SWEEP_STEP));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const solid = pointSolid(track, x0 + dx * t, y0 + dy * t, radius, loc);
    if (solid !== 0) {
      what.kind = solid;
      return t;
    }
  }
  what.kind = 0;
  return 2;
}

const losScratch = { kind: 0 };

/** Line of sight between two world points: nothing solid in between. */
export function lineClear(
  track: TrackRuntime,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  loc: TrackLocation,
): boolean {
  return sweepSolid(track, x0, y0, x1, y1, 0, loc, losScratch) > 1;
}

/**
 * Earliest contact of a moving point with a circle. The segment is given relative to the
 * circle's centre. Returns the position along the segment, 0 to 1, or 2 for a miss.
 */
export function segmentCircle(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const c = x0 * x0 + y0 * y0 - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a < 1e-12) return 2;
  const b = x0 * dx + y0 * dy;
  if (b >= 0) return 2;
  const disc = b * b - a * c;
  if (disc < 0) return 2;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 && t <= 1 ? t : 2;
}

/**
 * Earliest contact of a segment with a car's two body circles, with the car at `cx`, `cy`.
 * Returns 0 to 1, or 2 for a miss.
 */
export function segmentCar(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  headingRad: number,
  params: VehicleParams,
  extra: number,
): number {
  const fx = Math.sin(headingRad) * params.colliderOffset;
  const fy = -Math.cos(headingRad) * params.colliderOffset;
  const r = params.colliderRadius + extra;
  const front = segmentCircle(x0 - cx - fx, y0 - cy - fy, x1 - cx - fx, y1 - cy - fy, r);
  const rear = segmentCircle(x0 - cx + fx, y0 - cy + fy, x1 - cx + fx, y1 - cy + fy, r);
  return Math.min(front, rear);
}

/** Distance from a world point to a car's hull (zero inside it), and the nearest point on it. */
export function hullDistance(
  m: VehicleMotionState,
  params: VehicleParams,
  x: number,
  y: number,
  nearest: Vec | null,
): number {
  const fx = Math.sin(m.headingRad) * params.colliderOffset;
  const fy = -Math.cos(m.headingRad) * params.colliderOffset;
  let best = Infinity;
  for (let c = 0; c < 2; c++) {
    const sign = c === 0 ? 1 : -1;
    const cx = m.x + fx * sign;
    const cy = m.y + fy * sign;
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy);
    const gap = Math.max(0, d - params.colliderRadius);
    if (gap < best) {
      best = gap;
      if (nearest) {
        if (d > 1e-6) {
          const k = Math.min(1, params.colliderRadius / d);
          nearest.x = cx + dx * k;
          nearest.y = cy + dy * k;
        } else {
          nearest.x = cx;
          nearest.y = cy;
        }
      }
    }
  }
  return best;
}

/** Clear distance between the hulls of two cars: zero when they touch. */
export function hullGap(
  a: VehicleMotionState,
  ap: VehicleParams,
  b: VehicleMotionState,
  bp: VehicleParams,
): number {
  const afx = Math.sin(a.headingRad) * ap.colliderOffset;
  const afy = -Math.cos(a.headingRad) * ap.colliderOffset;
  const bfx = Math.sin(b.headingRad) * bp.colliderOffset;
  const bfy = -Math.cos(b.headingRad) * bp.colliderOffset;
  let best = Infinity;
  for (let i = 0; i < 2; i++) {
    const sa = i === 0 ? 1 : -1;
    for (let j = 0; j < 2; j++) {
      const sb = j === 0 ? 1 : -1;
      const d = Math.hypot(b.x + bfx * sb - a.x - afx * sa, b.y + bfy * sb - a.y - afy * sa);
      if (d < best) best = d;
    }
  }
  return Math.max(0, best - ap.colliderRadius - bp.colliderRadius);
}

/** Whether `angle` lies within `half` radians of `axis`. */
export function withinArc(axis: number, angle: number, half: number): boolean {
  return half >= Math.PI || Math.abs(wrapAngle(angle - axis)) <= half;
}

// --- Car against car ---------------------------------------------------------------------------

export type CarContact = {
  /** Unit normal from car A toward car B. */
  nx: number;
  ny: number;
  overlap: number;
  /** Contact point, world. */
  x: number;
  y: number;
  /** Which end of each car touched: 1 front circle, -1 rear. */
  endA: number;
  endB: number;
  /** Speed at which the two were closing along the normal before the response, px/s. */
  closing: number;
};

export function createContact(): CarContact {
  return { nx: 0, ny: 0, overlap: 0, x: 0, y: 0, endA: 1, endB: 1, closing: 0 };
}

/** Finds the deepest overlap between the body circles of two cars. False when they are apart. */
export function findCarContact(
  a: VehicleMotionState,
  ap: VehicleParams,
  b: VehicleMotionState,
  bp: VehicleParams,
  out: CarContact,
): boolean {
  const afx = Math.sin(a.headingRad) * ap.colliderOffset;
  const afy = -Math.cos(a.headingRad) * ap.colliderOffset;
  const bfx = Math.sin(b.headingRad) * bp.colliderOffset;
  const bfy = -Math.cos(b.headingRad) * bp.colliderOffset;
  const reach = ap.colliderRadius + bp.colliderRadius;
  let best = 0;
  for (let i = 0; i < 2; i++) {
    const sa = i === 0 ? 1 : -1;
    const ax = a.x + afx * sa;
    const ay = a.y + afy * sa;
    for (let j = 0; j < 2; j++) {
      const sb = j === 0 ? 1 : -1;
      const bx = b.x + bfx * sb;
      const by = b.y + bfy * sb;
      const dx = bx - ax;
      const dy = by - ay;
      const dist = Math.hypot(dx, dy);
      const overlap = reach - dist;
      if (overlap > best) {
        best = overlap;
        // Two centres on the same spot have no direction: push along A's own axis.
        const inv = dist > 1e-6 ? 1 / dist : 0;
        out.nx = inv > 0 ? dx * inv : Math.sin(a.headingRad);
        out.ny = inv > 0 ? dy * inv : -Math.cos(a.headingRad);
        out.overlap = overlap;
        out.x = ax + out.nx * ap.colliderRadius;
        out.y = ay + out.ny * ap.colliderRadius;
        out.endA = sa;
        out.endB = sb;
      }
    }
  }
  return best > 0;
}

/**
 * Separates two touching cars and exchanges momentum along the contact normal, split by mass
 * (Section 7.3 step 6: heavy cars are hard to move, light ones are knocked aside). `scaleA`
 * and `scaleB` scale the push each car receives (ram parts, dampers, the spawn grace).
 * With `moveB` false only A is moved, against B as it is: what a client uses to predict its
 * own car against a rival it does not simulate.
 */
export function resolveCarContact(
  a: VehicleMotionState,
  ap: VehicleParams,
  b: VehicleMotionState,
  bp: VehicleParams,
  contact: CarContact,
  scaleA: number,
  scaleB: number,
  moveB: boolean,
): void {
  const ma = ap.massKg;
  const mb = bp.massKg;
  const total = ma + mb;
  const { nx, ny } = contact;
  a.x -= nx * contact.overlap * (mb / total);
  a.y -= ny * contact.overlap * (mb / total);
  if (moveB) {
    b.x += nx * contact.overlap * (ma / total);
    b.y += ny * contact.overlap * (ma / total);
  }
  const closing = (a.velocityX - b.velocityX) * nx + (a.velocityY - b.velocityY) * ny;
  contact.closing = closing;
  if (closing <= 0) return;
  const j = ((1 + CAR_RESTITUTION) * closing * ma * mb) / total;
  const dva = (-j / ma) * scaleA;
  const dvb = (j / mb) * scaleB;
  a.velocityX += nx * dva;
  a.velocityY += ny * dva;
  // A push on one end of the body turns the car, as a wall does.
  const arx = Math.cos(a.headingRad);
  const ary = Math.sin(a.headingRad);
  a.yawRate += clamp(contact.endA * (nx * arx + ny * ary) * dva * RAM_YAW_KICK, -1.2, 1.2);
  if (moveB) {
    b.velocityX += nx * dvb;
    b.velocityY += ny * dvb;
    const brx = Math.cos(b.headingRad);
    const bry = Math.sin(b.headingRad);
    b.yawRate += clamp(contact.endB * (nx * brx + ny * bry) * dvb * RAM_YAW_KICK, -1.2, 1.2);
  }
}
