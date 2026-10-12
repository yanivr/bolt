import { hash2 } from '@bolt/shared';
import type { Color } from '../canvas.js';
import type { Env } from './env.js';
import { put } from './env.js';
import { K_OFF } from './maps.js';
import { fbm, vnoise } from './noise.js';
import { NAT } from './palette.js';
import { FOREST_ROAD, SURF } from './road.js';
import type { RoadPalette } from './road.js';

/**
 * The forest floor: everything off the road. Moss in broad soft patches, drifts of leaf litter,
 * grass where the canopy opens, fern beds in the shade, a trampled earth margin along the
 * verge, and puddles in the hollows when it rains. All of it is flat ground: a car may drive
 * here, so nothing painted here stands up. Texture comes in clusters of at least two pixels,
 * which is what keeps a chunk small.
 */

const SEED = 5501;
const q = (v: number): number => v >> 1;

export type FloorStyle = {
  /** 0 to 1: how much of the floor is leaf litter rather than moss. */
  litter: number;
  /** 0 to 1: fern density in the shade. */
  ferns: number;
  /** Sawdust and bark chips (the logging track). */
  sawdust?: (x: number, y: number) => number;
};

function floorTone(x: number, y: number, style: FloorStyle, d: number, wet: number): Color {
  const m = fbm(x, y, 70, SEED);
  const l = fbm(x + 900, y - 300, 120, SEED + 1);
  const h = hash2(q(x + (q(y) & 1)), q(y), SEED + 2);
  // Leaf litter drifts, close in value to the moss so the floor stays quiet.
  if (l < 0.14 + style.litter * 0.2) {
    let c: Color = l < 0.08 + style.litter * 0.18 ? NAT.litter : NAT.litterDark;
    if (h < 0.05) c = NAT.litterLight;
    else if (h > 0.985) c = h > 0.993 ? NAT.leafGold : NAT.leafRed;
    else if (l > 0.11 + style.litter * 0.2 && h > 0.5) c = NAT.mossDark;
    return c;
  }
  // Moss.
  let c: Color = m < 0.38 ? NAT.mossDark : m > 0.64 ? NAT.mossLight : NAT.moss;
  if (m < 0.26) c = NAT.mossDeep;
  if (h < 0.02) c = NAT.mossDark;
  else if (h > 0.988) c = m > 0.55 ? NAT.mossHi : NAT.mossLight;
  // Grass tufts where the woods open up: little upright V shapes.
  const g = vnoise(x, y, 140, SEED + 3);
  if (g > 0.62) {
    const cx = Math.floor(x / 5);
    const cy = Math.floor(y / 4);
    const th = hash2(cx, cy, SEED + 6);
    if (th < (g - 0.62) * 1.1) {
      const lx = x - cx * 5;
      const ly = y - cy * 4;
      if ((ly === 0 && (lx === 0 || lx === 2)) || (ly === 1 && lx === 1)) return NAT.grassLight;
      if (ly === 2 && lx === 1) return NAT.grass;
    }
  }
  // A trampled margin along the verge.
  if (d < 10) {
    const t = d / 10 + (vnoise(x, y, 6, SEED + 4) - 0.5) * 0.6;
    if (t < 0.45) return h < 0.4 ? NAT.soil : NAT.litterDark;
    if (t < 0.75 && h < 0.4) return NAT.litter;
  }
  // Puddles in hollows when wet.
  if (wet > 0.3) {
    const pn = fbm(x, y, 34, SEED + 5);
    if (pn < 0.08 + wet * 0.08)
      return pn > 0.065 + wet * 0.08 ? NAT.soilDark : (x + q(y)) % 7 === 0 ? NAT.mudSheen : NAT.mudWater;
  }
  return c;
}

/** Flat fern fronds: a spine and alternating leaflets, lit on the upper left. */
function frond(env: Env, x0: number, y0: number, ang: number, len: number, seed: number): void {
  const { world, maps } = env;
  const { w, h } = maps;
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  for (let t = 0; t < len; t += 0.7) {
    const x = Math.round(x0 + dx * t);
    const y = Math.round(y0 + dy * t);
    const spine = (px: number, py: number, c: Color): void => {
      if (px < 0 || py < 0 || px >= w || py >= h) return;
      const i = py * w + px;
      if (maps.kind[i] !== K_OFF || maps.water[i] || maps.reach.solid[i]) return;
      put(world, i, c);
    };
    spine(x, y, NAT.fernDark);
    const leaf = Math.max(1, Math.round((1 - t / len) * 5 * (0.7 + hash2(seed, t | 0, 9) * 0.5)));
    if (Math.round(t) % 2 === 0) {
      for (const side of [-1, 1]) {
        for (let k = 1; k <= leaf; k++) {
          const lx = Math.round(x - dy * side * k + dx * k * 0.4);
          const ly = Math.round(y + dx * side * k + dy * k * 0.4);
          // Light from the upper left: leaflets on that side are lit.
          const lit = -dy * side - dx * 0.2 + (dx * side - dy * 0.2) < 0;
          spine(lx, ly, k === leaf ? NAT.fernDark : lit ? (k < 2 ? NAT.fernHi : NAT.fernLight) : NAT.fern);
        }
      }
    }
  }
}

function fernBed(env: Env, cx: number, cy: number, seed: number): void {
  const n = 5 + ((hash2(cx, cy, seed) * 4) | 0);
  const a0 = hash2(cx, cy, seed + 1) * Math.PI * 2;
  for (let k = 0; k < n; k++) {
    const a = a0 + (k / n) * Math.PI * 2 + (hash2(k, cx, seed + 2) - 0.5) * 0.5;
    frond(env, cx, cy, a, 13 + hash2(k, cy, seed + 3) * 9, seed + k);
  }
}

/** Paints all off-road ground. Zones laid over the ground (mud, ice) are drawn as themselves. */
export function paintForestFloor(env: Env, style: FloorStyle, pal: RoadPalette = FOREST_ROAD): void {
  const { maps, world } = env;
  const { w, h } = maps;
  const offSurf = maps.surf;
  const offroad = SURF.dirt;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (maps.kind[i] !== K_OFF || maps.water[i]) continue;
      // The zone's surface, read a few pixels off so its 8 px cells never show as steps.
      const jx = Math.round((vnoise(x, y, 26, SEED + 81) - 0.5) * 11 + (vnoise(x, y, 6, SEED + 81 + 2) - 0.5) * 3);
      const jy = Math.round((vnoise(x, y, 26, SEED + 82) - 0.5) * 11 + (vnoise(x, y, 6, SEED + 82 + 2) - 0.5) * 3);
      const j = Math.min(h - 1, Math.max(0, y + jy)) * w + Math.min(w - 1, Math.max(0, x + jx));
      const s = maps.kind[j] === K_OFF ? offSurf[j]! : offSurf[i]!;
      let c: Color;
      if (s === SURF.mud && s !== offroad) {
        const n = fbm(x, y, 18, SEED + 11);
        c = n < 0.35 ? pal.mud[0]! : n < 0.6 ? pal.mud[1]! : n > 0.85 ? pal.mud[3]! : pal.mud[2]!;
        if (n < 0.24 + env.wet * 0.1) c = (x + q(y)) % 8 === 0 ? pal.mudSheen : pal.mudWater;
      } else c = floorTone(x, y, style, maps.roadDist[i]!, env.wet);
      if (style.sawdust) {
        const sd = style.sawdust(x, y);
        if (sd > 0) {
          const hh = hash2(q(x), q(y), SEED + 12);
          if (hh < sd) c = hh < sd * 0.3 ? NAT.sawdustDark : hh < sd * 0.8 ? NAT.sawdust : NAT.sawdustLight;
        }
      }
      put(world, i, c);
    }
  // Fern beds in the shade of the woods, away from the verge.
  const step = 46;
  for (let gy = 0; gy < h; gy += step)
    for (let gx = 0; gx < w; gx += step) {
      const x = gx + ((hash2(gx, gy, SEED + 20) * step) | 0);
      const y = gy + ((hash2(gx, gy, SEED + 21) * step) | 0);
      if (x >= w || y >= h) continue;
      const i = y * w + x;
      if (maps.kind[i] !== K_OFF || maps.roadDist[i]! < 20 || maps.water[i]) continue;
      const dens = vnoise(x, y, 160, SEED + 22);
      if (hash2(gx, gy, SEED + 23) > style.ferns * (0.3 + dens)) continue;
      fernBed(env, x, y, SEED + gx * 7 + gy);
    }
}

/**
 * Low shrubs and bracken seen from above: a cluster of leafy clumps lit from the upper left,
 * painted flat into the ground. They are soft cover a car can push through, so they have no
 * height and no collision; what reads as volume is shading only.
 */
const DEFAULT_SHRUB: readonly Color[] = [NAT.mossDeep, NAT.fernDark, NAT.fern, NAT.fernLight, NAT.fernHi];
const SHRUBS: ReadonlyArray<readonly Color[]> = [
  DEFAULT_SHRUB,
  [0x16302a, 0x1e4232, 0x2a5838, 0x3a7040, 0x548a48],
  [0x2a2e1c, 0x3e4426, 0x56602e, 0x707a38, 0x8e9446],
];

export function paintShrubs(env: Env, seed: number, density: number, ramp: readonly Color[] = DEFAULT_SHRUB): number {
  const { maps, world } = env;
  const { w, h } = maps;
  const step = 30;
  let n = 0;
  for (let gy = 0; gy < h; gy += step)
    for (let gx = 0; gx < w; gx += step) {
      const cx = gx + ((hash2(gx, gy, seed) * step) | 0);
      const cy = gy + ((hash2(gx, gy, seed + 1) * step) | 0);
      if (cx >= w || cy >= h) continue;
      const ci = cy * w + cx;
      if (maps.kind[ci] !== K_OFF || maps.water[ci] || maps.roadDist[ci]! < 28) continue;
      const thicket = vnoise(cx, cy, 260, seed + 3);
      if (thicket < 0.45 || hash2(gx, gy, seed + 2) > density * (thicket - 0.3) * 2.2) continue;
      n++;
      const clumps = 4 + ((hash2(gx, gy, seed + 4) * 7) | 0);
      const R = 4 + hash2(gx, gy, seed + 5) * 6;
      const palette = SHRUBS[Math.floor(hash2(gx, gy, seed + 11) * SHRUBS.length)]!;
      const pts: Array<[number, number, number]> = [];
      for (let k = 0; k < clumps; k++) {
        const a = hash2(k, gx, seed + 6) * Math.PI * 2;
        const d = hash2(k, gy, seed + 7) * R * 1.4;
        pts.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, R * (0.5 + hash2(k, cx, seed + 8) * 0.5)]);
      }
      // Shadow first, offset down-sun, then the clumps from back to front.
      for (const [px, py, r] of pts)
        for (let y = Math.floor(py - r); y <= py + r + 3; y++)
          for (let x = Math.floor(px - r); x <= px + r + 3; x++) {
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            if ((x - px - 2.5) ** 2 + (y - py - 2.5) ** 2 > r * r) continue;
            const i = y * w + x;
            if (maps.kind[i] !== K_OFF || maps.water[i]) continue;
            if (env.shadow[i]! < 1) env.shadow[i] = 1;
          }
      pts.sort((a, b) => a[1] - b[1]);
      for (const [px, py, r] of pts)
        for (let y = Math.floor(py - r); y <= py + r; y++)
          for (let x = Math.floor(px - r); x <= px + r; x++) {
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            const dx = x - px;
            const dy = y - py;
            const dd = dx * dx + dy * dy;
            const rr = r * (0.82 + vnoise(x, y, 3, seed + 10) * 0.36);
            if (dd > rr * rr) continue;
            const i = y * w + x;
            if (maps.kind[i] !== K_OFF || maps.water[i]) continue;
            const lit = (-dx - dy) / (r * 1.4) + 0.5 + (hash2(x >> 1, y >> 1, seed + 9) - 0.5) * 0.35;
            const k = dd > (rr - 1.2) * (rr - 1.2) && dx + dy > 0 ? 0 : lit > 0.85 ? 4 : lit > 0.55 ? 3 : lit > 0.25 ? 2 : 1;
            put(world, i, (ramp === DEFAULT_SHRUB ? palette : ramp)[k]!);
          }
    }
  return n;
}

/** Shafts of sun on the floor where the canopy opens: long ovals lying along the light. */
export function paintSunShafts(env: Env, seed: number, count: number): void {
  const { maps } = env;
  const { w, h } = maps;
  for (let k = 0; k < count; k++) {
    const cx = hash2(k, 1, seed) * w;
    const cy = hash2(k, 2, seed) * h;
    const L = 30 + hash2(k, 3, seed) * 50;
    const W = 7 + hash2(k, 4, seed) * 9;
    for (let y = Math.floor(cy - L); y <= cy + L; y++)
      for (let x = Math.floor(cx - L); x <= cx + L; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const u = ((x - cx) + (y - cy)) / Math.SQRT2;
        const v = ((x - cx) - (y - cy)) / Math.SQRT2;
        if ((u / L) ** 2 + (v / W) ** 2 > 1) continue;
        env.sun[y * w + x] = 1;
      }
  }
}
