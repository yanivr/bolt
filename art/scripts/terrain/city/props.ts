import type { TerrainLight } from '@bolt/shared';
import type { Color } from '../canvas.js';
import type { LightPool } from '../lighting.js';
import type { Scene, Sprite } from '../oblique.js';
import { PAL, TINT_HEX, TINT_WARM } from './palette.js';
import { carSprite, lantern, treeSprite } from './sprites.js';

/** Placement helpers: stand a prop in the scene together with its shadow and its light. */

export type LightOut = { pools: LightPool[]; lights: TerrainLight[] };

/** Stands a sprite if it covers no drivable ground. `fw` is the width of its foot. */
export function stand(
  scene: Scene,
  sp: Sprite,
  x: number,
  y: number,
  fw: number,
  len: number,
): boolean {
  if (!scene.spriteFits(sp, x, y)) return false;
  scene.place(sp, x, y);
  if (len > 0) scene.footprint(x - (fw >> 1), y - 1, fw, 2, len);
  return true;
}

export function plantTree(
  scene: Scene,
  x: number,
  y: number,
  r: number,
  seed: number,
  warm = false,
): boolean {
  const sp = treeSprite(r, seed, warm);
  if (!scene.spriteFits(sp, x, y)) return false;
  scene.place(sp, x, y);
  scene.shadeDisc(x + 3, y + 1, r * 0.85, 1.7);
  return true;
}

const LANTERN_GLOW: readonly Color[] = [
  PAL.lampGlow,
  PAL.cyan,
  PAL.coral,
  PAL.purple,
  PAL.gold,
  PAL.steelHi,
];

export function standLantern(
  scene: Scene,
  out: LightOut,
  x: number,
  y: number,
  tint: number,
  radii: readonly number[],
  listed = false,
): boolean {
  const sp = lantern(tint === TINT_WARM ? PAL.lamp : PAL.ivory, LANTERN_GLOW[tint] ?? PAL.lampGlow);
  if (!scene.spriteFits(sp, x, y)) return false;
  scene.place(sp, x, y);
  out.pools.push({ x, y: y + 2, radii, tint });
  if (listed)
    out.lights.push({
      x,
      y,
      radius: radii[radii.length - 1]!,
      color: TINT_HEX[tint]!,
      intensity: 0.6,
    });
  return true;
}

/** Parks a car with its nose-to-tail axis centered on (cx, cy) at ground level. */
export function parkCar(
  scene: Scene,
  cx: number,
  cy: number,
  horizontal: boolean,
  flip: boolean,
  paint: Color,
): boolean {
  const sp = carSprite(horizontal, flip, paint);
  const gy = cy + (horizontal ? 8 : 16);
  if (!scene.spriteFits(sp, cx, gy)) return false;
  scene.place(sp, cx, gy);
  if (horizontal) scene.footprint(cx - 15, gy - 15, 30, 16, 3);
  else scene.footprint(cx - 8, gy - 30, 16, 31, 3);
  return true;
}
