import { hash2, mulberry32, sampleBranch } from '@bolt/shared';
import type { TrackBranch } from '@bolt/shared';
import type { BakeContext } from '../biome.js';
import type { Color } from '../canvas.js';
import { F_NOSHADOW, stencil } from '../canvas.js';
import { ZONE_PAVEMENT, ZONE_SHOULDER } from '../field.js';
import type { CityLayout } from './layout.js';
import { G_STREET } from './layout.js';
import { PAL } from './palette.js';

/**
 * The stage: pavement, paint, kerbs, sidewalk and the solid edge. Every pixel here is derived
 * from the corridor field, so curves stay crisp and the wall line is exactly the collision
 * edge. Markings are evaluated in track space (distance along and across the road).
 */

/** Pixels of wall drawn outside the collision edge: 2 of dark base, 3 of lit cap. */
export const WALL_OUT = 5;
export const WALL_HEIGHT = 3;

export type RoadPlan = {
  /** Per main-line sample: 1 where striped racing kerbs replace the concrete kerb. */
  corner: Uint8Array;
  /** Per main-line sample: lateral offset of the rubbered racing line. */
  lineOffset: Float32Array;
  lineStrength: Float32Array;
  /** Arc length where each hairpin begins, with its turn direction. */
  hairpins: Array<{ s: number; dir: number }>;
  zebras: number[];
  arrows: number[];
  /** Arc length range of the cobbled downtown section on the main line. */
  cobbleFrom: number;
  cobbleTo: number;
};

const SURF_SEED = 7001;

function wide(branch: TrackBranch, src: Float64Array, radius: number): Float32Array {
  const out = new Float32Array(branch.count);
  for (let i = 0; i < branch.count; i++) {
    let sum = 0;
    let weight = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = (((i + k) % branch.count) + branch.count) % branch.count;
      const wgt = radius + 1 - Math.abs(k);
      sum += src[j]! * wgt;
      weight += wgt;
    }
    out[i] = sum / weight;
  }
  return out;
}

export function planRoad(ctx: BakeContext): RoadPlan {
  const main = ctx.track.main;
  const n = main.count;
  const sc = ctx.field.smoothCurvature[0]!;
  const corner = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (Math.abs(sc[i]!) > 0.00185) {
      for (let k = -3; k <= 3; k++) corner[(((i + k) % n) + n) % n] = 1;
    }
  }
  const broad = wide(main, main.curvature, 16);
  const lineOffset = new Float32Array(n);
  const lineStrength = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lim = main.halfWidth[i]! - 26;
    lineOffset[i] = Math.max(-lim, Math.min(lim, broad[i]! * 9500));
    lineStrength[i] = Math.min(1, Math.max(0, (Math.abs(broad[i]!) - 0.0011) / 0.0012));
  }
  const hairpins: Array<{ s: number; dir: number }> = [];
  for (let i = 0; i < n; i++) {
    const prev = Math.abs(sc[(i - 1 + n) % n]!);
    if (prev <= 0.0045 && Math.abs(sc[i]!) > 0.0045)
      hairpins.push({ s: main.s[i]!, dir: Math.sign(sc[i]!) });
  }
  let cobbleFrom = -1;
  let cobbleTo = -1;
  for (let i = 0; i < n; i++) {
    if (main.surface[i] === 'cobble') {
      if (cobbleFrom < 0) cobbleFrom = main.s[i]!;
      cobbleTo = main.s[i]!;
    }
  }
  const startS = ctx.track.startS;
  const zebras = [1330, 2500, 4250, 7640, 8950];
  const arrows: number[] = [];
  for (let k = 0; k < 40; k++) {
    const s = (startS + 230 + k * 470) % main.length;
    const p = sampleBranch(main, s);
    if (Math.abs(sc[p.index]!) > 0.0009 || main.surface[p.index] !== 'asphalt') continue;
    if (zebras.some((z) => Math.abs(z - s) < 110)) continue;
    if (hairpins.some((h) => s > h.s - 420 && s < h.s + 60)) continue;
    if (Math.abs(s - startS) < 200 || main.length - Math.abs(s - startS) < 200) continue;
    arrows.push(s);
  }
  return { corner, lineOffset, lineStrength, hairpins, zebras, arrows, cobbleFrom, cobbleTo };
}

function asphaltTone(x: number, y: number): Color {
  const row = y >> 1;
  const xo = x + ((hash2(row, 11, SURF_SEED) * 6) | 0);
  const h1 = hash2(xo >> 2, row, SURF_SEED + 1);
  let c: Color = PAL.asphalt;
  if (h1 < 0.1) c = PAL.asphaltDark;
  else if (h1 > 0.905) c = PAL.asphaltLight;
  else {
    const h3 = hash2((x + 3) >> 1, y, SURF_SEED + 3);
    if (h3 < 0.022) c = PAL.asphaltDark;
  }
  if (hash2(x, y, SURF_SEED + 2) < 0.007) c = PAL.asphaltSpeck;
  return c;
}

const COBBLE_TONES: readonly Color[] = [
  PAL.cobbleDark,
  PAL.cobble,
  PAL.cobble,
  PAL.cobbleLight,
  PAL.cobbleLight,
  PAL.cobbleHi,
];

function cobbleTone(x: number, y: number): Color {
  // Courses of hand-set stones: every course is shifted and its joints wander, so the
  // surface reads as cobble rather than brickwork.
  const row = Math.floor(y / 4);
  const ly = y - row * 4;
  if (ly === 3) return PAL.mortar;
  const xo = x + ((hash2(row, 17, SURF_SEED + 19) * 11) | 0);
  const pair = Math.floor(xo / 11);
  const lx = xo - pair * 11;
  const split = 4 + ((hash2(pair, row, SURF_SEED + 21) * 3) | 0);
  if (lx === split || lx === 10) return PAL.mortar;
  const first = lx < split;
  const h = hash2(pair * 2 + (first ? 0 : 1), row, SURF_SEED + 20);
  const tone = COBBLE_TONES[(h * COBBLE_TONES.length) | 0]!;
  const start = first ? 0 : split + 1;
  const end = first ? split - 1 : 9;
  // Rounded crowns: a lit pixel at the upper left, a worn corner at the lower right.
  if (lx === start && ly === 0) return h > 0.3 ? PAL.cobbleHi : tone;
  if (lx === end && ly === 2) return PAL.cobbleDark;
  return tone;
}

type Decal = {
  kind: 'start' | 'grid' | 'zebra' | 'arrow' | 'chevron';
  s: number;
  lat: number;
  reach: number;
};

export function paintRoad(ctx: BakeContext, layout: CityLayout, plan: RoadPlan): void {
  const { field, track, world } = ctx;
  const { w, h, edge, lateral, s: sArr, half, branch, sample, zone, surface } = field;
  const main = track.main;
  const L = main.length;
  const cobbleIdx = field.surfaces.indexOf('cobble');
  const data = world.data;
  const flags = world.flags!;
  const heightPlane = world.height!;
  const wrap = (d: number): number => ((((d + L / 2) % L) + L) % L) - L / 2;

  // Decals bucketed by arc length so each pixel tests only what is near it.
  const BUCKET = 64;
  const buckets: Decal[][] = Array.from({ length: Math.ceil(L / BUCKET) + 1 }, () => []);
  const addDecal = (d: Decal): void => {
    const from = Math.floor((d.s - d.reach) / BUCKET);
    const to = Math.floor((d.s + d.reach) / BUCKET);
    const nb = Math.ceil(L / BUCKET);
    for (let b = from; b <= to; b++) buckets[((b % nb) + nb) % nb]!.push(d);
  };
  const startS = track.startS;
  addDecal({ kind: 'start', s: startS, lat: 0, reach: 12 });
  const gridS = startS - 46;
  const gridHalf = sampleBranch(main, gridS).halfWidth;
  for (const side of [-1, 1])
    addDecal({ kind: 'grid', s: gridS, lat: side * gridHalf * 0.42, reach: 44 });
  for (const z of plan.zebras) addDecal({ kind: 'zebra', s: z, lat: 0, reach: 30 });
  for (const a of plan.arrows) {
    const hw = sampleBranch(main, a).halfWidth;
    addDecal({ kind: 'arrow', s: a, lat: -hw * 0.5, reach: 44 });
    addDecal({ kind: 'arrow', s: a, lat: hw * 0.5, reach: 44 });
  }
  for (const hp of plan.hairpins) {
    for (let k = 0; k < 3; k++)
      addDecal({ kind: 'chevron', s: hp.s - 340 + k * 30, lat: hp.dir, reach: 56 });
  }

  const put = (i: number, c: Color, fl = 0): void => {
    const o = i * 4;
    data[o] = (c >> 16) & 255;
    data[o + 1] = (c >> 8) & 255;
    data[o + 2] = c & 255;
    data[o + 3] = 255;
    flags[i] = fl;
  };
  const worn = (x: number, y: number, c: Color, wornC: Color, amount: number): Color =>
    hash2(x >> 1, y >> 1, SURF_SEED + 40) < amount ? wornC : c;

  const shoulderOf = (i: number): number => track.branches[branch[i]!]!.shoulder[sample[i]!]!;
  const kOf = (i: number): number => edge[i]! + shoulderOf(i);
  const isKerb = (i: number): boolean => zone[i] === ZONE_SHOULDER && kOf(i) < 3;
  const isCap = (i: number): boolean => edge[i]! > 2 && edge[i]! <= WALL_OUT;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const e = edge[i]!;
      if (e > WALL_OUT) continue;
      const b = branch[i]!;
      const br = track.branches[b]!;
      const si = sample[i]!;
      const ss = sArr[i]!;
      const lat = lateral[i]!;
      const hw = half[i]!;
      const sh = br.shoulder[si]!;
      const d = e + hw + sh;
      const k = d - hw;

      // --- The solid edge ---------------------------------------------------------------
      if (e > 0) {
        heightPlane[i] = WALL_HEIGHT;
        if (e <= 2) {
          put(i, PAL.wallBase);
          continue;
        }
        const barrier = layout.ground[i] === G_STREET && layout.roofId[i] === 0;
        let c: Color;
        if (barrier) {
          const stripe = (Math.floor(ss / 7) & 1) === 0;
          c = stripe ? PAL.kerbCoral : PAL.kerbIvory;
          if (!isCap(i + w + 1)) c = stripe ? PAL.kerbCoralDark : PAL.kerbIvoryDark;
        } else {
          c = PAL.wallCap;
          if (!isCap(i - w - 1)) c = PAL.wallHi;
          else if (!isCap(i + w + 1)) c = PAL.wallShade;
        }
        put(i, c);
        continue;
      }

      const isMain = b === 0;
      const z = zone[i]!;

      // --- Shoulder: kerb and sidewalk --------------------------------------------------
      if (z === ZONE_SHOULDER) {
        const cornerHere = isMain && plan.corner[si] === 1;
        if (k < 3) {
          if (cornerHere) {
            const stripe = (Math.floor(ss / 10) & 1) === 0;
            put(
              i,
              k >= 2
                ? stripe
                  ? PAL.kerbCoralDark
                  : PAL.kerbIvoryDark
                : stripe
                  ? PAL.kerbCoral
                  : PAL.kerbIvory,
              F_NOSHADOW,
            );
          } else {
            let c: Color = PAL.kerb;
            if (!isKerb(i - w - 1)) c = PAL.kerbHi;
            else if (!isKerb(i + w + 1)) c = PAL.kerbShade;
            put(i, c);
          }
          continue;
        }
        if (e > -1.6) {
          put(i, PAL.walkShade);
          continue;
        }
        const inner = k < 9.5;
        const along = inner ? ss : ss + 7;
        const cell = Math.floor(along / 14);
        if (along - cell * 14 < 1.05 || (k >= 9 && k < 10)) {
          put(i, PAL.walkGrout);
          continue;
        }
        const hs = hash2(cell, (inner ? 0 : 1) + b * 2 + (lat > 0 ? 4 : 0), SURF_SEED + 60);
        put(i, hs < 0.28 ? PAL.walkLight : hs > 0.93 ? PAL.walkShade : PAL.walk);
        continue;
      }

      // --- Pavement ---------------------------------------------------------------------
      const cobble = surface[i] === cobbleIdx;
      let c: Color;
      let fl = 0;
      if (cobble) {
        c = cobbleTone(x, y);
        if (isMain) {
          if (k >= -6) {
            // Border course of long setts running with the road.
            const cell = Math.floor(ss / 9);
            if (k < -5 || ss - cell * 9 < 1.05) c = PAL.mortar;
            else c = hash2(cell, lat > 0 ? 1 : 0, SURF_SEED + 61) < 0.4 ? PAL.settLight : PAL.sett;
          } else if (lat >= 9 && lat < 12) {
            c = lat < 10 ? PAL.rail : lat < 11 ? PAL.railMid : PAL.railGroove;
          } else if (lat >= 23 && lat < 26) {
            c = lat < 24 ? PAL.rail : lat < 25 ? PAL.railMid : PAL.railGroove;
          } else if (
            lat >= 12 &&
            lat < 23 &&
            Math.floor(ss) % 12 === 0 &&
            (lat < 13.2 || lat >= 21.8)
          ) {
            // Rail clips.
            c = PAL.railMid;
          }
        } else if (d > hw - 2.2) {
          c = PAL.mortar;
        } else if (d > hw - 7) {
          const cell = Math.floor(ss / 8);
          c =
            ss - cell * 8 < 1.05 || d < hw - 6
              ? PAL.mortar
              : hash2(cell, lat > 0 ? 3 : 2, SURF_SEED + 61) < 0.4
                ? PAL.sett
                : PAL.cobbleLight;
        }
      } else {
        c = asphaltTone(x, y);
        if (isMain) {
          // Repair patches, one candidate per 120 px cell.
          const cell = Math.floor(ss / 120);
          const hp = hash2(cell, 5, SURF_SEED + 70);
          if (hp < 0.46) {
            const u0 = cell * 120 + 8 + hash2(cell, 6, SURF_SEED + 70) * 40;
            const len = 22 + hash2(cell, 7, SURF_SEED + 70) * 44;
            const v0 = (hash2(cell, 8, SURF_SEED + 70) * 2 - 1) * (hw - 46);
            const wid = 12 + hash2(cell, 9, SURF_SEED + 70) * 18;
            const u = ss - u0;
            const v = lat - v0;
            if (u >= 0 && u < len && Math.abs(v) < wid) {
              const border = u < 1.1 || u > len - 1.1 || Math.abs(v) > wid - 1.1;
              c = border
                ? PAL.patchEdge
                : hash2(x >> 1, y >> 1, SURF_SEED + 71) < 0.07
                  ? PAL.asphaltDark
                  : PAL.patch;
            }
          }
          // Rubber laid down on the racing line through corners.
          const strength = plan.lineStrength[si]!;
          if (strength > 0) {
            const dl = Math.abs(lat - plan.lineOffset[si]!);
            const core = 4 + strength * 5;
            if (dl < core) {
              if (hash2(x >> 1, y, SURF_SEED + 72) < 0.55 + strength * 0.3) c = PAL.asphaltRubber;
            } else if (
              dl < core + 4 &&
              ((x + y) & 1) === 0 &&
              hash2(x >> 2, y >> 1, SURF_SEED + 73) < 0.6
            ) {
              c = PAL.asphaltRubber;
            }
          }
          // Drain grates tucked against the kerb.
          const gcell = Math.floor(ss / 180);
          const gu = ss - gcell * 180 - 70;
          if (gu >= 0 && gu < 10 && k >= -6 && k < -1 && (gcell & 1) === (lat > 0 ? 1 : 0)) {
            c =
              gu < 1 || gu >= 9 || k < -5
                ? PAL.steelDark
                : (Math.floor(gu) & 1) === 0
                  ? PAL.ink
                  : PAL.steel;
          }
          // Edge lines, inset from the kerb.
          if (k >= -8 && k < -6) {
            c = worn(x, y, PAL.paint, PAL.paintWorn, 0.2);
            fl = F_NOSHADOW;
          }
          // Lane dashes on the centerline.
          const m = ss - Math.floor(ss / 44) * 44;
          if (lat >= -1.5 && lat < 1.5 && m < 20) {
            c = worn(x, y, PAL.paint, PAL.paintWorn, 0.16);
            fl = F_NOSHADOW;
          }
        }
      }

      // A steel-edged course of setts where asphalt meets cobble.
      if (isMain) {
        const dt = Math.min(Math.abs(ss - plan.cobbleFrom), Math.abs(ss - plan.cobbleTo - 10));
        if (dt < 5) {
          const cell = Math.floor((lat + 500) / 9);
          c =
            dt > 3.9
              ? PAL.railMid
              : dt < 0.6 || lat + 500 - cell * 9 < 1.05
                ? PAL.mortar
                : hash2(cell, 9, SURF_SEED + 62) < 0.4
                  ? PAL.settLight
                  : PAL.sett;
          fl = 0;
        }
      }

      // Racing kerb overlaps the last pixels of pavement on corners.
      if (isMain && plan.corner[si] === 1 && k >= -3) {
        const stripe = (Math.floor(ss / 10) & 1) === 0;
        put(i, stripe ? PAL.kerbCoral : PAL.kerbIvory, F_NOSHADOW);
        continue;
      }

      if (isMain) {
        const list = buckets[Math.floor(ss / BUCKET)];
        if (list) {
          for (const dc of list) {
            const u = wrap(ss - dc.s);
            if (dc.kind === 'start') {
              if (u >= -7 && u < 7 && k < -1) {
                const check = (Math.floor((u + 70) / 7) + Math.floor((lat + 700) / 7)) & 1;
                c = check ? PAL.paintBright : PAL.ink;
                fl = F_NOSHADOW;
              }
            } else if (dc.kind === 'grid') {
              const v = lat - dc.lat;
              const av = Math.abs(v);
              if (u >= -36 && u < 35 && av < 25) {
                if (u < 33 && av < 22.5 && u >= -36) {
                  // Clear the dashes out of the bay.
                  if (c === PAL.paint || c === PAL.paintWorn) c = asphaltTone(x, y);
                }
                if ((u >= 32 && u < 35) || (av >= 22.5 && u >= -4)) {
                  c = worn(x, y, PAL.paintBright, PAL.paint, 0.12);
                  fl = F_NOSHADOW;
                }
              }
            } else if (dc.kind === 'zebra') {
              if (k < -10) {
                if (u >= 0 && u < 22) {
                  const bar = lat + 600 - Math.floor((lat + 600) / 13) * 13;
                  if (bar < 7.5) {
                    c = worn(x, y, PAL.paintBright, PAL.paintWorn, 0.14);
                    fl = F_NOSHADOW;
                  } else if (c === PAL.paint || c === PAL.paintWorn) c = asphaltTone(x, y);
                } else if (u >= -9 && u < -6) {
                  c = worn(x, y, PAL.paint, PAL.paintWorn, 0.14);
                  fl = F_NOSHADOW;
                }
              }
            } else if (dc.kind === 'arrow') {
              const v = Math.abs(lat - dc.lat);
              const uu = u + 20;
              if (uu >= 0 && uu < 40) {
                const on = uu < 24 ? v < 2.6 : v < ((40 - uu) * 9.5) / 16;
                if (on) {
                  c = worn(x, y, PAL.paint, PAL.paintWorn, 0.2);
                  fl = F_NOSHADOW;
                }
              }
            } else {
              const reach = hw - 20;
              const av = Math.abs(lat);
              if (av < reach) {
                const uu = u + av * 0.42;
                if (uu >= 14 && uu < 23) {
                  c = worn(x, y, PAL.paintGold, PAL.paintGoldWorn, 0.18);
                  fl = F_NOSHADOW;
                }
              }
            }
          }
        }
      } else {
        // Gold threshold bands mark both mouths of the shortcut.
        const fromEnd = br.length - ss;
        const u = Math.min(ss, fromEnd);
        if (u >= 66 && u < 70 && d < hw - 7) {
          const bar = lat + 400 - Math.floor((lat + 400) / 8) * 8;
          if (bar < 5) {
            c = PAL.paintGold;
            fl = F_NOSHADOW;
          }
        }
      }
      put(i, c, fl);
    }
  }

  paintScatter(ctx, plan);
}

const MANHOLE = stencil([
  '...ddddd...',
  '.ddmmmmmdd.',
  '.dmhmhmhmd.',
  'dmmmmmmmmmd',
  'dmhmhmhmhsd',
  'dmmmmmmmmsd',
  'dmhmhmhmhsd',
  'dmmmmmmmssd',
  '.dmhmhmssd.',
  '.ddsssssdd.',
  '...ddddd...',
]);

/** Details that are easier to place as objects than to evaluate per pixel. */
function paintScatter(ctx: BakeContext, plan: RoadPlan): void {
  const { field, track, world } = ctx;
  const main = track.main;
  const rnd = mulberry32(ctx.seed ^ 0x51ab);
  const asphaltSet = new Set<Color>([
    PAL.asphalt,
    PAL.asphaltDark,
    PAL.asphaltLight,
    PAL.asphaltSpeck,
    PAL.asphaltRubber,
    PAL.patch,
  ]);
  const asphaltIdx = field.surfaces.indexOf('asphalt');
  const onAsphalt = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= field.w || y >= field.h) return false;
    const i = y * field.w + x;
    return (
      field.zone[i] === ZONE_PAVEMENT &&
      field.surface[i] === asphaltIdx &&
      asphaltSet.has(world.get(x, y))
    );
  };
  const clearOfDecals = (s: number): boolean => {
    const near = (t: number, r: number): boolean => {
      const dlt = Math.abs(s - t);
      return Math.min(dlt, main.length - dlt) < r;
    };
    if (near(track.startS - 20, 90)) return false;
    if (plan.zebras.some((z) => near(z, 40))) return false;
    if (plan.arrows.some((a) => near(a, 40))) return false;
    if (plan.hairpins.some((hp) => near(hp.s - 290, 80))) return false;
    return true;
  };
  const at = (
    s: number,
    lat: number,
  ): { x: number; y: number; hw: number; tx: number; ty: number } => {
    const p = sampleBranch(main, s);
    return { x: p.x - p.ty * lat, y: p.y + p.tx * lat, hw: p.halfWidth, tx: p.tx, ty: p.ty };
  };

  // Oil stains: a few merged blobs, darker with a violet cast.
  for (let s = 60; s < main.length; s += 150 + rnd() * 240) {
    if (!clearOfDecals(s)) continue;
    const hw = sampleBranch(main, s).halfWidth;
    const p = at(s, (rnd() * 2 - 1) * (hw - 24));
    const blobs = 2 + ((rnd() * 3) | 0);
    for (let k = 0; k < blobs; k++) {
      const bx = Math.round(p.x + (rnd() * 2 - 1) * 6);
      const by = Math.round(p.y + (rnd() * 2 - 1) * 4);
      const r = 2 + rnd() * 3.5;
      for (let yy = Math.floor(by - r); yy <= by + r; yy++) {
        for (let xx = Math.floor(bx - r); xx <= bx + r; xx++) {
          if ((xx - bx) * (xx - bx) + (yy - by) * (yy - by) > (r + 0.3) * (r + 0.3)) continue;
          if (onAsphalt(xx, yy))
            world.set(xx, yy, hash2(xx, yy, 91) < 0.12 ? PAL.asphaltRubber : PAL.oil);
        }
      }
    }
  }

  // Cracks: short wandering dark lines.
  for (let s = 20; s < main.length; s += 70 + rnd() * 130) {
    const hw = sampleBranch(main, s).halfWidth;
    const p = at(s, (rnd() * 2 - 1) * (hw - 14));
    let x = p.x;
    let y = p.y;
    let ang = rnd() * Math.PI * 2;
    const steps = 10 + ((rnd() * 26) | 0);
    for (let k = 0; k < steps; k++) {
      const px = Math.round(x);
      const py = Math.round(y);
      if (onAsphalt(px, py)) world.set(px, py, PAL.crack);
      ang += (rnd() - 0.5) * 1.3;
      x += Math.cos(ang);
      y += Math.sin(ang);
      if (rnd() < 0.06) {
        // A short branch.
        let bx = x;
        let by = y;
        const bang = ang + (rnd() < 0.5 ? 1 : -1) * 1.1;
        for (let j = 0; j < 5; j++) {
          bx += Math.cos(bang);
          by += Math.sin(bang);
          if (onAsphalt(Math.round(bx), Math.round(by)))
            world.set(Math.round(bx), Math.round(by), PAL.crack);
        }
      }
    }
  }

  // Manhole covers, on any surface.
  const pal = { d: PAL.ink, m: PAL.steel, h: PAL.steelLight, s: PAL.steelDark };
  for (let s = 130; s < main.length; s += 210 + rnd() * 160) {
    if (!clearOfDecals(s)) continue;
    const hw = sampleBranch(main, s).halfWidth;
    const lat = (rnd() < 0.5 ? -1 : 1) * (12 + rnd() * (hw - 40));
    const p = at(s, lat);
    const x = Math.round(p.x) - 5;
    const y = Math.round(p.y) - 5;
    const i = (y + 5) * field.w + x + 5;
    if (field.zone[i] !== ZONE_PAVEMENT || field.branch[i] !== 0) continue;
    world.curFlags = 0;
    world.stamp(x, y, MANHOLE, pal);
  }

  // Twin skid marks running into each hairpin.
  for (const hp of plan.hairpins) {
    for (const pair of [0, 1]) {
      const base = (pair === 0 ? -14 : 12) * hp.dir;
      for (let u = -150 + pair * 30; u < 30; u += 0.5) {
        const s = hp.s + u;
        const p = sampleBranch(main, s);
        const drift = ((u + 150) / 180) * 26 * hp.dir;
        for (const off of [-8, 8]) {
          const lat = base + drift + off;
          const x = Math.round(p.x - p.ty * lat);
          const y = Math.round(p.y + p.tx * lat);
          if (hash2(x >> 1, y >> 1, 93) < 0.8) {
            const i = y * field.w + x;
            if (
              field.zone[i] === ZONE_PAVEMENT &&
              (asphaltSet.has(world.get(x, y)) || field.surface[i] !== asphaltIdx)
            ) {
              if (field.surface[i] === asphaltIdx) world.set(x, y, PAL.crack);
            }
          }
        }
      }
    }
  }
}
