import type { Decal, Shape, Solid } from '../../lib/model.js';
import { circle, roundRect, subtract } from '../../lib/model.js';
import type { PartAnchor3, PartArt } from '../types.js';
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

/** How a finished part differs from the solids as they were written. */
export type FinishOptions = {
  /**
   * Uniform magnification of the whole model about the mount point, heights included. The
   * hero pass draws a weapon larger than the base it stands on; the shapes are authored at
   * the size of the catalog footprint and enlarged here, so one number says how much.
   */
  scale?: number;
};

function scaleShape(shape: Shape, s: number): Shape {
  return (x, y) => s * shape(x / s, y / s);
}

function scaleSolid(solid: Solid, s: number): Solid {
  const out: Solid = {
    ...solid,
    shape: scaleShape(solid.shape, s),
    z0: solid.z0 * s,
    z1: solid.z1 * s,
  };
  if (solid.bevel !== undefined) out.bevel = solid.bevel * s;
  if (solid.floor !== undefined) out.floor = solid.floor * s;
  if (solid.height) {
    const height = solid.height;
    out.height = (x, y, d) => s * height(x / s, y / s, d / s);
  }
  return out;
}

export class Kit {
  readonly solids: Solid[] = [];
  readonly decals: Decal[] = [];
  private readonly muzzles: PartAnchor3[] = [];
  private pivotPoint: PartAnchor3 | null = null;
  private count = 0;

  /**
   * Marks where a shot leaves the part: the middle of a barrel's mouth, at the height of its
   * axis. Call once per barrel, in firing order. In the same units as the solids, before any
   * finishing scale.
   */
  muzzle(x: number, y: number, z: number): void {
    this.muzzles.push({ x, y, z });
  }

  /** Marks the axis a self-aiming head turns about, at the height of its bearing. */
  pivot(x: number, y: number, z: number): void {
    this.pivotPoint = { x, y, z };
  }

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

  done(id: string, cell: number, options: FinishOptions = {}): PartArt {
    const s = options.scale ?? 1;
    const round = (v: number) => Math.round(v * s * 100) / 100;
    const at = (p: PartAnchor3): PartAnchor3 => ({
      x: round(p.x) + 0,
      y: round(p.y) + 0,
      z: round(p.z) + 0,
    });
    const solids = s === 1 ? this.solids : this.solids.map((solid) => scaleSolid(solid, s));
    const decals =
      s === 1
        ? this.decals
        : this.decals.map((decal) => ({ ...decal, shape: scaleShape(decal.shape, s) }));
    const art: PartArt = { id, cell, model: { solids, decals, materials: PART_MATERIALS } };
    if (this.muzzles.length > 0) art.muzzles = this.muzzles.map(at);
    if (this.pivotPoint) art.pivot = at(this.pivotPoint);
    return art;
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
