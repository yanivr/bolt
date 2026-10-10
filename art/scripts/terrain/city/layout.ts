import { mulberry32 } from '@bolt/shared';
import type { BakeContext } from '../biome.js';
import type { Scene } from '../oblique.js';
import { ROOF_WEIGHTS } from './palette.js';

/**
 * City plan outside the corridor: a recursive street grid, blocks, and rectangular building
 * lots aligned to the world axes. Every lot is a clean rectangle that stays clear of the
 * corridor. Lots on the far (north) bank of a road are pulled down to the collision edge so
 * their facades form the wall. Lots south or west of a road, whose mass would rise or lean
 * toward it on screen, are cut back and capped until nothing they carry can reach the road or
 * the strip beside it that a car is drawn across.
 *
 * Heights are planned block by block so that the city reads as built mass and not as a carpet
 * of roofs: inside a block each lot stands taller than the neighbor built against its south
 * side, yards and alleys open up walls, and a few lots carry a tower.
 */

export const G_STREET = 1;
export const G_YARD = 2;
export const G_PARK = 3;
export const G_PARKING = 4;
export const G_PLAZA = 5;
export const G_WATER = 6;
export const G_QUAY = 7;

/** Screen height of a ground floor, of each further storey, and of the cornice above them. */
export const FLOOR_0 = 18;
export const FLOOR_N = 12;
export const CORNICE = 3;
/** Most storeys an ordinary building has; towers add more on a set-back shaft. */
export const MAX_FLOORS = 7;

/** Shift of the storey roll per roof family: slate, teal, maroon, plum, olive, concrete. */
const FAMILY_HEIGHT_BIAS: readonly number[] = [0.5, -0.9, 0.1, 0, -0.5, 0.4];

export type Rect = { x: number; y: number; w: number; h: number };

export type Lot = Rect & {
  id: number;
  family: number;
  /** Screen rise of the tallest roof above the ground, in pixels. */
  rise: number;
  /** Storeys of the main body. */
  floors: number;
  /** Further storeys on a set-back tower shaft; 0 for most buildings. */
  tower: number;
  /** Tallest any mass on the full footprint may be without leaning over drivable ground. */
  cap: number;
  seed: number;
  /** Rows of open ground between the facade and drivable ground to the south; 999 if none. */
  front: number;
  /** Smallest corridor edge distance on the footprint: how close it sits to the track. */
  roadDist: number;
  tag: string;
};

export type Block = Rect & { kind: number; seed: number };
/** Gap to the next roof south of a lot beyond which its south wall counts as open to view. */
const OPEN_FRONT = 12;
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
  return FLOOR_0 + (floors - 1) * FLOOR_N + CORNICE;
}

/** Storeys that fit under a rise. */
export function floorsForRise(rise: number): number {
  return Math.max(0, Math.floor((rise - CORNICE - FLOOR_0) / FLOOR_N) + 1);
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
      const gap = [0, 0, 0, 2, 4, 6, 10, 14][(rnd() * 8) | 0]!;
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
      tower: 0,
      cap: rise,
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

  const measure = (lot: Lot): void => {
    lot.roadDist = 999;
    lot.front = 999;
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
  };

  // Footprints. Away from the track some lots give up a strip for a yard or an alley, which
  // opens the wall behind it to view. Then every lot is cut back until at least one storey can
  // stand on it without leaning over the road, and two where there is depth to spare.
  const ONE = riseForFloors(1);
  const TWO = riseForFloors(2);
  for (let id = fixedCount; id < lots.length; id++) {
    const lot = lots[id]!;
    measure(lot);
    paintId(lot, 0);
    if (lot.roadDist > 30) {
      if (lot.h >= 44 && rnd() < 0.4) lot.h -= 6 + ((rnd() * 4) | 0) * 4;
      if (lot.w >= 40 && rnd() < 0.3) {
        const cut = 4 + ((rnd() * 3) | 0) * 2;
        if (rnd() < 0.5) lot.x += cut;
        lot.w -= cut;
      }
    }
    let cap = scene.maxRise(lot.x, lot.y, lot.w, lot.h, 255);
    let guard = 0;
    while (cap < TWO && guard++ < 40) {
      const north = lot.h >= 24 ? scene.maxRise(lot.x, lot.y + 4, lot.w, lot.h - 4, 255) : -1;
      const east = lot.w >= 28 ? scene.maxRise(lot.x, lot.y, lot.w - 4, lot.h, 255) : -1;
      if (north < 0 && east < 0) break;
      // One storey will do when the lot has no more depth to give.
      if (cap >= ONE && Math.max(north, east) <= cap && lot.h < 40) break;
      if (north >= east) {
        lot.y += 4;
        lot.h -= 4;
        cap = north;
      } else {
        lot.w -= 4;
        cap = east;
      }
    }
    if (cap < ONE || lot.w < 20 || lot.h < 16) {
      lots[id] = null;
      continue;
    }
    lot.cap = cap;
    paintId(lot, id);
    measure(lot);
  }

  // Heights. Lots are taken from the south of the map to the north. A lot whose south wall is
  // open to a road or a street chooses freely; a lot with a neighbor built up against its south
  // side is made taller than that neighbor, so that inside a block the walls stack up into view
  // one behind the other instead of hiding behind a carpet of roofs.
  const order: Lot[] = [];
  for (let id = fixedCount; id < lots.length; id++) if (lots[id]) order.push(lots[id]!);
  order.sort((a, b) => b.y + b.h - (a.y + a.h) || a.x - b.x || a.id - b.id);
  for (const lot of order) {
    const sy = lot.y + lot.h;
    // What stands south of this lot, and how much of its wall each neighbor would hide.
    let need = 0;
    let blockedCols = 0;
    const seen = new Set<number>();
    for (let x = lot.x + 2; x < lot.x + lot.w - 2; x += 3) {
      for (let k = 0; k <= OPEN_FRONT; k++) {
        const y = sy + k;
        if (y >= h) break;
        const other = roofId[y * w + x]!;
        if (other === 0 || other === lot.id) continue;
        blockedCols++;
        if (seen.has(other)) break;
        seen.add(other);
        const o = lots[other]!;
        if (o.tag) break;
        const overlap = Math.min(o.x + o.w, lot.x + lot.w) - Math.max(o.x, lot.x);
        if (overlap >= Math.min(18, lot.w * 0.4)) need = Math.max(need, o.rise - k);
        break;
      }
    }
    const open = blockedCols * 3 < lot.w * 0.4;
    const bias = FAMILY_HEIGHT_BIAS[lot.family] ?? 0;
    const roll = rnd();
    let floors: number;
    if (lot.front <= 12) {
      // Facing the track: the showpiece walls. Mostly three to five storeys.
      floors = Math.round(2.6 + roll * 2.6 + bias);
    } else if (open) {
      floors = Math.round(1.1 + roll * roll * 2.8 + bias);
    } else {
      // Rise far enough above the neighbor in front to show a storey or two of wall.
      const show = FLOOR_N + 2 + ((rnd() * 3) | 0) * 6;
      floors = Math.max(Math.round(1.4 + roll * 2 + bias), floorsForRise(need + show) + 1);
      // Deep in a block the climb levels off, so a few tall roofs stay the exception.
      if (floors > 5 && rnd() < 0.6) floors = 5;
    }
    const area = lot.w * lot.h;
    if (lot.w < 26) floors = Math.min(floors, 4);
    if (area > 12000) floors = Math.min(floors, 4);
    floors = Math.max(1, Math.min(MAX_FLOORS, floors, floorsForRise(lot.cap)));
    lot.floors = floors;
    lot.rise = riseForFloors(floors);
    // A few lots carry a tower: a slim shaft set back on the main body.
    const roomy = lot.w >= 44 && lot.h >= 40 && area <= 9000;
    const tall = floorsForRise(lot.cap) - floors;
    if (roomy && floors >= 3 && tall >= 3 && lot.roadDist > 24 && rnd() < 0.1) {
      lot.tower = Math.min(tall, 3 + ((rnd() * 4) | 0));
      lot.rise = riseForFloors(floors + lot.tower);
    }
  }

  return { w, h, ground, roofId, lots, blocks, streets };
}
