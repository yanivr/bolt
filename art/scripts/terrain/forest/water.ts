import { hash2 } from '@bolt/shared';
import type { Color } from '../canvas.js';
import { distanceField } from './edt.js';
import type { Env } from './env.js';
import { getc, put } from './env.js';
import { fbm, vnoise } from './noise.js';
import { NAT } from './palette.js';

/**
 * Water on an open track is wherever the physics makes it: ground no car can reach, enclosed by
 * walls of kind `water_edge` (a creek's banks, a pond's shore). It is found, not drawn by hand:
 * the unreachable, non-solid regions that touch such a wall are water. Then it is painted by
 * depth from the shore: reedy shallows, clear water, dark deep water, with ripples that run with
 * the flow where an anchor of kind `water` gives one.
 */

export function findWater(env: Env, kinds: readonly string[] = ['water_edge']): number {
  const { maps, ctx } = env;
  const { w, h } = maps;
  const { drive, solid, solidId } = maps.reach;
  const wet = new Set<number>();
  ctx.def.walls.forEach((wall, k) => {
    if (kinds.includes(wall.kind)) wet.add(k + 1);
  });
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let total = 0;
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || drive[start] || solid[start]) continue;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    let touches = false;
    for (let head = 0; head < tail; head++) {
      const p = queue[head]!;
      const x = p % w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
      for (const q of nb) {
        if (q < 0 || q >= w * h) continue;
        if (solid[q]) {
          if (wet.has(solidId[q]!)) touches = true;
          continue;
        }
        if (seen[q] || drive[q]) continue;
        seen[q] = 1;
        queue[tail++] = q;
      }
    }
    if (!touches) continue;
    for (let k = 0; k < tail; k++) maps.water[queue[k]!] = 1;
    total += tail;
  }
  return total;
}

export type WaterStyle = {
  deep: Color;
  dark: Color;
  mid: Color;
  light: Color;
  shallow: Color;
  shallowLight: Color;
  glint: Color;
  spark: Color;
  foam: Color;
};

export const POND_WATER: WaterStyle = {
  deep: NAT.waterDeep,
  dark: NAT.waterDark,
  mid: NAT.water,
  light: NAT.waterLight,
  shallow: NAT.shallow,
  shallowLight: NAT.shallowLight,
  glint: NAT.waterGlint,
  spark: NAT.waterSpark,
  foam: NAT.foam,
};

/** Distance from the shore for every water pixel (0 on land). */
export function shoreDistance(env: Env): Float32Array {
  const { w, h, water } = env.maps;
  const land = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) land[i] = water[i] ? 0 : 1;
  return distanceField(land, w, h, 300);
}

/**
 * Paints the water. `flow` gives a unit direction of flow at a point (or null for still water),
 * which turns ripples into streaks along the current.
 */
export function paintWater(
  env: Env,
  style: WaterStyle,
  flow: (x: number, y: number) => { x: number; y: number } | null,
): Float32Array {
  const { maps, world } = env;
  const { w, h } = maps;
  const dist = shoreDistance(env);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!maps.water[i]) continue;
      const d = dist[i]! + (vnoise(x, y, 9, 61) - 0.5) * 6;
      let c: Color = d < 6 ? style.shallow : d < 14 ? style.light : d < 34 ? style.mid : d < 80 ? style.dark : style.deep;
      if (d < 3) c = style.shallowLight;
      const f = flow(x, y);
      // Ripples: short bright dashes, broken, aligned with the current where there is one.
      let u: number;
      let v: number;
      if (f) {
        u = x * f.x + y * f.y;
        v = -x * f.y + y * f.x;
      } else {
        u = x;
        v = y;
      }
      const row = Math.floor(v / 4);
      const len = f ? 7 : 9;
      const off = hash2(row, 5, 62) * 50;
      const cell = Math.floor((u + off) / (len * 3));
      const hh = hash2(cell, row, 63);
      const pos = u + off - cell * len * 3;
      if (((Math.floor(v) % 4) + 4) % 4 === 0 && pos < len * (0.5 + hash2(cell, row, 66) * 0.5) && hh < (f ? 0.3 : 0.12)) {
        c = d < 14 ? style.shallowLight : style.light;
        if (hh < 0.015) c = style.glint;
      }
      // Darker swirls in deep water.
      if (d > 34 && fbm(x, y, 40, 64) < 0.3) c = style.deep;
      put(world, i, c);
    }
  return dist;
}

/** Lily pads, in clusters near the shore of still water. */
export function lilyPads(env: Env, dist: Float32Array, seed: number, count: number): void {
  const { maps, world } = env;
  const { w, h } = maps;
  let placed = 0;
  for (let k = 0; k < count * 40 && placed < count; k++) {
    const x = Math.floor(hash2(k, 1, seed) * w);
    const y = Math.floor(hash2(k, 2, seed) * h);
    const i = y * w + x;
    if (!maps.water[i] || dist[i]! < 8 || dist[i]! > 46) continue;
    if (fbm(x, y, 120, seed + 5) < 0.5) continue;
    placed++;
    const pads = 3 + ((hash2(k, 3, seed) * 5) | 0);
    for (let j = 0; j < pads; j++) {
      const px = x + Math.round((hash2(k, j * 2 + 10, seed) - 0.5) * 22);
      const py = y + Math.round((hash2(k, j * 2 + 11, seed) - 0.5) * 14);
      const r = 2 + hash2(k, j + 30, seed) * 2.2;
      const notch = hash2(k, j + 40, seed) * Math.PI * 2;
      for (let yy = Math.floor(py - r); yy <= py + r; yy++)
        for (let xx = Math.floor(px - r); xx <= px + r; xx++) {
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || !maps.water[yy * w + xx]) continue;
          const dx = xx - px;
          const dy = (yy - py) * 1.3;
          if (dx * dx + dy * dy > r * r) continue;
          const a = Math.atan2(dy, dx);
          if (Math.abs(((a - notch + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.35) continue;
          put(world, yy * w + xx, dx + dy < -1 ? NAT.lilyLight : NAT.lily);
        }
      if (hash2(k, j + 50, seed) < 0.25) {
        put(world, py * w + px, NAT.lilyFlower);
        put(world, py * w + px + 1, NAT.flowerWhite);
      }
    }
  }
}

/** Shore of the banks: a dark wet line where water meets the bank wall. */
/**
 * The visible shore: inside the water (where no car can go anyway) a band of varying width of
 * mud flat, rushes and overhanging grass, so a straight wall reads as a natural bank.
 */
export function paintShore(env: Env, dist: Float32Array, seed: number, maxWidth = 40): void {
  const { maps, world } = env;
  const { w, h } = maps;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!maps.water[i]) continue;
      const d = dist[i]!;
      if (d > maxWidth + 4) continue;
      const f0 = fbm(x, y, 70, seed);
      const band = 3 + Math.max(0, f0 - 0.3) * 1.8 * maxWidth;
      if (d > band) {
        if (d < band + 1.5) put(world, i, NAT.waterDark);
        continue;
      }
      const t = d / band;
      const hh = hash2(x >> 1, y, seed + 1);
      let c: Color;
      if (t < 0.35) c = hh < 0.5 ? NAT.mossDark : NAT.moss;
      else {
        // Rushes: short upright strokes, lit tips.
        const col = hash2(x, Math.floor(y / 5), seed + 2);
        const ly = y % 5;
        if (col < 0.45) c = ly === 0 ? NAT.reedLight : ly < 3 ? NAT.reed : NAT.reedDark;
        else c = t > 0.85 ? NAT.soilDark : hh < 0.3 ? NAT.soil : NAT.mossDeep;
      }
      put(world, i, c);
    }
}

export function wetEdge(env: Env): void {
  const { maps, world } = env;
  const { w, h } = maps;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!maps.water[i]) continue;
      if (!maps.water[i - 1] || !maps.water[i + 1] || !maps.water[i - w] || !maps.water[i + w]) {
        const c = getc(world, i);
        put(world, i, c === NAT.shallowLight ? NAT.shallow : NAT.waterDark);
      }
    }
}

/**
 * Reflections: the woods on a north shore and anything standing in the water show upside
 * down below them, as a darker, greener band on the water south of the shore.
 */
export function shoreReflections(env: Env, seed: number, tint: Color): void {
  const { maps, world } = env;
  const { w, h } = maps;
  for (let x = 0; x < w; x++) {
    let run = -1;
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      if (!maps.water[i]) {
        run = -1;
        continue;
      }
      if (run < 0) run = 0;
      run++;
      const reach = 14 + fbm(x, 0, 30, seed) * 26;
      if (run > reach) continue;
      if (run > reach - 3 && hash2(x, y, seed + 1) < 0.5) continue;
      const c = getc(world, i);
      if (c === NAT.waterGlint || c === NAT.lily || c === NAT.lilyLight) continue;
      put(world, i, tint);
    }
  }
}
