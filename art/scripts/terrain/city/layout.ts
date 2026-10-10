import { mulberry32 } from '@bolt/shared';
import type { BakeContext } from '../biome.js';
import { ROOF_WEIGHTS } from './palette.js';
import { WALL_OUT } from './road.js';

/**
 * City plan outside the corridor: a recursive street grid, blocks, and rectangular building
 * lots aligned to the world axes. Lots are clipped by the corridor wall, so buildings follow
 * the street line on curves without ever intruding on drivable space.
 */

export const G_STREET = 1;
export const G_YARD = 2;
export const G_PARK = 3;
export const G_PARKING = 4;
export const G_PLAZA = 5;
export const G_WATER = 6;
export const G_QUAY = 7;

export type Rect = { x: number; y: number; w: number; h: number };

export type Lot = Rect & {
  id: number;
  family: number;
  /** Cast shadow length in pixels. */
  height: number;
  seed: number;
  /** Corner notch removed from the rectangle, making an L-shaped roof. */
  cut: Rect | null;
  /** Number of pixels that survived clipping. */
  visible: number;
  /** Smallest corridor edge distance seen on the roof: how close it sits to the track. */
  roadDist: number;
  tag: string;
  round: boolean;
};

export type Block = Rect & { kind: number; seed: number };
export type Street = Rect & { horizontal: boolean };
export type Reserve = Rect & { ground: number };
export type FixedLot = Rect & { family: number; height: number; tag: string; round?: boolean };

export type CityLayout = {
  w: number;
  h: number;
  ground: Uint8Array;
  roofId: Uint16Array;
  /** Indexed by id; entry 0 is unused. */
  lots: Array<Lot | null>;
  blocks: Block[];
  streets: Street[];
};

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function buildLayout(ctx: BakeContext, reserves: readonly Reserve[], fixed: readonly FixedLot[]): CityLayout {
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
    for (let y = Math.max(0, r.y); y < y1; y++) ground.fill(kind, y * w + Math.max(0, r.x), y * w + x1);
  };
  const addLot = (r: Rect, family: number, height: number, cut: Rect | null, tag = '', round = false): Lot => {
    const lot: Lot = { ...r, id: lots.length, family, height, seed: (rnd() * 0x7fffffff) | 0, cut, visible: 0, roadDist: 999, tag, round };
    lots.push(lot);
    return lot;
  };
  const even = (v: number): number => Math.round(v / 2) * 2;

  const splitLot = (r: Rect, family: number, depth: number): void => {
    const big = Math.max(r.w, r.h);
    const small = Math.min(r.w, r.h);
    const mustSplit = big > 150 || (big > 96 && small > 96);
    const maySplit = big >= 56 && r.w * r.h > 2600 && rnd() < 0.72;
    if ((mustSplit || maySplit) && big >= 52) {
      const horizontal = r.w === r.h ? rnd() < 0.5 : r.w > r.h;
      const span = horizontal ? r.w : r.h;
      const gap = [0, 0, 0, 0, 2, 4, 6][(rnd() * 7) | 0]!;
      const cutAt = even(Math.max(24, Math.min(span - 24 - gap, span * (0.3 + rnd() * 0.4))));
      // Neighbors usually keep the block's material; sometimes a different building moves in.
      const fam2 = rnd() < 0.34 ? ROOF_WEIGHTS[(rnd() * ROOF_WEIGHTS.length) | 0]! : family;
      if (horizontal) {
        splitLot({ x: r.x, y: r.y, w: cutAt, h: r.h }, family, depth + 1);
        splitLot({ x: r.x + cutAt + gap, y: r.y, w: r.w - cutAt - gap, h: r.h }, fam2, depth + 1);
      } else {
        splitLot({ x: r.x, y: r.y, w: r.w, h: cutAt }, family, depth + 1);
        splitLot({ x: r.x, y: r.y + cutAt + gap, w: r.w, h: r.h - cutAt - gap }, fam2, depth + 1);
      }
      return;
    }
    if (r.w < 14 || r.h < 14) return;
    const height = rnd() < 0.08 ? 15 + ((rnd() * 5) | 0) : 4 + ((rnd() * 9) | 0);
    let cut: Rect | null = null;
    if (r.w >= 56 && r.h >= 56 && rnd() < 0.34) {
      const cw = even(r.w * (0.3 + rnd() * 0.22));
      const ch = even(r.h * (0.3 + rnd() * 0.22));
      const corner = (rnd() * 4) | 0;
      cut = { x: corner & 1 ? r.x + r.w - cw : r.x, y: corner & 2 ? r.y + r.h - ch : r.y, w: cw, h: ch };
      if (rnd() < 0.62) {
        // The notch holds a lower annex rather than an open yard.
        addLot(cut, rnd() < 0.5 ? family : ROOF_WEIGHTS[(rnd() * ROOF_WEIGHTS.length) | 0]!, Math.max(3, height - 3 - ((rnd() * 3) | 0)), null);
      }
    }
    addLot(r, family, height, cut);
  };

  const makeBlock = (r: Rect): void => {
    const hitsReserve = reserves.some((rv) => overlaps(rv, r));
    const roll = rnd();
    const roomy = r.w >= 110 && r.h >= 96;
    let kind = G_YARD;
    if (!hitsReserve && roomy) {
      if (roll < 0.075) kind = G_PARK;
      else if (roll < 0.15) kind = G_PARKING;
      else if (roll < 0.175) kind = G_PLAZA;
    }
    fillGround(r, kind);
    blocks.push({ ...r, kind, seed: (rnd() * 0x7fffffff) | 0 });
    if (kind === G_YARD) splitLot(r, ROOF_WEIGHTS[(rnd() * ROOF_WEIGHTS.length) | 0]!, 0);
  };

  const splitRegion = (r: Rect, depth: number): void => {
    const big = Math.max(r.w, r.h);
    if (big > 300 || (big > 210 && rnd() < 0.55)) {
      const gap = depth < 2 ? 26 : depth < 4 ? 18 : 12;
      const horizontal = r.w > r.h;
      const span = horizontal ? r.w : r.h;
      const cutAt = even(span * (0.36 + rnd() * 0.28));
      if (horizontal) streets.push({ x: r.x + cutAt - gap / 2, y: r.y, w: gap, h: r.h, horizontal: false });
      else streets.push({ x: r.x, y: r.y + cutAt - gap / 2, w: r.w, h: gap, horizontal: true });
      if (horizontal) {
        splitRegion({ x: r.x, y: r.y, w: cutAt - gap / 2, h: r.h }, depth + 1);
        splitRegion({ x: r.x + cutAt + gap / 2, y: r.y, w: r.w - cutAt - gap / 2, h: r.h }, depth + 1);
      } else {
        splitRegion({ x: r.x, y: r.y, w: r.w, h: cutAt - gap / 2 }, depth + 1);
        splitRegion({ x: r.x, y: r.y + cutAt + gap / 2, w: r.w, h: r.h - cutAt - gap / 2 }, depth + 1);
      }
      return;
    }
    makeBlock(r);
  };
  splitRegion({ x: -6, y: -6, w: w + 12, h: h + 12 }, 0);

  for (const rv of reserves) fillGround(rv, rv.ground);
  const fixedIds = new Set<number>();
  for (const f of fixed) fixedIds.add(addLot(f, f.family, f.height, null, f.tag, f.round ?? false).id);

  // Rasterize, clipping against the corridor wall.
  for (const lot of lots) {
    if (!lot) continue;
    const isFixed = fixedIds.has(lot.id);
    if (!isFixed && reserves.some((rv) => overlaps(rv, lot))) continue;
    const x1 = Math.min(w, lot.x + lot.w);
    const y1 = Math.min(h, lot.y + lot.h);
    const cx = lot.x + lot.w / 2;
    const cy = lot.y + lot.h / 2;
    const rr = (Math.min(lot.w, lot.h) / 2) * (Math.min(lot.w, lot.h) / 2);
    for (let y = Math.max(0, lot.y); y < y1; y++) {
      for (let x = Math.max(0, lot.x); x < x1; x++) {
        const i = y * w + x;
        const e = field.edge[i]!;
        if (e <= WALL_OUT) continue;
        if (lot.cut && x >= lot.cut.x && x < lot.cut.x + lot.cut.w && y >= lot.cut.y && y < lot.cut.y + lot.cut.h) continue;
        if (lot.round && (x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - cy) * (y + 0.5 - cy) > rr) continue;
        roofId[i] = lot.id;
        lot.visible++;
        if (e < lot.roadDist) lot.roadDist = e;
      }
    }
  }
  // Drop slivers: a roof that lost most of itself to the road becomes open yard.
  const drop = new Uint8Array(lots.length);
  for (const lot of lots) {
    if (!lot || fixedIds.has(lot.id)) continue;
    const area = lot.w * lot.h - (lot.cut ? lot.cut.w * lot.cut.h : 0);
    if (lot.visible < 220 || lot.visible < area * 0.3) drop[lot.id] = 1;
  }
  for (let i = 0; i < w * h; i++) {
    const id = roofId[i]!;
    if (id && drop[id]) {
      roofId[i] = 0;
      ground[i] = G_YARD;
    }
  }
  for (const lot of lots) if (lot && drop[lot.id]) lot.visible = 0;
  return { w, h, ground, roofId, lots, blocks, streets };
}
