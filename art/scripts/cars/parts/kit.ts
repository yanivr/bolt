import type { Decal, Shape, Solid } from '../../lib/model.js';
import { circle, roundRect, subtract } from '../../lib/model.js';
import type { PartArt } from '../types.js';
import { PART_MATERIALS } from './materials.js';

/**
 * Small construction kit for mounted parts. Every part is a handful of solids: a base that
 * bolts to the car, then a body built from upright blocks and posts, lying or sloped tubes
 * (barrels, tanks, arms) and raised plates. Model space is the part's own: origin at the mount
 * point, base at height 0, front toward negative Y, right toward positive X.
 */

type Extra = Partial<Pick<Solid, 'bevel' | 'profile' | 'floor' | 'tag' | 'noShadow' | 'height'>>;

/** Rectangle from A to B with half-width `r`: flat ends, or round ones when `round` is set. */
export function bar(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
  round = false,
): Shape {
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  return (x, y) => {
    const t = (x - ax) * ux + (y - ay) * uy;
    const s = -(x - ax) * uy + (y - ay) * ux;
    if (round) {
      const c = Math.max(0, Math.min(len, t));
      return Math.hypot(t - c, s) - r;
    }
    const qx = Math.abs(t - len / 2) - len / 2;
    const qy = Math.abs(s) - r;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
  };
}

/** Flat ring between two radii. */
export function annulus(cx: number, cy: number, outer: number, inner: number): Shape {
  return subtract(circle(cx, cy, outer), circle(cx, cy, inner));
}

/** Stripes of `width` every `pitch` units along the direction (dx, dy); clip with intersect. */
export function stripes(pitch: number, width: number, dx = 0, dy = 1, offset = 0): Shape {
  const len = Math.hypot(dx, dy) || 1;
  return (x, y) => {
    const t = (x * dx + y * dy) / len + offset;
    const m = ((t % pitch) + pitch) % pitch;
    return Math.abs(m - pitch / 2) - width / 2;
  };
}

/** Tag of the invisible solid that only informs the icon scale; see `iconFitMarker`. */
export const ICON_FIT_TAG = 'iconFit';

/**
 * The catalog icon is scaled from a model's ground radius plus half its lift, which crops the
 * top of a tall part on a small base (a mast, a bottle, an insulator). When a model would be
 * cropped, this returns a zero-height solid that covers one integer lattice point at the
 * radius the icon needs. The icon sizing scans integer points and so counts it; the renderer
 * samples between them and never draws it.
 */
function iconFitMarker(solids: Solid[]): Solid | null {
  const heading = (-3 * Math.PI * 2) / 32;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const lift = 0.62 * 1.3;
  let natural = 4;
  let up = 0;
  for (let y = -32; y <= 32; y += 0.5) {
    for (let x = -32; x <= 32; x += 0.5) {
      let first = true;
      for (const solid of solids) {
        const d = solid.shape(x, y);
        if (d > 0) continue;
        const whole = Number.isInteger(x) && Number.isInteger(y);
        if (first && whole) natural = Math.max(natural, Math.hypot(x, y) + (solid.z1 * lift) / 2);
        first = false;
        const z = solid.height ? solid.height(x, y, d) : solid.z1;
        up = Math.max(up, -(x * sin + y * cos) + z * lift);
      }
    }
  }
  const needed = Math.ceil(up * 0.92 + 0.6);
  if (needed <= natural) return null;
  return {
    shape: (x, y) => (x === needed && y === 0 ? -1 : 1),
    material: 'bore',
    z0: 0,
    z1: 0,
    noShadow: true,
    tag: ICON_FIT_TAG,
  };
}

export class Kit {
  readonly solids: Solid[] = [];
  readonly decals: Decal[] = [];
  private count = 0;

  /** Any shape as an upright solid from `z0` to `z1`. Returns the tag for decals. */
  add(shape: Shape, material: string, z0: number, z1: number, extra: Extra = {}): string {
    const tag = extra.tag ?? `s${this.count++}`;
    this.solids.push({ shape, material, z0, z1, ...extra, tag });
    return tag;
  }

  /** Upright block centred on (cx, cy). */
  block(
    cx: number,
    cy: number,
    hw: number,
    hh: number,
    z0: number,
    z1: number,
    material: string,
    extra: Extra & { r?: number } = {},
  ): string {
    const { r = 0.6, ...rest } = extra;
    return this.add(roundRect(cx, cy, hw, hh, r), material, z0, z1, rest);
  }

  /** Upright cylinder. */
  post(
    cx: number,
    cy: number,
    r: number,
    z0: number,
    z1: number,
    material: string,
    extra: Extra = {},
  ): string {
    return this.add(circle(cx, cy, r), material, z0, z1, extra);
  }

  /**
   * Upright cylinder in horizontal bands: `bands` lists [topHeight, material] from the bottom
   * up. Sides take each band's material, so stripes survive every heading.
   */
  banded(shape: Shape, z0: number, bands: Array<[number, string]>, extra: Extra = {}): string {
    let tag = '';
    let from = z0;
    for (const [top, material] of bands) {
      tag = this.add(shape, material, from, top, extra);
      from = top;
    }
    return tag;
  }

  /**
   * Cylinder lying on its side from A to B, its axis at height `za` at A and `zb` at B. It
   * floats: nothing is drawn below it, so it needs a cradle or a body to grow out of. Only a
   * short skirt hangs under its widest line (the camera never sees the underside), which keeps
   * the lit, decal-carrying top dominant. A sloped tube is cut into short lengths so the gap
   * under it follows the slope.
   */
  tube(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    r: number,
    za: number,
    zb: number,
    material: string,
    extra: Extra & { round?: boolean; web?: number } = {},
  ): string {
    const { round = false, web = 0, ...rest } = extra;
    const tag = rest.tag ?? `s${this.count++}`;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    const pieces = Math.max(1, Math.ceil(Math.abs(zb - za) / 1.2));
    for (let i = 0; i < pieces; i++) {
      const t0 = i / pieces;
      const t1 = (i + 1) / pieces;
      const whole = bar(ax, ay, bx, by, r, round);
      const cut: Shape =
        pieces === 1
          ? whole
          : (x, y) => {
              const t = ((x - ax) * ux + (y - ay) * uy) / len;
              const lo = i === 0 ? -Infinity : t0;
              const hi = i === pieces - 1 ? Infinity : t1;
              return Math.max(whole(x, y), (lo - t) * len, (t - hi) * len);
            };
      const zLo = Math.min(za + (zb - za) * t0, za + (zb - za) * t1);
      this.solids.push({
        shape: cut,
        material,
        z0: zLo,
        z1: Math.max(za, zb) + r,
        floor: Math.max(0, zLo - r * 0.4 - web),
        ...rest,
        tag,
        height: (x, y) => {
          const t = Math.max(0, Math.min(1, ((x - ax) * ux + (y - ay) * uy) / len));
          const s = -(x - ax) * uy + (y - ay) * ux;
          return za + (zb - za) * t + Math.sqrt(Math.max(r * r * 0.1, r * r - s * s));
        },
      });
    }
    return tag;
  }

  /** A plate whose top slopes: height is `zFront` at y = y0 and `zBack` at y = y1. */
  ramp(
    shape: Shape,
    material: string,
    y0: number,
    zFront: number,
    y1: number,
    zBack: number,
    extra: Extra = {},
  ): string {
    return this.add(shape, material, Math.min(zFront, zBack), Math.max(zFront, zBack), {
      ...extra,
      height: (_x, y) => {
        const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0)));
        return zFront + (zBack - zFront) * t;
      },
    });
  }

  decal(shape: Shape, on: string | string[], what: { material?: string; shade?: number }): void {
    this.decals.push({ shape, on: Array.isArray(on) ? on : [on], ...what });
  }

  /** Bright bolt heads on a tagged surface. */
  bolts(on: string | string[], points: Array<[number, number]>, r = 0.6, shade = 2): void {
    for (const [x, y] of points) this.decal(circle(x, y, r), on, { shade });
  }

  done(id: string, cell: number): PartArt {
    // Tallest first: the baker sizes an icon from the first solid it finds over each point.
    const solids = this.solids
      .map((solid, i) => ({ solid, i }))
      .sort((a, b) => b.solid.z1 - a.solid.z1 || a.i - b.i)
      .map((entry) => entry.solid);
    const marker = iconFitMarker(solids);
    if (marker) solids.push(marker);
    return { id, cell, model: { solids, decals: this.decals, materials: PART_MATERIALS } };
  }
}

/** The four corners of a centred rectangle, for bolt patterns. */
export function corners(hw: number, hh: number, cx = 0, cy = 0): Array<[number, number]> {
  return [
    [cx - hw, cy - hh],
    [cx + hw, cy - hh],
    [cx - hw, cy + hh],
    [cx + hw, cy + hh],
  ];
}
