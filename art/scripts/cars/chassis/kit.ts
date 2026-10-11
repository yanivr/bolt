import type { Model, Shape, Solid, Decal } from '../../lib/model.js';
import { grow, subtract } from '../../lib/model.js';
import { CHASSIS_MATERIALS } from './materials.js';

/** Small authoring helpers shared by the chassis models in this folder. */

export type Pt = [number, number];

/** Completes a polygon authored for the right-hand side (x >= 0), top to bottom. */
export const mirrorPoints = (right: Pt[]): Pt[] => [
  ...right,
  ...right
    .slice()
    .reverse()
    .filter(([x]) => x !== 0)
    .map(([x, y]) => [-x, y] as Pt),
];

/** A band of the given width just outside a shape: panel gaps and seams. */
export const ring = (shape: Shape, width: number): Shape => subtract(grow(shape, width), shape);

/** A band between two parallel lines turned `deg` clockwise from the X axis. */
export const slash = (deg: number, offset: number, halfWidth: number): Shape => {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return (x, y) => Math.abs(y * c - x * s - offset) - halfWidth;
};

/** Terse solid constructor: shape, material, rim height, top height, bevel, then anything else. */
export function solid(
  shape: Shape,
  material: string,
  z0: number,
  z1: number,
  bevel = 0,
  extra: Partial<Solid> = {},
): Solid {
  return { shape, material, z0, z1, ...(bevel > 0 ? { bevel } : {}), ...extra };
}

/** A part that floats: only the band between `z1 - thickness` and `z1` is drawn. */
export function floating(
  shape: Shape,
  material: string,
  z1: number,
  thickness: number,
  extra: Partial<Solid> = {},
): Solid {
  return {
    shape,
    material,
    z0: z1 - Math.min(thickness, 0.8),
    z1,
    bevel: 0.8,
    floor: z1 - thickness,
    ...extra,
  };
}

export const headlight = (shape: Shape, z0: number, z1: number, bevel = 0.8): Solid => ({
  shape,
  material: 'lampOff',
  z0,
  z1,
  bevel,
  tag: 'headlight',
  noShadow: true,
});

export const taillight = (shape: Shape, z0: number, z1: number, bevel = 0.6): Solid => ({
  shape,
  material: 'tailOff',
  z0,
  z1,
  bevel,
  tag: 'taillight',
  noShadow: true,
});

export const model = (solids: Solid[], decals: Decal[]): Model => ({
  solids,
  decals,
  materials: CHASSIS_MATERIALS,
});

/**
 * A tube that climbs from one height to another, as short floating segments. `make` builds the
 * outline of one segment (use it to mirror the tube onto both sides).
 */
export function slopedTube(
  a: [number, number, number],
  b: [number, number, number],
  material: string,
  make: (ax: number, ay: number, bx: number, by: number) => Shape,
  thickness = 1.6,
  extra: Partial<Solid> = {},
): Solid[] {
  const steps = Math.max(2, Math.ceil(Math.abs(b[2] - a[2]) / 1.8));
  const out: Solid[] = [];
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const z = a[2] + (b[2] - a[2]) * ((i + 0.5) / steps);
    out.push(
      floating(
        make(
          a[0] + (b[0] - a[0]) * t0,
          a[1] + (b[1] - a[1]) * t0,
          a[0] + (b[0] - a[0]) * t1,
          a[1] + (b[1] - a[1]) * t1,
        ),
        material,
        z,
        thickness,
        extra,
      ),
    );
  }
  return out;
}

/** Intersection of any number of shapes. */
export const all = (...shapes: Shape[]): Shape => {
  return (x, y) => {
    let d = -Infinity;
    for (const s of shapes) d = Math.max(d, s(x, y));
    return d;
  };
};
