import { mulberry32 } from '@bolt/shared';
import type { BakeContext } from '../biome.js';
import type { Scene } from '../oblique.js';
import { ROOF_WEIGHTS } from './palette.js';

/**
 * City plan outside the corridor: a recursive street grid, blocks, and rectangular building
 * lots aligned to the world axes. Every lot is a clean rectangle that stays clear of the
 * corridor. Lots on the far (north) bank of a road are pulled down to the collision edge so
 * their facades form the wall; lots on the near (south) bank are pushed back until neither
 * their roof nor a car parked against the edge can overlap them on screen.
 */

export const G_STREET = 1;
export const G_YARD = 2;
export const G_PARK = 3;
export const G_PARKING = 4;
export const G_PLAZA = 5;
export const G_WATER = 6;
export const G_QUAY = 7;

/** Depth of the strip south of a road in which nothing tall may stand or appear. */
export const NEAR_STRIP = 24;
/** Screen height of a ground floor and of each further storey. */
export const FLOOR_0 = 18;
export const FLOOR_N = 10;

/** Shift of the storey roll per roof family: slate, teal, maroon, plum, olive, concrete. */
const FAMILY_HEIGHT_BIAS: readonly number[] = [0.12, -0.24, 0.04, 0, -0.14, 0.1];

export type Rect = { x: number; y: number; w: number; h: number };

export type Lot = Rect & {
  id: number;
  family: number;
  /** Screen rise of the roof above the ground, in pixels. */
  rise: number;
  floors: number;
  seed: number;
  /** Rows of open ground between the facade and drivable ground to the south; 999 if none. */
  front: number;
  /** Smallest corridor edge distance on the footprint: how close it sits to the track. */
  roadDist: number;
  tag: string;
};

export type Block = Rect & { kind: number; seed: number };
export type Street = Rect & { horizontal: boolean };
export type Reserve = Rect & { ground: number };
export type FixedLot = Rect & { family: number; rise: number; tag: string };

export type CityLayout = {
  w: number;
  h: number;
  ground: Uint8Array;
  roofId: Uint16Array;
  /** Indexed by id; entry 0 is unused. Dropped lots are null. */
  lots: Array<Lot | null>;
  blocks: Block[];
  streets: Street[];
};

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function riseForFloors(floors: number): number {
  return FLOOR_0 + (floors - 1) * FLOOR_N + 1;
}

export function buildLayout(
  ctx: BakeContext,
  scene: Scene,
  reserves: readonly Reserve[],
  fixed: readonly FixedLot[],
): CityLayout {
  const { field } = ctx;
  const { w, h } = field;
  const rnd = mulberry32(ctx.seed ^ 0xc17a);
  const ground = new Uint8Array(w * h).fill(G_STREET);
  const roofId = new Uint16Array(w * h);
  const lots: Array<Lot | null> = [null];
  const blocks: Block[] = [];
  const streets: Street[] = [];
  const fillGround = (r: Rect, kind: number): void => {
    const x1 = Math.min(w, r.x + r.w);
    const y1 = Math.min(h, r.y + r.h);
    for (let y = Math.max(0, r.y); y < y1; y++)
      ground.fill(kind, y * w + Math.max(0, r.x), y * w + x1);
  };
  const even = (v: number): number => Math.round(v / 2) * 2;

  // Pixels a roof must not stand on: the corridor itself plus a side margin, so the barrier
  // along a north-south road stays visible beside the roofs.
  const SIDE = 6;
  const bad = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -999;
    for (let x = 0; x < w; x++) {
      if (field.edge[y * w + x]! <= 1) last = x;
      if (x - last <= SIDE) bad[y * w + x] = 1;
    }
    last = 99999;
    for (let x = w - 1; x >= 0; x--) {
      if (field.edge[y * w + x]! <= 1) last = x;
      if (last - x <= SIDE) bad[y * w + x] = 1;
    }
  }
  const badIn = (r: Rect): Rect | null => {
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (let y = Math.max(0, r.y); y < Math.min(h, r.y + r.h); y++) {
      for (let x = Math.max(0, r.x); x < Math.min(w, r.x + r.w); x++) {
        if (!bad[y * w + x]) continue;
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
    }
    return bx1 < bx0 ? null : { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 };
  };
  /** Cuts a rectangle back to its largest part that is clear of the corridor. */
  const trim = (r0: Rect): Rect | null => {
    let r: Rect = {
      x: Math.max(0, r0.x),
      y: Math.max(0, r0.y),
      w: Math.min(w, r0.x + r0.w) - Math.max(0, r0.x),
      h: Math.min(h, r0.y + r0.h) - Math.max(0, r0.y),
    };
    for (let pass = 0; pass < 8; pass++) {
      if (r.w < 20 || r.h < 14) return null;
      const b = badIn(r);
      if (!b) return r;
      const options: Rect[] = [
        { x: r.x, y: r.y, w: b.x - r.x, h: r.h },
        { x: b.x + b.w, y: r.y, w: r.x + r.w - b.x - b.w, h: r.h },
        { x: r.x, y: r.y, w: r.w, h: b.y - r.y },
        { x: r.x, y: b.y + b.h, w: r.w, h: r.y + r.h - b.y - b.h },
      ];
      let best = options[0]!;
      for (const o of options) if (o.w * o.h > best.w * best.h) best = o;
      r = best;
    }
    return null;
  };

  const candidates: Array<{ r: Rect; family: number }> = [];
  const splitLot = (r: Rect, family: number, depth: number): void => {
    const big = Math.max(r.w, r.h);
    const small = Math.min(r.w, r.h);
    const mustSplit = big > 150 || (big > 96 && small > 96);
    const maySplit = big >= 60 && r.w * r.h > 2800 && rnd() < 0.7;
    if ((mustSplit || maySplit) && big >= 56) {
      const horizontal = r.w === r.h ? rnd() < 0.5 : r.w > r.h;
      const span = horizontal ? r.w : r.h;
      const gap = [0, 0, 0, 0, 2, 4, 8][(rnd() * 7) | 0]!;
      const cutAt = even(Math.max(26, Math.min(span - 26 - gap, span * (0.3 + rnd() * 0.4))));
      // Neighbors usually keep the block's material; sometimes a different building moves in.
      const fam2 = rnd() < 0.4 ? ROOF_WEIGHTS[(rnd() * ROOF_WEIGHTS.length) | 0]! : family;
      if (horizontal) {
        splitLot({ x: r.x, y: r.y, w: cutAt, h: r.h }, family, depth + 1);
        splitLot({ x: r.x + cutAt + gap, y: r.y, w: r.w - cutAt - gap, h: r.h }, fam2, depth + 1);
      } else {
        splitLot({ x: r.x, y: r.y, w: r.w, h: cutAt }, family, depth + 1);
        splitLot({ x: r.x, y: r.y + cutAt + gap, w: r.w, h: r.h - cutAt - gap }, fam2, depth + 1);
      }
      return;
    }
    if (r.w < 20 || r.h < 14) return;
    candidates.push({ r, family });
  };

  const makeBlock = (r: Rect): void => {
    const hitsReserve = reserves.some((rv) => overlaps(rv, r));
    const roll = rnd();
    const roomy = r.w >= 110 && r.h >= 96;
    let kind = G_YARD;
    if (!hitsReserve && roomy) {
      if (roll < 0.085) kind = G_PARK;
      else if (roll < 0.16) kind = G_PARKING;
      else if (roll < 0.185) kind = G_PLAZA;
    }
    fillGround(r, kind);
    blocks.push({ ...r, kind, seed: (rnd() * 0x7fffffff) | 0 });
    if (kind === G_YARD) splitLot(r, ROOF_WEIGHTS[(rnd() * ROOF_WEIGHTS.length) | 0]!, 0);
  };

  const splitRegion = (r: Rect, depth: number): void => {
    const big = Math.max(r.w, r.h);
    if (big > 300 || (big > 210 && rnd() < 0.55)) {
      const horizontal = r.w > r.h;
      // East-west streets are wider: the roofs south of them lean over them on screen.
      const gap = horizontal
        ? depth < 2
          ? 30
          : depth < 4
            ? 22
            : 16
        : depth < 2
          ? 46
          : depth < 4
            ? 38
            : 30;
      const span = horizontal ? r.w : r.h;
      const cutAt = even(span * (0.36 + rnd() * 0.28));
      if (horizontal)
        streets.push({ x: r.x + cutAt - gap / 2, y: r.y, w: gap, h: r.h, horizontal: false });
      else streets.push({ x: r.x, y: r.y + cutAt - gap / 2, w: r.w, h: gap, horizontal: true });
      if (horizontal) {
        splitRegion({ x: r.x, y: r.y, w: cutAt - gap / 2, h: r.h }, depth + 1);
        splitRegion(
          { x: r.x + cutAt + gap / 2, y: r.y, w: r.w - cutAt - gap / 2, h: r.h },
          depth + 1,
        );
      } else {
        splitRegion({ x: r.x, y: r.y, w: r.w, h: cutAt - gap / 2 }, depth + 1);
        splitRegion(
          { x: r.x, y: r.y + cutAt + gap / 2, w: r.w, h: r.h - cutAt - gap / 2 },
          depth + 1,
        );
      }
      return;
    }
    makeBlock(r);
  };
  splitRegion({ x: -6, y: -6, w: w + 12, h: h + 12 }, 0);
  for (const rv of reserves) fillGround(rv, rv.ground);

  const paintId = (r: Rect, id: number): void => {
    for (let y = Math.max(0, r.y); y < Math.min(h, r.y + r.h); y++)
      roofId.fill(id, y * w + Math.max(0, r.x), y * w + Math.min(w, r.x + r.w));
  };
  const addLot = (r: Rect, family: number, rise: number, floors: number, tag: string): Lot => {
    const lot: Lot = {
      ...r,
      id: lots.length,
      family,
      rise,
      floors,
      seed: (rnd() * 0x7fffffff) | 0,
      front: 999,
      roadDist: 999,
      tag,
    };
    lots.push(lot);
    paintId(lot, lot.id);
    return lot;
  };

  for (const f of fixed) addLot(f, f.family, f.rise, 1, f.tag);
  const fixedCount = lots.length;
  for (const c of candidates) {
    if (reserves.some((rv) => overlaps(rv, c.r))) continue;
    const r = trim(c.r);
    if (!r) continue;
    // Something fixed may already stand here.
    let taken = false;
    for (let y = r.y; y < r.y + r.h && !taken; y += 4)
      for (let x = r.x; x < r.x + r.w; x += 4) if (roofId[y * w + x]) taken = true;
    if (taken) continue;
    addLot(r, c.family, 0, 0, '');
  }

  // Pull lots toward the corridor so the street wall is continuous.
  const freeFor = (x: number, y: number, id: number): boolean => {
    const i = y * w + x;
    return (roofId[i] === 0 || roofId[i] === id) && ground[i] === G_YARD;
  };
  for (let id = fixedCount; id < lots.length; id++) {
    const lot = lots[id]!;
    // South, onto a north bank.
    let hit = 0;
    for (let k = 1; k <= 54 && hit === 0; k++) {
      const y = lot.y + lot.h - 1 + k;
      if (y >= h) break;
      let blocked = false;
      for (let x = lot.x; x < lot.x + lot.w; x++) {
        if (bad[y * w + x]) hit = k;
        else if (!freeFor(x, y, id)) blocked = true;
      }
      if (blocked && hit === 0) break;
    }
    if (hit > 1) lot.h += hit - 1;
    // West and east, up to the side margin.
    for (const dir of [-1, 1]) {
      let reach = 0;
      for (let k = 1; k <= 30 && reach === 0; k++) {
        const x = dir < 0 ? lot.x - k : lot.x + lot.w - 1 + k;
        if (x < 0 || x >= w) break;
        let blocked = false;
        for (let y = lot.y; y < lot.y + lot.h; y++) {
          if (bad[y * w + x]) reach = k;
          else if (!freeFor(x, y, id)) blocked = true;
        }
        if (blocked && reach === 0) break;
      }
      if (reach > 1) {
        if (dir < 0) lot.x -= reach - 1;
        lot.w += reach - 1;
      }
    }
    paintId(lot, id);
  }

  // Heights, and the near-bank rule.
  for (let id = fixedCount; id < lots.length; id++) {
    const lot = lots[id]!;
    const area = lot.w * lot.h;
    // Each family has its own habit: offices and tenements climb, sheds and workshops stay low.
    const roll = Math.min(0.999, Math.max(0, rnd() + (FAMILY_HEIGHT_BIAS[lot.family] ?? 0)));
    let floors = roll < 0.3 ? 1 : roll < 0.68 ? 2 : roll < 0.9 ? 3 : 4;
    if (lot.w < 30) floors = Math.min(floors, 2);
    if (area > 9000) floors = Math.min(floors, 3);
    if (area > 14000) floors = Math.min(floors, 2);
    let gap = 255;
    for (let x = lot.x; x < lot.x + lot.w; x++) gap = Math.min(gap, scene.clearN[lot.y * w + x]!);
    if (gap < 200) {
      // A road lies to the north: step the building back, lower it, or give the lot up.
      let need = riseForFloors(floors) + NEAR_STRIP - gap;
      while (need > 0 && lot.h - need < 20 && floors > 1) {
        floors--;
        need = riseForFloors(floors) + NEAR_STRIP - gap;
      }
      if (need > 0) {
        if (lot.h - need < 16) {
          paintId(lot, 0);
          lots[id] = null;
          continue;
        }
        paintId(lot, 0);
        lot.y += need;
        lot.h -= need;
        paintId(lot, id);
      }
    }
    lot.floors = floors;
    lot.rise = riseForFloors(floors);
  }

  for (const lot of lots) {
    if (!lot) continue;
    for (let y = lot.y; y < lot.y + lot.h; y += 2) {
      for (let x = lot.x; x < lot.x + lot.w; x += 2) {
        const e = field.edge[Math.min(h - 1, y) * w + Math.min(w - 1, x)]!;
        if (e < lot.roadDist) lot.roadDist = e;
      }
    }
    const sy = lot.y + lot.h;
    for (let x = lot.x; x < lot.x + lot.w; x++) {
      for (let k = 0; k < 40; k++) {
        const y = sy + k;
        if (y >= h) break;
        if (scene.drive[y * w + x]) {
          if (k < lot.front) lot.front = k;
          break;
        }
      }
    }
  }
  return { w, h, ground, roofId, lots, blocks, streets };
}
