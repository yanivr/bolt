import { clamp } from '@bolt/shared';

/**
 * Readability first (Sections 12.1 and 13.8): the haze, the frost vignette and anything else
 * the weather lays over the picture must never cover the local car, the road ahead of it or
 * the rival. The protected zone is the union of a disc round the local car, a capsule along
 * its direction of travel as long as about a second of driving, and a disc round the rival.
 * Screen-wide layers ask `clearance` for the distance from a sprite's rectangle to the zone
 * and draw nothing inside `GUARD_GAP` of it, then ramp in over `GUARD_RAMP`. The unit test
 * composites the real sprites over the zone and holds their alpha under a threshold.
 */

export const OWN_RADIUS = 76;
export const AHEAD_RADIUS = 72;
/** Look-ahead: about 1.15 s of road at the car's speed, never less than this or more. */
export const AHEAD_MIN = 110;
export const AHEAD_MAX = 380;
export const AHEAD_SECONDS = 1.15;
export const RIVAL_RADIUS = 64;
/** Nothing is drawn this close to the zone; full strength is reached this much further out. */
export const GUARD_GAP = 6;
export const GUARD_RAMP = 110;

export class ProtectedZone {
  ownX = 0;
  ownY = 0;
  /** End of the look-ahead capsule. */
  aheadX = 0;
  aheadY = 0;
  rivalX = 0;
  rivalY = 0;
  rival = false;
  own = false;

  set(
    ownPresent: boolean,
    x: number,
    y: number,
    vx: number,
    vy: number,
    heading: number,
    rivalPresent: boolean,
    rx: number,
    ry: number,
  ): void {
    this.own = ownPresent;
    this.ownX = x;
    this.ownY = y;
    const speed = Math.hypot(vx, vy);
    const reach = clamp(speed * AHEAD_SECONDS, AHEAD_MIN, AHEAD_MAX);
    // Along the velocity when moving, along the nose when not.
    const dx = speed > 20 ? vx / speed : Math.sin(heading);
    const dy = speed > 20 ? vy / speed : -Math.cos(heading);
    this.aheadX = x + dx * reach;
    this.aheadY = y + dy * reach;
    this.rival = rivalPresent;
    this.rivalX = rx;
    this.rivalY = ry;
  }

  /** Distance from a world rectangle to the zone; 0 or less when they touch. */
  clearance(x0: number, y0: number, x1: number, y1: number): number {
    let best = Infinity;
    if (this.own) {
      best = Math.min(best, rectPoint(x0, y0, x1, y1, this.ownX, this.ownY) - OWN_RADIUS);
      best = Math.min(
        best,
        rectSegment(x0, y0, x1, y1, this.ownX, this.ownY, this.aheadX, this.aheadY) - AHEAD_RADIUS,
      );
    }
    if (this.rival)
      best = Math.min(best, rectPoint(x0, y0, x1, y1, this.rivalX, this.rivalY) - RIVAL_RADIUS);
    return best;
  }

  /** 0 inside the zone and its gap, rising to 1 over the ramp. */
  allowance(x0: number, y0: number, x1: number, y1: number): number {
    const d = this.clearance(x0, y0, x1, y1);
    return clamp((d - GUARD_GAP) / GUARD_RAMP, 0, 1);
  }

  /** True when a world point is inside the zone itself. */
  contains(x: number, y: number): boolean {
    return this.clearance(x, y, x, y) <= 0;
  }
}

function rectPoint(x0: number, y0: number, x1: number, y1: number, px: number, py: number): number {
  const dx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
  const dy = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
  return Math.hypot(dx, dy);
}

/**
 * Distance from a rectangle to a segment, never more than the truth: the distance from the
 * rectangle's centre to the segment less its half diagonal. Cheap, and errs toward guarding.
 */
function rectSegment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((cx - ax) * dx + (cy - ay) * dy) / len2, 0, 1) : 0;
  const d = Math.hypot(cx - (ax + dx * t), cy - (ay + dy * t));
  return d - Math.hypot(x1 - x0, y1 - y0) / 2;
}

/**
 * How strong edge haze is at a point of the screen: nothing in the middle, full in the
 * corners. `u`, `v` are 0 to 1 across the view.
 */
export function edgeWeight(u: number, v: number): number {
  const dx = (u - 0.5) * 2;
  const dy = (v - 0.5) * 2;
  const r = Math.hypot(dx * 0.92, dy) / Math.SQRT2;
  return clamp((r - 0.42) / 0.5, 0, 1);
}

/** Alpha in fixed steps (Section 12.4: no gradients): `step` apart, rounded down. */
export function stepped(alpha: number, step: number): number {
  return Math.floor(alpha / step + 1e-6) * step;
}
