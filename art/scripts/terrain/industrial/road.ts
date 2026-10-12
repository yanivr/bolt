import { createLocation, hash2, locate, sampleBranch } from '@bolt/shared';
import type { TrackHazard, TrackShape } from '@bolt/shared';
import type { BakeContext } from '../biome.js';
import type { Color } from '../canvas.js';
import { F_EMISSIVE, F_NOSHADOW } from '../canvas.js';
import { ZONE_SHOULDER } from '../field.js';
import { PAL } from '../city/palette.js';
import type { RoadPlan } from '../city/road.js';
import { IND } from './style.js';

/**
 * Steel Circuit's floor, derived from the corridor field and the hazards' own shapes: asphalt
 * yard roads with yellow lines, riveted plate inside the halls, granite setts on the dock, a
 * steel tread walkway on every shoulder, hazard-striped kerbs through the corners. The area
 * hazards are painted on exactly the shapes the physics stamps into its zone grid, in colors
 * nothing else on the floor uses, and flagged self-lit so no lamp or shadow shifts them:
 * segmented cyan bars on the magnetic strips, glossy pools with a lit rim for the oil, round
 * grates in a yellow and black ring for the steam vents.
 */

const SEED = 6113;

export type IndustrialPlan = RoadPlan;

export function planIndustrialRoad(ctx: BakeContext): IndustrialPlan {
  const { track, field } = ctx;
  const main = track.main;
  const n = main.count;
  const sc = field.smoothCurvature[0]!;
  const corner = new Uint8Array(n);
  for (let i = 0; i < n; i++)
    if (Math.abs(sc[i]!) > 0.0042)
      for (let k = -2; k <= 2; k++) corner[(((i + k) % n) + n) % n] = 1;
  const arrows: number[] = [];
  const L = main.length;
  for (let k = 0; k < 40; k++) {
    const s = (track.startS + 300 + k * 380) % L;
    let straight = true;
    for (let u = -60; u <= 60; u += 10) {
      const p = sampleBranch(main, s + u);
      if (Math.abs(sc[p.index]!) > 0.0006) straight = false;
    }
    if (!straight) continue;
    if (track.routeHazards.some((r) => Math.abs(r.s - s) < 160)) continue;
    if (Math.abs(s - track.startS) < 220) continue;
    arrows.push(s);
  }
  return {
    corner,
    lineOffset: new Float32Array(n),
    lineStrength: new Float32Array(n),
    hairpins: [],
    zebras: [],
    arrows,
    cobbleFrom: -1,
    cobbleTo: -1,
  };
}

/** Exact membership of a world point in a hazard shape, as the zone grid stamps it. */
export function shapeTest(ctx: BakeContext, shape: TrackShape): (x: number, y: number) => boolean {
  if (shape.type === 'circle') {
    const r2 = shape.radius * shape.radius;
    return (x, y) => (x - shape.x) ** 2 + (y - shape.y) ** 2 <= r2;
  }
  if (shape.type === 'polygon') {
    const pts = shape.points;
    return (x, y) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i]!;
        const b = pts[j]!;
        if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x)
          inside = !inside;
      }
      return inside;
    };
  }
  // A band: between two arc lengths of a branch, between two lateral offsets.
  const { track } = ctx;
  const bi =
    shape.branch === 'main' ? 0 : ctx.def.shortcuts.findIndex((s) => s.id === shape.branch) + 1;
  const br = track.branches[bi]!;
  const nearestS = (p: { x: number; y: number }): number => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < br.count; i++) {
      const d = (br.x[i]! - p.x) ** 2 + (br.y[i]! - p.y) ** 2;
      if (d < bd) {
        bd = d;
        best = br.s[i]!;
      }
    }
    return best;
  };
  const s0 = nearestS(shape.from);
  const s1 = nearestS(shape.to);
  const L = br.length;
  const [lo, hi] = [
    Math.min(shape.lateral[0], shape.lateral[1]),
    Math.max(shape.lateral[0], shape.lateral[1]),
  ];
  const loc = createLocation();
  return (x, y) => {
    locate(track, x, y, loc);
    if (loc.branch !== bi) return false;
    let u = loc.s - s0;
    let span = s1 - s0;
    if (br.closed) {
      u = ((u % L) + L) % L;
      span = ((span % L) + L) % L;
    }
    return u >= 0 && u <= span && loc.lateral >= lo && loc.lateral <= hi;
  };
}

/** Index of the area hazard whose zone cell holds a pixel, or -1. */
export function hazardCell(ctx: BakeContext, x: number, y: number): number {
  const t = ctx.track;
  if (!t.zoneHazard) return -1;
  const c = Math.floor(x / t.zoneCell);
  const r = Math.floor(y / t.zoneCell);
  if (c < 0 || r < 0 || c >= t.zoneCols || r >= t.zoneRows) return -1;
  return t.zoneHazard[r * t.zoneCols + c]! - 1;
}

/** Smooth noise in -5..5 px, for wandering edges. */
function wobble(x: number, y: number, seed: number): number {
  const cell = 11;
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = x / cell - gx;
  const fy = y / cell - gy;
  const a = hash2(gx, gy, 900 + seed);
  const b = hash2(gx + 1, gy, 900 + seed);
  const c = hash2(gx, gy + 1, 900 + seed);
  const d = hash2(gx + 1, gy + 1, 900 + seed);
  const v = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  return (v - 0.5) * 18;
}

/** Bounding box of a hazard's zone cells, padded by a cell, or null. */
export function zoneBox(
  ctx: BakeContext,
  k: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const t = ctx.track;
  if (!t.zoneHazard) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let r = 0; r < t.zoneRows; r++)
    for (let c = 0; c < t.zoneCols; c++)
      if (t.zoneHazard[r * t.zoneCols + c] === k + 1) {
        x0 = Math.min(x0, c * t.zoneCell);
        y0 = Math.min(y0, r * t.zoneCell);
        x1 = Math.max(x1, (c + 1) * t.zoneCell);
        y1 = Math.max(y1, (r + 1) * t.zoneCell);
      }
  if (x0 > x1) return null;
  return { x0: x0 - t.zoneCell, y0: y0 - t.zoneCell, x1: x1 + t.zoneCell, y1: y1 + t.zoneCell };
}

function asphaltTone(x: number, y: number): Color {
  const row = y >> 1;
  const xo = x + ((hash2(row, 17, SEED) * 6) | 0);
  const h1 = hash2(xo >> 2, row, SEED + 1);
  let c: Color = PAL.asphalt;
  if (h1 < 0.12) c = PAL.asphaltDark;
  else if (h1 > 0.9) c = PAL.asphaltLight;
  if (hash2(x, y, SEED + 2) < 0.008) c = PAL.asphaltSpeck;
  return c;
}

/** Riveted plate: world-aligned panels with seams, rivets at the corners, tread on some. */
function plateTone(x: number, y: number): Color {
  const px = Math.floor(x / 32);
  const py = Math.floor(y / 20);
  const lx = x - px * 32;
  const ly = y - py * 20;
  if (lx === 0 || ly === 0) return IND.plateSeam;
  if (lx === 1 || ly === 1) return IND.plateLight;
  if ((lx === 3 || lx === 29) && (ly === 3 || ly === 17)) return IND.plateRivet;
  const kind = hash2(px, py, SEED + 5);
  if (kind < 0.35) {
    // Diamond tread.
    const d = (lx + ly * 2) % 6;
    const e = (lx - ly * 2 + 600) % 6;
    if (d === 0 || e === 0) return IND.plateTread;
    return IND.plateDark;
  }
  if (kind > 0.88) return hash2(x >> 1, y >> 1, SEED + 6) < 0.12 ? IND.rustDark : IND.plateDark;
  return hash2(x >> 2, y >> 1, SEED + 7) < 0.06 ? IND.plateLight : IND.plate;
}

/** Dock granite in courses across the quay road. */
function graniteTone(x: number, y: number): Color {
  const course = Math.floor(y / 6);
  const xx = x + (course & 1) * 5;
  const stone = Math.floor(xx / 10);
  if (y - course * 6 === 0 || xx - stone * 10 === 0) return PAL.mortar;
  const t = hash2(stone, course, SEED + 9);
  if (y - course * 6 === 1 && t > 0.3) return IND.graniteLight;
  return t < 0.3 ? IND.graniteDark : t > 0.85 ? IND.graniteLight : IND.granite;
}

export function paintIndustrialRoad(ctx: BakeContext, plan: IndustrialPlan): void {
  const { field, track, world, def } = ctx;
  const { w, h, edge, lateral, s: sArr, half, branch, sample, zone, surface } = field;
  const main = track.main;
  const L = main.length;
  const metal = field.surfaces.indexOf('metal');
  const cobble = field.surfaces.indexOf('cobble');
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
  // Area hazards, tested exactly; vents and oil also get their edge noise here.
  const hz = def.hazards.map((hd, k) => {
    const exact = 'shape' in hd ? shapeTest(ctx, hd.shape) : null;
    // Oil pools get an organic edge: the boundary wanders a few pixels either side of the
    // shape the physics stamps, so a band reads as a spill and not as a tarpaulin.
    const inside =
      exact && hd.kind === 'oil'
        ? (x: number, y: number): boolean => exact(x + wobble(x, y, 1), y + wobble(x, y, 2))
        : exact;
    return { h: hd, k, inside, box: zoneBox(ctx, k) };
  });

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
      const k = e + sh;
      const isMain = b === 0;

      if (zone[i] === ZONE_SHOULDER) {
        // Steel tread walkway with a painted edge.
        if (k < 3) {
          if (isMain && plan.corner[si] === 1) {
            const stripe = (Math.floor((ss + Math.abs(lat)) / 8) & 1) === 0;
            put(i, stripe ? IND.hazardYellow : IND.hazardBlack, F_NOSHADOW);
          } else put(i, k < 1 ? IND.hazardYellowDim : PAL.kerbShade);
          continue;
        }
        const d = (x + y * 2) % 5;
        put(i, e > -1.6 ? IND.plateSeam : d === 0 ? IND.plateTread : IND.plateDark);
        continue;
      }

      let c: Color;
      let fl = 0;
      const surf = surface[i]!;
      if (surf === metal) {
        c = plateTone(x, y);
        if (k >= -7 && k < -5) {
          c = IND.hazardYellow;
          fl = F_NOSHADOW;
        }
      } else if (surf === cobble) {
        c = graniteTone(x, y);
        if (k >= -5)
          c = k < -4 ? PAL.mortar : (Math.floor(ss / 9) & 1) === 0 ? PAL.settLight : PAL.sett;
      } else {
        c = asphaltTone(x, y);
        if (k >= -8 && k < -6) {
          c = hash2(x >> 1, y >> 1, SEED + 50) < 0.2 ? IND.hazardYellowDim : IND.hazardYellow;
          fl = F_NOSHADOW;
        }
        if (isMain && lat >= -1.5 && lat < 1.5 && ss % 36 < 16) {
          c = IND.hazardYellow;
          fl = F_NOSHADOW;
        }
      }

      if (isMain) {
        if (plan.corner[si] === 1 && k >= -3) {
          const stripe = (Math.floor((ss + Math.abs(lat)) / 8) & 1) === 0;
          put(i, stripe ? IND.hazardYellow : IND.hazardBlack, F_NOSHADOW);
          continue;
        }
        const us = wrap(ss - track.startS);
        if (us >= -7 && us < 7 && k < -1) {
          const check = (Math.floor((us + 70) / 7) + Math.floor((lat + 700) / 7)) & 1;
          c = check ? PAL.paintBright : PAL.ink;
          fl = F_NOSHADOW;
        }
        const ug = wrap(ss - (track.startS - 46));
        for (const side of [-1, 1]) {
          const av = Math.abs(lat - side * hw * 0.42);
          if (
            ug >= -36 &&
            ug < 35 &&
            av < 25 &&
            ((ug >= 32 && ug < 35) || (av >= 22.5 && ug >= -4))
          ) {
            c = PAL.paintBright;
            fl = F_NOSHADOW;
          }
        }
        for (const as of plan.arrows) {
          const u = wrap(ss - as) + 20;
          if (u < 0 || u >= 40) continue;
          for (const lane of [-0.5, 0.5]) {
            const v = Math.abs(lat - lane * hw);
            if (u < 24 ? v < 2.6 : v < ((40 - u) * 9.5) / 16) {
              c = PAL.paint;
              fl = F_NOSHADOW;
            }
          }
        }
      } else {
        // The shortcut's mouths: a hazard-striped threshold.
        const u = Math.min(ss, br.length - ss);
        if (u >= 48 && u < 54 && k < -2) {
          c = (Math.floor((lat + 400) / 6) & 1) === 0 ? IND.hazardYellow : IND.hazardBlack;
          fl = F_NOSHADOW;
        }
      }

      // Area hazards over everything.
      for (const { h: hd, inside, box } of hz) {
        if (!inside || !box || x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1) continue;
        if (!inside(x + 0.5, y + 0.5)) continue;
        const art = hazardArt(hd, x, y, ss, lat);
        if (art !== null) {
          c = art;
          fl = F_EMISSIVE;
        }
      }
      put(i, c, fl);
    }
  }
  // Oil also gets a noisy lit rim just outside its shape, and grates their ring.
  paintHazardRims(
    ctx,
    hz.filter((q) => q.inside) as Array<{
      h: TrackHazard;
      k: number;
      inside: (x: number, y: number) => boolean;
    }>,
  );
}

function hazardArt(hd: TrackHazard, x: number, y: number, ss: number, lat: number): Color | null {
  if (hd.kind === 'magnetic_strip') {
    // Segmented bars across the road, broken into tiles: the "marked magnetic lane".
    const along = Math.floor(ss) % 10;
    const across = Math.floor(lat + 300) % 16;
    if (across === 0 || across === 15) return IND.magnetEdge;
    if (along < 4) return along === 0 ? IND.magnetHi : IND.magnetBar;
    return (x + y) % 7 === 0 ? IND.magnetEdge : IND.magnetBase;
  }
  if (hd.kind === 'oil') {
    // Gloss: soft diagonal bands of sheen, the lavender of the lamps mirrored in it.
    // Gloss: the lamps mirrored as curling sheen where the spill's surface noise crosses zero.
    const v = wobble(x, y, 7);
    if (Math.abs(v) < 0.7 && hash2(x >> 2, y >> 1, 816) < 0.55)
      return hash2(x, y, 812) < 0.2 ? IND.oilSheenHi : IND.oilSheen;
    if (Math.abs(v - 4) < 0.5) return IND.oilMid;
    return IND.oil;
  }
  if (hd.kind === 'steam_vent' && hd.shape.type === 'circle') {
    const dx = x + 0.5 - hd.shape.x;
    const dy = y + 0.5 - hd.shape.y;
    const r = Math.hypot(dx, dy);
    const R = hd.shape.radius;
    if (r > R - 6) {
      // Yellow and black warning ring.
      const a = Math.atan2(dy, dx);
      return (Math.floor((a / Math.PI) * 10 + 20) & 1) === 0 ? IND.hazardYellow : IND.hazardBlack;
    }
    if (r > R - 8) return IND.grateHi;
    // Radial grate bars over a dark pit.
    const bar = Math.floor(dx + 200) % 5 === 0 || Math.floor(dy + 200) % 5 === 0;
    if (r < 5) return IND.grateBar;
    return bar ? IND.grateBar : IND.grate;
  }
  return null;
}

function paintHazardRims(
  ctx: BakeContext,
  hz: Array<{ h: TrackHazard; k: number; inside: (x: number, y: number) => boolean }>,
): void {
  const { world, field } = ctx;
  for (const { h: hd, inside } of hz) {
    if (hd.kind !== 'oil') continue;
    const box = zoneBox(ctx, hz.find((q) => q.h === hd)!.k);
    if (!box) continue;
    const { x0, y0, x1, y1 } = box;
    for (let y = y0 - 6; y <= y1 + 6; y++)
      for (let x = x0 - 6; x <= x1 + 6; x++) {
        const p = y * field.w + x;
        if (x < 1 || y < 1 || x >= field.w - 1 || y >= field.h - 1 || field.edge[p]! > 0) continue;
        if (inside(x + 0.5, y + 0.5)) {
          // The pool's own lit rim on its north-west edge, a highlight streak inside.
          if (!inside(x - 0.5, y - 0.5)) {
            world.curFlags = F_EMISSIVE;
            world.set(x, y, IND.oilRim);
          } else if (!inside(x - 2.5, y - 2.5) && hash2(x, y, 815) < 0.5) {
            world.curFlags = F_EMISSIVE;
            world.set(x, y, IND.oilSheenHi);
          }
        }
      }
    world.curFlags = 0;
  }
  void sampleBranch;
}
