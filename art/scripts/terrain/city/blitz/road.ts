import { hash2, sampleBranch } from '@bolt/shared';
import type { TrackHazard } from '@bolt/shared';
import type { BakeContext } from '../../biome.js';
import type { Color } from '../../canvas.js';
import { F_NOSHADOW } from '../../canvas.js';
import { ZONE_SHOULDER } from '../../field.js';
import { PAL } from '../palette.js';
import type { RoadPlan } from '../road.js';

/**
 * Backstreet Blitz's road surface, flat on the ground plane and derived from the corridor field
 * and the track data only: asphalt on the boulevard and the downtown blocks, cobbles in the old
 * town, coursed setts in the two alleys, tram rails along the hazard's rail path, the crossing's
 * keep-clear box exactly over the barrier, stop lines, zebras and arrows on straights, striped
 * kerbs through the corners, gold thresholds at the alley mouths and taper hatching in front of
 * each barricade.
 */

const SEED = 2207;
const DASH = 40;

export type BlitzRoadPlan = RoadPlan & {
  /** Cobbled spans of the main line, as arc-length ranges. */
  cobbleSpans: Array<[number, number]>;
  /** Arc length of the crossing on the main line. */
  crossingS: number;
};

export function planBlitzRoad(ctx: BakeContext): BlitzRoadPlan {
  const { track, field } = ctx;
  const main = track.main;
  const n = main.count;
  const L = main.length;
  const sc = field.smoothCurvature[0]!;
  const corner = new Uint8Array(n);
  for (let i = 0; i < n; i++)
    if (Math.abs(sc[i]!) > 0.0042)
      for (let k = -2; k <= 2; k++) corner[(((i + k) % n) + n) % n] = 1;
  const lineOffset = new Float32Array(n);
  const lineStrength = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -14; k <= 14; k++) sum += main.curvature[(((i + k) % n) + n) % n]!;
    const broad = sum / 29;
    const lim = main.halfWidth[i]! - 24;
    lineOffset[i] = Math.max(-lim, Math.min(lim, broad * 8000));
    lineStrength[i] = Math.min(1, Math.max(0, (Math.abs(broad) - 0.0016) / 0.002));
  }
  const cobbleSpans: Array<[number, number]> = [];
  let from = -1;
  for (let i = 0; i <= n; i++) {
    const cob = i < n && main.surface[i] === 'cobble';
    if (cob && from < 0) from = main.s[i]!;
    if (!cob && from >= 0) {
      cobbleSpans.push([from, main.s[i - 1]!]);
      from = -1;
    }
  }
  const crossing = ctx.def.hazards.find((h) => h.kind === 'crossing');
  const crossingS = crossing
    ? (track.routeHazards.find((r) => r.hazard === ctx.def.hazards.indexOf(crossing))?.s ?? -1)
    : -1;
  const wrapD = (a: number, b: number): number => {
    const d = Math.abs(a - b) % L;
    return Math.min(d, L - d);
  };
  const shortcutEnds: number[] = [];
  for (const b of track.branches.slice(1)) shortcutEnds.push(b.leaveS, b.rejoinS);
  const straightAt = (s: number, reach: number): boolean => {
    for (let u = -reach; u <= reach; u += 10) {
      const p = sampleBranch(main, s + u);
      if (Math.abs(sc[p.index]!) > 0.0006 || main.surface[p.index] !== 'asphalt') return false;
    }
    return true;
  };
  const busy = (s: number): boolean =>
    wrapD(s, track.startS) < 240 ||
    (crossingS >= 0 && wrapD(s, crossingS) < 170) ||
    shortcutEnds.some((e) => wrapD(s, e) < 130) ||
    track.cornerSigns.some((sg) => sg.branch === 0 && wrapD(s, sg.signS) < 60);
  const zebras: number[] = [];
  for (let s = 0; s < L; s += 20) {
    if (busy(s) || !straightAt(s, 70)) continue;
    if (zebras.some((z) => wrapD(z, s) < 900)) continue;
    zebras.push(s);
  }
  const arrows: number[] = [];
  for (let k = 0; k < 40; k++) {
    const s = (track.startS + 260 + k * 420) % L;
    if (busy(s) || !straightAt(s, 50)) continue;
    if (zebras.some((z) => wrapD(z, s) < 120)) continue;
    arrows.push(s);
  }
  return {
    corner,
    lineOffset,
    lineStrength,
    hairpins: [],
    zebras,
    arrows,
    cobbleFrom: cobbleSpans[0]?.[0] ?? -1,
    cobbleTo: cobbleSpans[0]?.[1] ?? -1,
    cobbleSpans,
    crossingS,
  };
}

function asphaltTone(x: number, y: number): Color {
  const row = y >> 1;
  const xo = x + ((hash2(row, 13, SEED) * 6) | 0);
  const h1 = hash2(xo >> 2, row, SEED + 1);
  let c: Color = PAL.asphalt;
  if (h1 < 0.11) c = PAL.asphaltDark;
  else if (h1 > 0.9) c = PAL.asphaltLight;
  else if (hash2((x + 3) >> 1, y, SEED + 3) < 0.02) c = PAL.asphaltDark;
  if (hash2(x, y, SEED + 2) < 0.008) c = PAL.asphaltSpeck;
  return c;
}

const CELL = 7;
export function cobbleTone(x: number, y: number, seed: number): Color {
  const gx = Math.floor(x / CELL);
  const gy = Math.floor(y / CELL);
  let d1 = 1e9;
  let d2 = 1e9;
  let tone = 0;
  let ox = 0;
  let oy = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = (gx + i) * CELL + 1 + hash2(gx + i, gy + j, seed) * 4;
      const cy = (gy + j) * CELL + 1 + hash2(gx + i, gy + j, seed + 1) * 4;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = dx * dx + dy * dy;
      if (d < d1) {
        d2 = d1;
        d1 = d;
        tone = hash2(gx + i, gy + j, seed + 2);
        ox = dx;
        oy = dy;
      } else if (d < d2) d2 = d;
    }
  if (Math.sqrt(d2) - Math.sqrt(d1) < 0.9) return PAL.mortar;
  if (tone > 0.45 && ox < -0.4 && oy < -0.4 && ox > -1.6 && oy > -1.6) return PAL.cobbleHi;
  return tone < 0.18 ? PAL.cobbleDark : tone > 0.72 ? PAL.cobbleLight : PAL.cobble;
}

/** Alley setts: small dark stones in courses across the lane, joints staggered course by course. */
function settTone(u: number, v: number): Color {
  const course = Math.floor(u / 5);
  const vv = v + (course & 1) * 3.5;
  const stone = Math.floor(vv / 7);
  if (u - course * 5 < 1 || vv - stone * 7 < 1) return PAL.mortar;
  const t = hash2(course, stone, SEED + 40);
  if (t < 0.25) return PAL.cobbleDark;
  if (t > 0.86) return PAL.cobble;
  return u - course * 5 < 2 ? PAL.cobble : PAL.cobbleDark;
}

type Rail = { x0: number; y0: number; x1: number; y1: number };

export function paintBlitzRoad(ctx: BakeContext, plan: BlitzRoadPlan): void {
  const { field, track, world, def } = ctx;
  const { w, h, edge, lateral, s: sArr, half, branch, sample, zone, surface } = field;
  const main = track.main;
  const L = main.length;
  const cobbleIdx = field.surfaces.indexOf('cobble');
  const data = world.data;
  const flags = world.flags!;
  const wrap = (d: number): number => ((((d + L / 2) % L) + L) % L) - L / 2;
  const put = (i: number, c: Color, fl = 0): void => {
    const o = i * 4;
    data[o] = (c >> 16) & 255;
    data[o + 1] = (c >> 8) & 255;
    data[o + 2] = c & 255;
    data[o + 3] = 255;
    flags[i] = fl;
  };
  const worn = (x: number, y: number, c: Color, wc: Color, amount: number): Color =>
    hash2(x >> 1, y >> 1, SEED + 50) < amount ? wc : c;

  // The tram: two rails a gauge apart along the hazard's rail path.
  const crossing = def.hazards.find((hz) => hz.kind === 'crossing') as
    Extract<TrackHazard, { kind: 'crossing' }> | undefined;
  const rails: Rail[] = [];
  if (crossing)
    for (let k = 0; k + 1 < crossing.railPath.length; k++) {
      const a = crossing.railPath[k]!;
      const b = crossing.railPath[k + 1]!;
      rails.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y });
    }
  const GAUGE = 7;
  /** Signed distance from the rail path's centerline, and how far along it, or null. */
  const railAt = (x: number, y: number): { d: number; t: number } | null => {
    for (const r of rails) {
      const dx = r.x1 - r.x0;
      const dy = r.y1 - r.y0;
      const len2 = dx * dx + dy * dy;
      const t = ((x + 0.5 - r.x0) * dx + (y + 0.5 - r.y0) * dy) / len2;
      if (t < 0 || t > 1) continue;
      const px = r.x0 + dx * t;
      const py = r.y0 + dy * t;
      const len = Math.sqrt(len2);
      const d = ((x + 0.5 - px) * -dy + (y + 0.5 - py) * dx) / len;
      if (Math.abs(d) < 30) return { d, t: t * len };
    }
    return null;
  };
  // Barrier of the crossing: the keep-clear box is laid exactly over it, and a little beyond.
  const barrier = crossing
    ? {
        ax: crossing.a.x,
        ay: crossing.a.y,
        bx: crossing.b.x,
        by: crossing.b.y,
        r: crossing.thickness / 2,
      }
    : null;
  const barrierDist = (x: number, y: number): number => {
    if (!barrier) return 1e9;
    const dx = barrier.bx - barrier.ax;
    const dy = barrier.by - barrier.ay;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((x + 0.5 - barrier.ax) * dx + (y + 0.5 - barrier.ay) * dy) / (dx * dx + dy * dy),
      ),
    );
    return Math.hypot(x + 0.5 - barrier.ax - dx * t, y + 0.5 - barrier.ay - dy * t);
  };

  // Barricades on the shortcuts: hatch the closed side of the lane in front of each.
  const tapers = def.walls
    .filter((wl) => wl.kind === 'barricade')
    .map((wl) => {
      const a = wl.points[0]!;
      const b = wl.points[wl.points.length - 1]!;
      const p = Math.round((a.y + b.y) / 2) * w + Math.round((a.x + b.x) / 2);
      return {
        branch: field.branch[p]!,
        s: field.s[p]!,
        lat: field.lateral[p]!,
        r: wl.thickness / 2,
      };
    });

  const shoulderOf = (i: number): number => track.branches[branch[i]!]!.shoulder[sample[i]!]!;
  const isKerb = (i: number): boolean => zone[i] === ZONE_SHOULDER && edge[i]! + shoulderOf(i) < 3;
  const inCobbleSpan = (s: number): boolean =>
    plan.cobbleSpans.some(([a, b]) => s >= a - 2 && s <= b + 12);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const e = edge[i]!;
      if (e > 0) continue;
      const b = branch[i]!;
      const br = track.branches[b]!;
      const si = sample[i]!;
      const ss = sArr[i]!;
      const lat = lateral[i]!;
      const hw = half[i]!;
      const sh = br.shoulder[si]!;
      const d = e + hw + sh;
      const k = d - hw;
      const isMain = b === 0;
      const z = zone[i]!;

      // --- Shoulder: kerb and sidewalk ------------------------------------------------------
      if (z === ZONE_SHOULDER) {
        if (k < 3) {
          if (isMain && plan.corner[si] === 1) {
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
        // Old flagstones on the cobbled streets, square slabs on the boulevard.
        const cob = isMain && inCobbleSpan(ss);
        const cellLen = cob ? 10 : 14;
        const along = ss + (k > 7 ? 5 : 0);
        const cell = Math.floor(along / cellLen);
        if (along - cell * cellLen < 1.05 || (k >= 7 && k < 8)) {
          put(i, PAL.walkGrout);
          continue;
        }
        const hs = hash2(cell, (k > 7 ? 1 : 0) + (lat > 0 ? 4 : 0), SEED + 60);
        put(i, hs < 0.26 ? PAL.walkLight : hs > 0.9 ? PAL.walkShade : PAL.walk);
        continue;
      }

      // --- Pavement -------------------------------------------------------------------------
      const cobble = surface[i] === cobbleIdx;
      let c: Color;
      let fl = 0;
      if (!isMain) {
        // The alleys: coursed setts with a drain channel down the middle.
        const v = lat + 200;
        c = settTone(ss, v);
        if (Math.abs(lat) < 2.5) c = Math.abs(lat) < 1 ? PAL.railGroove : PAL.mortar;
        else if (d > hw - 2.2) c = PAL.mortar;
        // Gold threshold bands at both mouths.
        const u = Math.min(ss, br.length - ss);
        if (u >= 58 && u < 63 && d < hw - 6) {
          const bar = lat + 400 - Math.floor((lat + 400) / 8) * 8;
          if (bar < 5) {
            c = PAL.paintGold;
            fl = F_NOSHADOW;
          }
        }
        // Taper hatching on the closed side of the lane, leading into every barricade.
        for (const t of tapers) {
          if (t.branch !== b) continue;
          const ahead = t.s - ss;
          if (ahead < -t.r || ahead > 48) continue;
          if (Math.sign(lat) !== Math.sign(t.lat) || Math.abs(lat) < 18 - Math.max(0, ahead) * 0.1)
            continue;
          c = (x + y + 400) % 10 < 5 ? PAL.paintGold : PAL.ink;
          fl = F_NOSHADOW;
        }
      } else if (cobble) {
        c = cobbleTone(x, y, SEED + 19);
        if (k >= -6) {
          // Border course of long setts running with the street.
          const cell = Math.floor(ss / 9);
          if (k < -5 || ss - cell * 9 < 1.05) c = PAL.mortar;
          else c = hash2(cell, lat > 0 ? 1 : 0, SEED + 61) < 0.4 ? PAL.settLight : PAL.sett;
        }
      } else {
        c = asphaltTone(x, y);
        // Repair patches.
        const cell = Math.floor(ss / 130);
        if (hash2(cell, 5, SEED + 70) < 0.4) {
          const u0 = cell * 130 + 10 + hash2(cell, 6, SEED + 70) * 40;
          const len = 20 + hash2(cell, 7, SEED + 70) * 40;
          const v0 = (hash2(cell, 8, SEED + 70) * 2 - 1) * (hw - 40);
          const wid = 10 + hash2(cell, 9, SEED + 70) * 16;
          const u = ss - u0;
          const v = lat - v0;
          if (u >= 0 && u < len && Math.abs(v) < wid) {
            const border = u < 1.1 || u > len - 1.1 || Math.abs(v) > wid - 1.1;
            c = border
              ? PAL.patchEdge
              : hash2(x >> 1, y >> 1, SEED + 71) < 0.07
                ? PAL.asphaltDark
                : PAL.patch;
          }
        }
        // A light film of rubber on the line through the corners, broken up so it reads as
        // wear and never as a groove.
        const strength = plan.lineStrength[si]!;
        if (strength > 0) {
          const dl = Math.abs(lat - plan.lineOffset[si]!);
          const core = 3 + strength * 5;
          if (
            dl < core &&
            ((x + y) & 1) === 0 &&
            hash2(x >> 1, y >> 1, SEED + 72) < 0.25 + strength * 0.3
          )
            c = PAL.asphaltDark;
        }
        // Drain grates against the kerb.
        const gcell = Math.floor(ss / 160);
        const gu = ss - gcell * 160 - 60;
        if (gu >= 0 && gu < 10 && k >= -6 && k < -1 && (gcell & 1) === (lat > 0 ? 1 : 0))
          c =
            gu < 1 || gu >= 9 || k < -5
              ? PAL.steelDark
              : (Math.floor(gu) & 1) === 0
                ? PAL.ink
                : PAL.steel;
        // Edge lines, and the broken center line.
        if (k >= -8 && k < -6) {
          c = worn(x, y, PAL.paint, PAL.paintWorn, 0.2);
          fl = F_NOSHADOW;
        }
        if (lat >= -1.5 && lat < 1.5 && ss % DASH < 18) {
          c = worn(x, y, PAL.paint, PAL.paintWorn, 0.16);
          fl = F_NOSHADOW;
        }
      }

      if (isMain) {
        // Steel-edged sett course where asphalt meets cobble.
        for (const [a, bnd] of plan.cobbleSpans) {
          const dt = Math.min(Math.abs(wrap(ss - a)), Math.abs(wrap(ss - bnd - 10)));
          if (dt < 5) {
            const cell = Math.floor((lat + 500) / 9);
            c =
              dt > 3.9
                ? PAL.railMid
                : dt < 0.6 || lat + 500 - cell * 9 < 1.05
                  ? PAL.mortar
                  : hash2(cell, 9, SEED + 62) < 0.4
                    ? PAL.settLight
                    : PAL.sett;
            fl = 0;
          }
        }
        // Racing kerb over the last pixels of pavement through the corners.
        if (plan.corner[si] === 1 && k >= -3) {
          const stripe = (Math.floor(ss / 10) & 1) === 0;
          put(i, stripe ? PAL.kerbCoral : PAL.kerbIvory, F_NOSHADOW);
          continue;
        }
        // Start line and grid boxes.
        const us = wrap(ss - track.startS);
        if (us >= -7 && us < 7 && k < -1) {
          const check = (Math.floor((us + 70) / 7) + Math.floor((lat + 700) / 7)) & 1;
          c = check ? PAL.paintBright : PAL.ink;
          fl = F_NOSHADOW;
        }
        const ug = wrap(ss - (track.startS - 46));
        const gridHalf = hw * 0.42;
        for (const side of [-1, 1]) {
          const v = lat - side * gridHalf;
          const av = Math.abs(v);
          if (ug >= -36 && ug < 35 && av < 25) {
            if ((ug >= 32 && ug < 35) || (av >= 22.5 && ug >= -4)) {
              c = worn(x, y, PAL.paintBright, PAL.paint, 0.12);
              fl = F_NOSHADOW;
            } else if (c === PAL.paint || c === PAL.paintWorn) c = asphaltTone(x, y);
          }
        }
        // Zebras.
        for (const zs of plan.zebras) {
          const u = wrap(ss - zs);
          if (k >= -10) continue;
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
        // Arrows in both lanes.
        for (const as of plan.arrows) {
          const u = wrap(ss - as) + 20;
          if (u < 0 || u >= 40) continue;
          for (const lane of [-0.5, 0.5]) {
            const v = Math.abs(lat - lane * hw);
            const on = u < 24 ? v < 2.6 : v < ((40 - u) * 9.5) / 16;
            if (on) {
              c = worn(x, y, PAL.paint, PAL.paintWorn, 0.2);
              fl = F_NOSHADOW;
            }
          }
        }
        // The crossing: stop lines either side and a keep-clear box over the barrier.
        if (barrier) {
          const bd = barrierDist(x, y);
          if (bd < barrier.r + 16 && k < -2) {
            const hatch = (x - y + 1000) % 12;
            const rim = bd >= barrier.r + 13;
            c = rim || hatch < 3 ? PAL.paintGold : c;
            if (rim || hatch < 3) fl = F_NOSHADOW;
          } else if (bd >= barrier.r + 30 && bd < barrier.r + 34 && k < -2) {
            c = worn(x, y, PAL.paintBright, PAL.paint, 0.1);
            fl = F_NOSHADOW;
          }
        }
      }

      // Tram rails over everything they cross, with a concrete crossing panel between them.
      if (rails.length > 0) {
        const r = railAt(x, y);
        if (r) {
          const a = Math.abs(r.d);
          if (a < GAUGE + 3) {
            if (a > GAUGE - 1)
              c = a < GAUGE ? PAL.rail : a < GAUGE + 1 ? PAL.railMid : PAL.railGroove;
            else if (isMain && barrier && barrierDist(x, y) < 60) {
              // Rubber crossing panel between the rails, ribbed.
              c = Math.floor(r.t) % 6 === 0 ? PAL.railGroove : PAL.kerbShade;
              fl = 0;
            }
            if (a > GAUGE - 1) fl = F_NOSHADOW;
          }
        }
      }
      put(i, c, fl);
    }
  }
}
