import { hash2 } from '@bolt/shared';
import type { Color } from '../canvas.js';
import type { Env } from '../forest/env.js';
import { getc, put } from '../forest/env.js';
import { K_OFF, K_PAVE } from '../forest/maps.js';
import { fbm, vnoise } from '../forest/noise.js';
import { SURF, iceAt } from '../forest/road.js';
import { SNOW, SNOW_ROAD } from './palette.js';

/**
 * The snowfield and the frozen pond off the road. Powder lies in long soft drifts shaped by the
 * wind, with wind ripples and a scatter of sparkle; the plow's spray lies along the verge. The
 * pond is ice wherever the physics says so (road, shoulder and ground alike): frosted off the
 * racing line, scraped dark and clear on it, with cracks and skate marks.
 */

const SEED = 7701;
const q = (v: number): number => v >> 1;

function powder(
  x: number,
  y: number,
  d: number,
  windX: number,
  windY: number,
  fresh: number,
): Color {
  const big = fbm(x, y, 190, SEED);
  let c: Color = big < 0.4 ? SNOW.powderMid : big > 0.63 ? SNOW.powderHi : SNOW.powder;
  // Drifts: long, low ridges laid along the wind, a soft shadow on their lee side.
  const wl = Math.hypot(windX, windY) || 1;
  const ux = windX / wl;
  const uy = windY / wl;
  const along = x * ux + y * uy;
  const across = -x * uy + y * ux;
  const drift = vnoise(along / 5, across, 20, SEED + 1);
  if (drift > 0.8 - fresh * 0.04) c = SNOW.drift;
  else if (drift > 0.74) c = c === SNOW.powderHi ? SNOW.powder : SNOW.powderMid;
  // Wind ripples: thin broken lines across the wind, gone under fresh snow.
  if (fresh < 0.5) {
    const rip = (((along / 6 + vnoise(along, across, 14, SEED + 2) * 1.5) % 1) + 1) % 1;
    if (
      rip < 0.08 &&
      vnoise(x, y, 60, SEED + 3) > 0.7 &&
      vnoise(across, along / 8, 3, SEED + 7) > 0.5
    )
      c = c === SNOW.powderHi ? SNOW.powder : SNOW.powderMid;
  }
  const h = hash2(x, y, SEED + 4);
  if (h < 0.003) c = SNOW.sparkle;
  // The plow's spray along the verge: chunkier, a little grayer.
  if (d < 16) {
    const t = d / 16 + (vnoise(x, y, 5, SEED + 5) - 0.5) * 0.5;
    if (t < 0.5) {
      const hh = hash2(q(x), q(y), SEED + 6);
      c = hh < 0.25 ? SNOW.powderShade : hh < 0.65 ? SNOW.powderMid : SNOW.powderHi;
    }
  }
  return c;
}

export function paintSnowField(env: Env, fresh: number): void {
  const { maps, world, ctx } = env;
  const { w, h } = maps;
  const wx = ctx.preset.windX || 10;
  const wy = ctx.preset.windY;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (maps.kind[i] !== K_OFF) continue;
      const jx = Math.round(
        (vnoise(x, y, 26, SEED + 81) - 0.5) * 11 + (vnoise(x, y, 6, SEED + 81 + 2) - 0.5) * 3,
      );
      const jy = Math.round(
        (vnoise(x, y, 26, SEED + 82) - 0.5) * 11 + (vnoise(x, y, 6, SEED + 82 + 2) - 0.5) * 3,
      );
      const j = Math.min(h - 1, Math.max(0, y + jy)) * w + Math.min(w - 1, Math.max(0, x + jx));
      const s = maps.kind[j] === K_OFF ? maps.surf[j]! : maps.surf[i]!;
      if (s === SURF.ice) put(world, i, pondIce(x, y));
      else put(world, i, powder(x, y, maps.roadDist[i]!, wx, wy, fresh));
    }
}

/** Off the racing line the ice is frosted and lighter; snow-snakes streak it with the wind. */
function pondIce(x: number, y: number): Color {
  let c = iceAt(x, y, SNOW_ROAD);
  // Frost off the racing line: a lighter skin, and snow-snakes blown across it.
  // Off the racing line the ice wears a lighter frost skin.
  if (c === SNOW.ice) c = SNOW.iceLight;
  else if (c === SNOW.iceDark && fbm(x, y, 80, SEED + 11) > 0.5) c = SNOW.ice;
  const sn = vnoise(x / 6, y, 5, SEED + 12);
  if (sn > 0.8 && vnoise(x, y, 70, SEED + 13) > 0.5) c = SNOW.iceSnow;
  return c;
}

/**
 * The racing line across the pond is scraped clear: darker, glassier ice on the pavement, and a
 * broken edge of chipped ice where it meets the frost, so the road stays readable on ice.
 */
export function scrapeIceRoad(env: Env): void {
  const { maps, world, ctx } = env;
  const { w, h } = maps;
  const { field } = ctx;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (maps.surf[i] !== SURF.ice || maps.kind[i] === K_OFF) continue;
      const sh = ctx.track.branches[field.branch[i]!]!.shoulder[field.sample[i]!]!;
      const k = field.edge[i]! + sh;
      const c = getc(world, i);
      if (maps.kind[i] === K_PAVE) {
        if (k > -3 && hash2(x >> 1, y >> 1, SEED + 21) < 0.65) put(world, i, SNOW.iceSnow);
        else if (c === SNOW.iceLight) put(world, i, SNOW.ice);
        // Scraped clear on the racing line: mostly the dark glassy tone, in broad fields, so the
        // ice under the wheels reads apart from packed snow in falling snow too (its grade
        // lifts and desaturates everything).
        else if (c === SNOW.ice && fbm(x, y, 120, SEED + 24) < 0.62) put(world, i, SNOW.iceDark);
      } else if (k < 3 && hash2(x >> 1, y >> 1, SEED + 23) < 0.45) put(world, i, SNOW.iceStreak);
    }
}

/** Crack networks radiating from a point on the ice: dark lines with a white lip. */
export function iceCracks(env: Env, cx: number, cy: number, seed: number, arms = 7): void {
  const { maps, world } = env;
  const { w } = maps;
  const draw = (x0: number, y0: number, ang: number, len: number, depth: number): void => {
    let x = x0;
    let y = y0;
    for (let t = 0; t < len; t++) {
      ang += (hash2(Math.round(x), Math.round(y), seed) - 0.5) * 0.5;
      x += Math.cos(ang);
      y += Math.sin(ang);
      const px = Math.round(x);
      const py = Math.round(y);
      const i = py * w + px;
      if (px < 1 || py < 1 || px >= w - 1 || py >= maps.h - 1 || maps.surf[i] !== SURF.ice) return;
      put(world, i, SNOW.iceCrack);
      if (maps.surf[i - w] === SURF.ice) put(world, i - w, SNOW.iceStreak);
      if (depth < 2 && hash2(px, py, seed + 1) < 0.05)
        draw(x, y, ang + (hash2(px, py, seed + 2) < 0.5 ? 0.9 : -0.9), len * 0.5, depth + 1);
    }
  };
  for (let k = 0; k < arms; k++)
    draw(cx, cy, (k / arms) * Math.PI * 2 + hash2(k, 0, seed), 60 + hash2(k, 1, seed) * 90, 0);
}

/** Skate marks: long looping pale curves on the frosted ice off the road. */
export function skateMarks(env: Env, cx: number, cy: number, seed: number): void {
  const { maps, world } = env;
  for (let k = 0; k < 5; k++) {
    const r = 30 + hash2(k, 1, seed) * 60;
    const ox = cx + (hash2(k, 2, seed) - 0.5) * 220;
    const oy = cy + (hash2(k, 3, seed) - 0.5) * 120;
    for (let a = 0; a < Math.PI * 1.6; a += 0.5 / r) {
      const px = Math.round(ox + Math.cos(a + k) * r * 1.6);
      const py = Math.round(oy + Math.sin(a + k) * r * 0.7);
      if (px < 0 || py < 0 || px >= maps.w || py >= maps.h) continue;
      const i = py * maps.w + px;
      if (maps.surf[i] !== SURF.ice || maps.kind[i] !== K_OFF) continue;
      put(world, i, SNOW.iceLight);
    }
  }
}
