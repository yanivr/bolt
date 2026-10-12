import { SURFACE_IDS, hash2 } from '@bolt/shared';
import type { SurfaceId } from '@bolt/shared';
import type { Color } from '../canvas.js';
import { F_NOSHADOW } from '../canvas.js';
import { FAR } from '../field.js';
import type { Env } from './env.js';
import { put } from './env.js';
import { K_PAVE, K_SHOULDER } from './maps.js';
import { fbm, vnoise } from './noise.js';
import { NAT } from './palette.js';

/**
 * The stage on an open track: pavement, its verge, and the ground the zones lay over both, all
 * evaluated per pixel from the same maps the physics reads. Each surface has one unmistakable
 * look, because the surface decides the tire: dark slate asphalt with white edge lines, pale
 * compacted dirt with two worn ruts, near-black glossy mud with standing water, packed snow with
 * blue tire grooves, and pale cyan ice with white streaks. A zone's border is drawn where the
 * physics puts it, roughened by at most four pixels so an 8 px zone cell never reads as a block.
 */

export type RoadPalette = {
  asphalt: readonly Color[]; // deep, dark, base, light, speck
  line: Color;
  lineWorn: Color;
  center: Color | null;
  centerWorn: Color;
  dirt: readonly Color[]; // deep, dark, base, light, hi
  pebble: Color;
  pebbleDark: Color;
  mud: readonly Color[]; // deep, dark, base, light, ridge
  mudWater: Color;
  mudSheen: Color;
  mudGlint: Color;
  /** Verge beside a paved road, outer to inner. */
  verge: readonly Color[];
  snow: readonly Color[]; // groove, dark, base, light, hi
  ice: readonly Color[]; // deep, dark, base, light, streak, crack
  /** Ground tone the verge fades into (for the ragged edge). */
  edgeGround: (x: number, y: number) => Color;
};

export const FOREST_ROAD: RoadPalette = {
  asphalt: [NAT.asphaltDeep, NAT.asphaltDark, NAT.asphalt, NAT.asphaltLight, NAT.asphaltSpeck],
  line: NAT.lineWhite,
  lineWorn: NAT.lineWorn,
  center: NAT.lineYellow,
  centerWorn: NAT.lineYellowWorn,
  dirt: [NAT.dirtDeep, NAT.dirtDark, NAT.dirt, NAT.dirtLight, NAT.dirtHi],
  pebble: NAT.pebble,
  pebbleDark: NAT.pebbleDark,
  mud: [NAT.mudDeep, NAT.mudDark, NAT.mud, NAT.mudLight, NAT.mudRidge],
  mudWater: NAT.mudWater,
  mudSheen: NAT.mudSheen,
  mudGlint: NAT.mudGlint,
  verge: [NAT.gravelDark, NAT.gravel, NAT.gravelLight],
  snow: [0x8e9ab8, 0xb4bed2, 0xcfd6e2, 0xe2e8f0, 0xf2f6fa],
  ice: [0x4c86ae, 0x6aa6c8, 0x8cc4dc, 0xaad8e8, 0xeefaff, 0x3c6c92],
  edgeGround: () => NAT.moss,
};

const S_ASPHALT = SURFACE_IDS.indexOf('asphalt');
const S_DIRT = SURFACE_IDS.indexOf('dirt');
const S_MUD = SURFACE_IDS.indexOf('mud');
const S_SNOW = SURFACE_IDS.indexOf('snow');
const S_ICE = SURFACE_IDS.indexOf('ice');

export type RoadPx = {
  x: number;
  y: number;
  i: number;
  /** Signed offset from the centerline, distance along, half width, and depth past the
   * pavement edge (negative inside the pavement). */
  lat: number;
  s: number;
  hw: number;
  k: number;
  branch: number;
  main: boolean;
};

const SEED = 4401;

/** 2 x 2 clusters: the texture unit of every road surface. */
const q = (v: number): number => v >> 1;

function asphaltPx(p: RoadPx, pal: RoadPalette, env: Env): Color {
  const { x, y } = p;
  const a = pal.asphalt;
  const h1 = hash2(q(x + (q(y) & 1)), q(y), SEED);
  let c = a[2]!;
  const blot = fbm(x, y, 40, SEED + 9);
  if (blot < 0.34) c = a[1]!;
  if (h1 < 0.1) c = a[1]!;
  else if (h1 > 0.9) c = a[3]!;
  if (hash2(x, y, SEED + 2) < 0.006) c = a[4]!;
  // Tire polish along the two wheel lines of each lane.
  const lane = Math.abs(p.lat) - p.hw * 0.5;
  if (Math.abs(Math.abs(lane) - p.hw * 0.22) < 4 && hash2(q(x), y, SEED + 5) < 0.45) c = a[1]!;
  // Wet road: darker, with a broken sheen where the camber collects water.
  if (env.wet > 0.4) {
    const n = fbm(x, y * 1.6, 26, SEED + 13);
    if (n < 0.28 + env.wet * 0.12) c = a[0]!;
    else if (n > 0.8 - env.wet * 0.06 && ((x + y) & 3) === 0) c = a[3]!;
  }
  if (p.main) {
    // White edge lines inset from the edge.
    if (p.k >= -8 && p.k < -5.5) return hash2(q(x), q(y), SEED + 6) < 0.18 ? pal.lineWorn : pal.line;
    // Yellow center dashes.
    if (pal.center !== null && Math.abs(p.lat) < 1.6 && p.s % 44 < 22)
      return hash2(q(x), q(y), SEED + 7) < 0.16 ? pal.centerWorn : pal.center;
  }
  // The outer lip of the pavement crumbles into the verge.
  if (p.k > -2.2) return a[0]!;
  return c;
}

function dirtPx(p: RoadPx, pal: RoadPalette, env: Env, mudBias = 0): Color {
  const { x, y } = p;
  // A boggy patch (a drag hazard on dirt): darker, churned and wet, but still dirt.
  const boggy = mudBias < 0;
  const d = boggy ? [pal.dirt[0]!, pal.dirt[0]!, pal.dirt[1]!, pal.dirt[2]!, pal.dirt[3]!] : pal.dirt;
  const n = fbm(x, y, 34, SEED + 21);
  let c = n < 0.38 ? d[1]! : n > 0.65 ? d[3]! : d[2]!;
  const h = hash2(q(x + (q(y) & 1)), q(y), SEED + 22);
  if (h < 0.08) c = d[1]!;
  else if (h > 0.95) c = d[3]!;
  // Worn wheel tracks: broad, soft, one step darker, coming and going along the road.
  const u = Math.abs(p.lat);
  const wob = (vnoise(p.s, 0, 26, SEED + 23) - 0.5) * 8;
  const rut = Math.min(Math.abs(u - p.hw * 0.25 - wob), Math.abs(u - p.hw * 0.62 - wob));
  const worn = vnoise(p.s, u > p.hw * 0.43 ? 1 : 0, 60, SEED + 28);
  const edge = (vnoise(x, y, 4, SEED + 29) - 0.5) * 3;
  if (rut + edge < 5 && worn > 0.35) c = c === d[3]! ? d[2]! : d[1]!;
  // Puddles in the tracks when wet, and in a boggy patch.
  if (rut < (boggy ? 7 : 4.5) && env.wet + (boggy ? 0.5 : 0) > 0.05) {
    const pn = fbm(x, y, 22, SEED + 25);
    const lim = 0.12 + (env.wet + (boggy ? 0.4 : 0)) * 0.18;
    if (pn < lim) return pn > lim - 0.03 ? pal.mud[1]! : hash2(x >> 2, y, SEED + 30) > 0.9 ? pal.mudSheen : pal.mudWater;
  }
  // Pebbles.
  const ph = hash2(x, y, SEED + 26);
  if (ph < 0.01) return pal.pebble;
  if (ph > 0.993) return pal.pebbleDark;
  if (p.k > -3 && hash2(q(x), q(y), SEED + 27) < 0.4) return d[1]!;
  return c;
}

function mudPx(p: RoadPx, pal: RoadPalette, env: Env, deep: boolean): Color {
  const { x, y } = p;
  const m = pal.mud;
  // A smooth, dark, wet base: broad tonal swells, no stones.
  const n = fbm(x, y, 24, SEED + 31);
  let c: Color = n < 0.36 ? m[1]! : n > 0.64 ? m[3]! : m[2]!;
  if (hash2(q(x), q(y), SEED + 37) < 0.06) c = m[1]!;
  // Wheel ruts: low, dark troughs that wander, each with a glossy lip on its lit side.
  const u = Math.abs(p.lat);
  const side = p.lat < 0 ? -1 : 1;
  const wob = (vnoise(p.s, 3, 34, SEED + 32) - 0.5) * 12;
  let best = 99;
  let signed = 0;
  for (const at of [p.hw * 0.24, p.hw * 0.64]) {
    const dd = u - at - wob;
    if (Math.abs(dd) < Math.abs(best)) {
      best = dd;
      signed = dd * side;
    }
  }
  const ab = Math.abs(best);
  const rutW = deep ? 7 : 5.5;
  const wn = fbm(x, y, 20, SEED + 33);
  if (ab < rutW) {
    c = ab < rutW - 2 ? m[0]! : m[1]!;
    if (wn < (deep ? 0.55 : 0.38) + env.wet * 0.18 && ab < rutW - 1.5) {
      if (hash2(q(x), y, SEED + 34) > 0.97) return pal.mudGlint;
      return hash2(x >> 2, y, SEED + 39) > 0.86 ? pal.mudSheen : pal.mudWater;
    }
  } else if (ab < rutW + 1.6 && signed < 0 && hash2(x >> 1, y, SEED + 40) < 0.18 + env.wet * 0.3) {
    c = pal.mudSheen;
  }
  // Pools between the ruts in deep mud and in the wet.
  const pn = fbm(x + 300, y, 30, SEED + 38);
  const pool = (deep ? 0.24 : 0.09) + env.wet * 0.08;
  if (pn < pool) return pn > pool - 0.03 ? m[0]! : hash2(x >> 2, y, SEED + 39) > 0.9 ? pal.mudSheen : pal.mudWater;
  // A few clods thrown up by wheels.
  if (hash2(x >> 1, y >> 1, SEED + 36) < 0.012) return m[4]!;
  if (p.k > -2.5) return m[0]!;
  return c;
}

function snowPx(p: RoadPx, pal: RoadPalette, deep: boolean): Color {
  const { x, y } = p;
  const s = pal.snow;
  const n = fbm(x, y, 34, SEED + 41);
  let c = n < 0.4 ? s[2]! : n > 0.72 ? s[3]! : s[2]!;
  const h = hash2(q(x + (q(y) & 1)), q(y), SEED + 42);
  if (h < 0.08) c = s[1]!;
  else if (h > 0.9) c = s[3]!;
  // Tire grooves: pairs of blue lines running with the road.
  const u = Math.abs(p.lat);
  const wob = (vnoise(p.s, 1, 30, SEED + 43) - 0.5) * 5;
  for (const at of [p.hw * 0.22, p.hw * 0.36, p.hw * 0.58, p.hw * 0.72]) {
    const g = Math.abs(u - at - wob);
    if (g < 1.3) return deep ? s[1]! : s[0]!;
    if (g < 2.4) c = s[1]!;
  }
  if (deep) {
    // Soft snow: lumpy, with deep sink marks.
    const lump = vnoise(x, y, 7, SEED + 44);
    if (lump > 0.72) return s[4]!;
    if (lump < 0.22) return s[1]!;
  }
  if (p.k > -3) return s[1]!;
  return c;
}

function icePx(p: RoadPx, pal: RoadPalette, onRoad: boolean): Color {
  const { x, y } = p;
  const ice = pal.ice;
  // Glassy: broad, smooth tonal fields, darker where the ice is clear and deep.
  // Mostly one clear tone; darker black ice in a few wide, slow swirls.
  let c = ice[2]!;
  const deep = fbm(x + 700, y, 160, SEED + 52);
  if (deep < 0.3) c = ice[1]!;
  else if (deep < 0.33 && ((x + y) & 1) === 0) c = ice[1]!;
  // Glare: short hard streaks in a few bright patches, all at one angle, the sheen that says
  // slippery. Elsewhere only the odd glint.
  const glare = fbm(x, y, 90, SEED + 53);
  const u = x + y * 0.35;
  const row = Math.floor((y - x * 0.35) / 4);
  const dash = Math.floor((u + hash2(row, 1, SEED + 54) * 30) / 9);
  const inDash = (u + hash2(row, 1, SEED + 54) * 30) % 9 < 5;
  if (((y - x * 0.35) % 4 + 4) % 4 < 1 && inDash) {
    const hh = hash2(dash, row, SEED + 55);
    if ((glare > 0.66 && hh < 0.55) || hh < 0.012) return ice[4]!;
  }
  if (glare > 0.7 && c === ice[2]!) c = ice[3]!;
  // Tire marks along the racing line on the pond.
  if (onRoad) {
    const g = Math.abs(Math.abs(p.lat) - p.hw * 0.4 - (vnoise(p.s, 2, 40, SEED + 56) - 0.5) * 8);
    if (g < 0.9 && hash2(q(x), y, SEED + 57) < 0.6) return ice[1]!;
  }
  return c;
}

/** Ice anywhere (the frozen pond is ice off the road too), for the ground painter. */
export function iceAt(x: number, y: number, pal: RoadPalette): Color {
  return icePx({ x, y, i: 0, lat: 0, s: 0, hw: 60, k: -30, branch: 0, main: false }, pal, false);
}

function vergePx(p: RoadPx, pal: RoadPalette, env: Env, sh: number, roadSurf: number): Color {
  const { x, y } = p;
  const t = p.k / sh; // 0 at the pavement edge, 1 at the shoulder's outer edge
  const v = pal.verge;
  const ragged = (vnoise(x, y, 5, SEED + 61) - 0.5) * 0.5;
  if (t + ragged > 0.92) return pal.edgeGround(x, y);
  const h = hash2(q(x), q(y), SEED + 62);
  let c = h < 0.3 ? v[0]! : h > 0.7 ? v[2]! : v[1]!;
  if (roadSurf === S_DIRT) c = h < 0.35 ? pal.dirt[1]! : h > 0.75 ? pal.dirt[0]! : pal.dirt[2]!;
  // Muddy tire ruts where cars run wide.
  const rut = Math.abs(p.k - sh * 0.45 - (vnoise(p.s, 4, 22, SEED + 63) - 0.5) * 5);
  if (rut < 2.2 && vnoise(p.s, 5, 60, SEED + 64) > 0.45)
    return env.wet > 0.3 && hash2(x, y, SEED + 65) < 0.3 ? pal.mudWater : pal.mud[1]!;
  if (hash2(x, y, SEED + 66) < 0.02) return pal.pebble;
  return c;
}

function snowVergePx(p: RoadPx, pal: RoadPalette, sh: number): Color {
  // The plow's ridge: a lighter berm of thrown snow along the outer edge.
  const t = p.k / sh;
  const s = pal.snow;
  const ragged = (vnoise(p.x, p.y, 6, SEED + 71) - 0.5) * 0.4;
  if (t + ragged > 0.55) return hash2(q(p.x), q(p.y), SEED + 72) < 0.25 ? s[3]! : s[4]!;
  if (t + ragged > 0.4) return s[1]!;
  return hash2(q(p.x), q(p.y), SEED + 73) < 0.3 ? s[1]! : s[2]!;
}

/**
 * Paints every corridor pixel. Returns, per pixel, the surface drawn (for the tests' color
 * distance checks and for the decorators that follow).
 */
export function paintCorridor(env: Env, pal: RoadPalette, isDeep: (i: number) => boolean): void {
  const { maps, world, ctx } = env;
  const { field, track } = ctx;
  const { w, h } = maps;
  const flags = world.flags!;
  const p: RoadPx = { x: 0, y: 0, i: 0, lat: 0, s: 0, hw: 0, k: 0, branch: 0, main: true };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const kind = maps.kind[i]!;
      if (kind !== K_PAVE && kind !== K_SHOULDER) continue;
      const e = field.edge[i]!;
      if (e >= FAR) continue;
      const b = field.branch[i]!;
      const br = track.branches[b]!;
      const sh = br.shoulder[field.sample[i]!]!;
      p.x = x;
      p.y = y;
      p.i = i;
      p.lat = field.lateral[i]!;
      p.s = field.s[i]!;
      p.hw = field.half[i]!;
      p.k = e + sh;
      p.branch = b;
      p.main = b === 0;
      // The physics' surface here, read a few pixels off so a zone border is not a staircase.
      const jx = Math.round((vnoise(x, y, 26, SEED + 81) - 0.5) * 11 + (vnoise(x, y, 6, SEED + 81 + 2) - 0.5) * 3);
      const jy = Math.round((vnoise(x, y, 26, SEED + 82) - 0.5) * 11 + (vnoise(x, y, 6, SEED + 82 + 2) - 0.5) * 3);
      const xx = Math.min(w - 1, Math.max(0, x + jx));
      const yy = Math.min(h - 1, Math.max(0, y + jy));
      const j = yy * w + xx;
      let surf = maps.surf[i]!;
      if (maps.kind[j] === kind) surf = maps.surf[j]!;
      let c: Color;
      world.curFlags = 0;
      if (kind === K_SHOULDER) {
        if (surf === S_SNOW) c = snowVergePx(p, pal, sh);
        else if (surf === S_ICE) c = icePx(p, pal, false);
        else if (surf === S_MUD) c = mudPx(p, pal, env, false);
        else c = vergePx(p, pal, env, sh, surf);
      } else if (surf === S_ASPHALT) c = asphaltPx(p, pal, env);
      else if (surf === S_DIRT) c = dirtPx(p, pal, env, isDeep(i) ? -1 : 0);
      else if (surf === S_MUD) c = mudPx(p, pal, env, isDeep(i));
      else if (surf === S_SNOW) c = snowPx(p, pal, isDeep(i));
      else if (surf === S_ICE) c = icePx(p, pal, true);
      else c = dirtPx(p, pal, env);
      put(world, i, c);
      flags[i] = kind === K_PAVE && (c === pal.line || c === pal.center) ? F_NOSHADOW : 0;
    }
}

export const SURF = {
  asphalt: S_ASPHALT,
  dirt: S_DIRT,
  mud: S_MUD,
  snow: S_SNOW,
  ice: S_ICE,
} as const satisfies Partial<Record<SurfaceId, number>>;
