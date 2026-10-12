import { hash2 } from '@bolt/shared';
import type { Env } from './env.js';
import { getc, put } from './env.js';
import { K_OFF, K_PAVE } from './maps.js';
import { vnoise } from './noise.js';
import { mixc } from '../canvas.js';
import { NAT } from './palette.js';
import { plantTree } from './place.js';
import type { Species, TreeSpec } from './trees.js';

/**
 * Shared forest dressing: woods where no car can go (the margin outside the boundary and the
 * pockets the obstacles close off), the mushroom ring, roadside mist.
 */

/** True when a disc of radius `r` at (x, y) lies wholly on ground no car can reach. */
export function unreachableDisc(env: Env, x: number, y: number, r: number): boolean {
  const { w, h, reach, water } = env.maps;
  for (let yy = Math.floor(y - r); yy <= y + r; yy++)
    for (let xx = Math.floor(x - r); xx <= x + r; xx++) {
      if ((xx - x) ** 2 + (yy - y) ** 2 > r * r) continue;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const i = yy * w + xx;
      if (reach.drive[i] || water[i]) return false;
    }
  return true;
}

/**
 * Trees on every patch of ground no car can reach and that is not water: the dense woods past
 * the boundary, and the pockets closed off by rows of trees. Their trunks stand only there.
 */
export function plantUnreachable(
  env: Env,
  species: readonly Species[],
  spacing: number,
  seed: number,
  opts: { trunk?: number; minRoadDist?: number; maxRoadDist?: number; extra?: Partial<TreeSpec> } = {},
): number {
  const { w, h } = env.maps;
  const r = opts.trunk ?? 10;
  let n = 0;
  for (let gy = 0; gy < h; gy += spacing)
    for (let gx = 0; gx < w; gx += spacing) {
      const x = Math.round(gx + hash2(gx, gy, seed) * spacing * 0.8);
      const y = Math.round(gy + hash2(gx, gy, seed + 1) * spacing * 0.8);
      if (x < r || y < r || x >= w - r || y >= h - r) continue;
      const rd = env.maps.roadDist[y * w + x]!;
      if (rd < (opts.minRoadDist ?? 40) || rd > (opts.maxRoadDist ?? 1e9)) continue;
      if (!unreachableDisc(env, x, y, r + 1)) continue;
      // Not on top of a solid that is drawn already (an obstacle or a wall).
      if (env.maps.reach.solid[y * w + x]) continue;
      const sp = species[Math.floor(hash2(x, y, seed + 2) * species.length)]!;
      // Background woods share sixteen recipes per species.
      const variant = Math.floor(hash2(x, y, seed + 3) * 16);
      plantTree(env, { species: sp, seed: seed * 31 + variant, radius: r, ...opts.extra }, x, y, 10, true);
      n++;
    }
  return n;
}

export function plantBoundaryWoods(env: Env, species: readonly Species[], spacing: number, seed: number): number {
  return plantUnreachable(env, species, spacing, seed, { minRoadDist: 200 });
}

export function plantReach(env: Env, species: readonly Species[], seed: number): number {
  return plantUnreachable(env, species, 30, seed, { trunk: 8, minRoadDist: 30, maxRoadDist: 190, extra: { crownScale: 0.7, heightScale: 0.8 } });
}

/** A fairy ring of small glowing mushrooms in a darker ring of moss. Flat: a car may cross it. */
export function paintMushroomRing(env: Env, cx: number, cy: number, r: number, seed: number): void {
  const { w, h } = env.maps;
  const world = env.world;
  // A ring of richer grass where the fungus feeds, broken and uneven.
  for (let y = Math.floor(cy - r - 8); y <= cy + r + 8; y++)
    for (let x = Math.floor(cx - r - 8); x <= cx + r + 8; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = y * w + x;
      if (env.maps.kind[i] !== K_OFF) continue;
      const d = Math.hypot(x - cx, (y - cy) / 0.75);
      const band = Math.abs(d - r) + (vnoise(x, y, 5, seed) - 0.5) * 4;
      if (band < 2.5 && hash2(x >> 1, y >> 1, seed + 4) < 0.7) put(world, i, (x + y) & 1 ? NAT.grassLight : NAT.mossHi);
    }
  for (let k = 0; k < 22; k++) {
    const a = (k / 22) * Math.PI * 2 + hash2(k, 1, seed) * 0.2;
    const x = Math.round(cx + Math.cos(a) * r);
    const y = Math.round(cy + Math.sin(a) * r * 0.75);
    const glow = hash2(k, 2, seed) < 0.5;
    put(world, (y + 1) * w + x, NAT.mushroomStem);
    put(world, y * w + x, glow ? NAT.mushroomGlow : NAT.mushroomCap);
    put(world, y * w + x - 1, glow ? NAT.mushroomGlow : NAT.mushroomCap);
    put(world, (y - 1) * w + x, glow ? NAT.mushroomGlowHi : NAT.mushroomCapHi);
  }
}

/** Pale mist lying along the roadside in a shaded bend: a static, posterized lift. Off the pavement. */
export function paintMist(env: Env, cx: number, cy: number, rx: number, ry: number, seed: number): void {
  const { w, h } = env.maps;
  const world = env.world;
  for (let y = Math.floor(cy - ry - 8); y <= cy + ry + 8; y++)
    for (let x = Math.floor(cx - rx - 8); x <= cx + rx + 8; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = y * w + x;
      if (env.maps.kind[i] === K_PAVE || env.maps.water[i]) continue;
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry) + (vnoise(x, y, 14, seed) - 0.5) * 0.5;
      if (d > 1) continue;
      // Two hard steps of pale, cool lift; no dither.
      const k = d < 0.55 ? 0.24 : 0.12;
      put(world, i, mixc(getc(world, i), 0xc8d8d4, k));
    }
}
