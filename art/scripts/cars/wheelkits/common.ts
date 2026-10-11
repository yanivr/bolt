import type { Decal, Model, Shape, Solid } from '../../lib/model.js';
import { roundRect } from '../../lib/model.js';
import { DRIVE_MATERIALS } from '../engines/materials.js';
import type { WheelArt } from '../types.js';

/**
 * Shared vocabulary for wheel kits. A kit is one wheel seen from above, rolling along Y and
 * centred on its anchor. The carcass is a heightfield: a crown across the width, a gentle arc
 * along the length, and optional lugs that add real height, so tread reads both as shading on
 * top and as a toothed silhouette along the sides. Everything that moves with the roll takes
 * `y + offset`, where the offset grows with the roll phase, so tread travels toward the front
 * of the wheel (negative Y) as the car drives forward.
 *
 * The same sprite serves left and right wheels, so every kit is symmetric about X = 0.
 */

export type TireSpec = {
  /** Half width, half length and corner radius of the footprint. */
  hw: number;
  hl: number;
  corner: number;
  /** Height of the crown. */
  top: number;
  /** Shoulder exponent: 2 is a round barrel, higher is a flat crown with square shoulders. */
  crown?: number;
  /** How far the top falls away toward the front and back, 0 (flat slab) to 1 (half disc). */
  arc?: number;
  material?: string;
};

export const wrap = (value: number, pitch: number): number => ((value % pitch) + pitch) % pitch;

/** Distance the tread has travelled at a roll phase, for a pattern repeating every `pitch`. */
export const rollOffset = (phase: number, frames: number, pitch: number): number =>
  (wrap(phase, frames) / frames) * pitch;

export const tireShape = (spec: TireSpec): Shape => roundRect(0, 0, spec.hw, spec.hl, spec.corner);

export function tireHeight(spec: TireSpec): (x: number, y: number) => number {
  const p = spec.crown ?? 2;
  const arc = spec.arc ?? 0.22;
  return (x, y) => {
    const u = Math.min(1, Math.abs(x) / (spec.hw + 0.4));
    const v = Math.min(1, Math.abs(y) / (spec.hl + 0.3));
    const shoulder = Math.max(0.2, (1 - u ** p) ** (1 / p));
    return spec.top * shoulder * (1 - arc * (1 - Math.sqrt(1 - v * v)));
  };
}

/** The carcass. `lugs` returns extra height (tread blocks, studs, paddles) at a point. */
export function tire(
  spec: TireSpec,
  lugs?: (x: number, y: number) => number,
  shape: Shape = tireShape(spec),
): Solid {
  const base = tireHeight(spec);
  return {
    shape,
    material: spec.material ?? 'rubber',
    z0: 0,
    z1: spec.top,
    height: lugs ? (x, y) => base(x, y) + lugs(x, y) : base,
    tag: 'tire',
  };
}

/** Smooth 0..1 bump across a repeating bar `width` long, with soft edges so it never aliases. */
export function bar(value: number, pitch: number, width: number, soft = 0.45): number {
  const m = wrap(value, pitch);
  return Math.max(0, Math.min(1, Math.min(m, width - m) / soft));
}

/**
 * Widens a footprint at repeating places along its sides only (never at its ends, which would
 * make the wheel change length as it rolls). `bump` is how far the side stands out at a point.
 */
export function withSideLugs(spec: TireSpec, bump: (x: number, y: number) => number): Shape {
  const base = tireShape(spec);
  const flat = spec.hl - spec.corner - 0.4;
  return (x, y) => {
    const fade = Math.max(0, Math.min(1, (flat - Math.abs(y)) / 1.2));
    return base(x, y) - bump(x, y) * fade;
  };
}

/**
 * A thin part standing on both sides of the wheel between `x0` and `x1` from the centreline:
 * sidewall rings, hub caps, shield plates, road wheels. Its outer wall is what the tilted
 * camera sees when the wheel is side-on.
 */
export function flank(
  x0: number,
  x1: number,
  halfLength: number,
  material: string,
  height: (y: number) => number,
  extra: Partial<Solid> = {},
): Solid {
  const mid = (x0 + x1) / 2;
  const half = (x1 - x0) / 2;
  return {
    shape: (x, y) => Math.max(Math.abs(Math.abs(x) - mid) - half, Math.abs(y) - halfLength),
    material,
    z0: 0,
    z1: height(0),
    height: (_x, y) => height(y),
    tag: 'flank',
    noShadow: true,
    ...extra,
  };
}

/** Upper half of a disc standing on edge along Y: a hub cap or a road wheel seen from the side. */
export const disc =
  (cy: number, radius: number, axle: number, squash = 1): ((y: number) => number) =>
  (y) =>
    axle + squash * Math.sqrt(Math.max(0, radius * radius - (y - cy) ** 2));

export function kit(solids: Solid[], decals: Decal[]): Model {
  return { solids, decals, materials: DRIVE_MATERIALS };
}

export function wheel(
  id: string,
  cell: number,
  rollFrames: number,
  model: (rollPhase: number) => Model,
): WheelArt {
  return { id, cell, rollFrames, model };
}
