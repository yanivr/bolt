import { hash2, mulberry32 } from '@bolt/shared';
import type { BakeContext } from '../biome.js';
import type { Color } from '../canvas.js';
import type { LightPool } from '../lighting.js';
import type { Block, CityLayout } from './layout.js';
import { G_PARK, G_PARKING, G_PLAZA, G_QUAY, G_STREET, G_WATER, G_YARD } from './layout.js';
import { LIVERIES, PAL, TINT_CYAN, TINT_GOLD, TINT_WARM } from './palette.js';
import { WALL_OUT } from './road.js';
import { box, emissive, lampHead, parkedCar, tree } from './sprites.js';

/** Everything at ground level behind the walls: side streets, yards, parks, lots, plazas. */

const SEED = 8101;

function groundTone(kind: number, x: number, y: number): Color {
  switch (kind) {
    case G_STREET: {
      const hsh = hash2((x + ((y >> 1) & 1) * 2) >> 2, y >> 1, SEED);
      return hsh < 0.12 ? PAL.streetDark : PAL.street;
    }
    case G_PARK: {
      const hsh = hash2((x + (y >> 2)) >> 1, y >> 1, SEED + 1);
      return hsh < 0.16 ? PAL.grassDark : hsh > 0.86 ? PAL.grassLight : PAL.grass;
    }
    case G_PARKING: {
      const hsh = hash2(x >> 2, y >> 1, SEED + 2);
      return hsh < 0.1 ? PAL.streetDark : hsh > 0.93 ? PAL.yardAlt : PAL.yard;
    }
    case G_PLAZA: {
      const tx = Math.floor(x / 10);
      const ty = Math.floor(y / 10);
      if (x - tx * 10 === 0 || y - ty * 10 === 0) return PAL.plazaLine;
      return ((tx + ty) & 1) === 0 ? PAL.plaza : PAL.plazaAlt;
    }
    case G_QUAY: {
      const tx = Math.floor(x / 24);
      const ty = Math.floor(y / 24);
      if (x - tx * 24 === 0 || y - ty * 24 === 0) return PAL.streetDark;
      const hsh = hash2(x >> 2, y >> 1, SEED + 3);
      return hsh < 0.08 ? PAL.yard : hsh > 0.95 ? PAL.plaza : PAL.yardAlt;
    }
    case G_WATER: {
      // Short wave glints in staggered rows; mostly dark so the quay edge stays the read.
      const row = y >> 1;
      const xo = x + ((hash2(row, 3, SEED + 4) * 24) | 0);
      // Long low swells: dark streaks a dozen pixels wide, two rows tall.
      const swell = hash2(Math.floor(xo / 14), y >> 2, SEED + 6);
      const sx = xo % 14;
      let c: Color = swell < 0.2 && sx < 11 && (y & 3) < 2 ? PAL.waterDeep : PAL.water;
      const cell = xo >> 3;
      const hsh = hash2(cell, row, SEED + 5);
      const lx = xo & 7;
      if ((y & 1) === 0) {
        if (hsh < 0.085 && lx < 5) c = PAL.waterLight;
        else if (hsh > 0.975 && lx < 3) c = PAL.waterGlint;
        else if (hsh > 0.9715 && hsh <= 0.975 && lx === 1) c = PAL.waterSpark;
      }
      return c;
    }
    default: {
      const tx = Math.floor(x / 8);
      const ty = Math.floor(y / 8);
      if ((x - tx * 8 === 0 || y - ty * 8 === 0) && hash2(tx, ty, SEED + 8) < 0.55)
        return PAL.streetDark;
      const hsh = hash2(x >> 1, y >> 1, SEED + 7);
      return hsh < 0.1 ? PAL.yardAlt : PAL.yard;
    }
  }
}

export function paintGround(ctx: BakeContext, layout: CityLayout, pools: LightPool[]): void {
  const { world, field } = ctx;
  const { w, h } = field;
  const data = world.data;
  for (let i = 0; i < w * h; i++) {
    if (field.edge[i]! <= WALL_OUT) continue;
    const c = groundTone(layout.ground[i]!, i % w, (i / w) | 0);
    const o = i * 4;
    data[o] = (c >> 16) & 255;
    data[o + 1] = (c >> 8) & 255;
    data[o + 2] = c & 255;
    data[o + 3] = 255;
  }

  // Everything below draws only on open ground: never on roofs, never inside the corridor.
  const open = (x: number, y: number, kind: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const i = y * w + x;
    return field.edge[i]! > WALL_OUT + 1 && layout.roofId[i] === 0 && layout.ground[i] === kind;
  };
  const clear = (x: number, y: number, bw: number, bh: number, kind: number): boolean =>
    open(x, y, kind) &&
    open(x + bw - 1, y, kind) &&
    open(x, y + bh - 1, kind) &&
    open(x + bw - 1, y + bh - 1, kind) &&
    open(x + (bw >> 1), y + (bh >> 1), kind);

  // Side streets: a faint center line and narrow footways so they read as streets, quietly.
  for (const st of layout.streets) {
    const wide = Math.min(st.w, st.h);
    if (wide < 16) continue;
    if (st.horizontal) {
      const cy = st.y + (st.h >> 1);
      for (let x = st.x; x < st.x + st.w; x++) {
        if (open(x, cy, G_STREET) && ((x >> 3) & 3) < 2) world.set(x, cy, PAL.streetMark);
        for (const yy of [st.y, st.y + 1, st.y + st.h - 2, st.y + st.h - 1])
          if (open(x, yy, G_STREET))
            world.set(x, yy, yy === st.y + 1 || yy === st.y + st.h - 2 ? PAL.yard : PAL.yardAlt);
      }
    } else {
      const cx = st.x + (st.w >> 1);
      for (let y = st.y; y < st.y + st.h; y++) {
        if (open(cx, y, G_STREET) && ((y >> 3) & 3) < 2) world.set(cx, y, PAL.streetMark);
        for (const xx of [st.x, st.x + 1, st.x + st.w - 2, st.x + st.w - 1])
          if (open(xx, y, G_STREET))
            world.set(xx, y, xx === st.x + 1 || xx === st.x + st.w - 2 ? PAL.yard : PAL.yardAlt);
      }
    }
  }

  for (const block of layout.blocks) {
    if (block.kind === G_PARK) paintPark(ctx, block, clear, open, pools);
    else if (block.kind === G_PARKING) paintParking(ctx, block, clear, open, pools);
    else if (block.kind === G_PLAZA) paintPlaza(ctx, block, clear, open, pools);
  }
}

type ClearFn = (x: number, y: number, w: number, h: number, kind: number) => boolean;
type OpenFn = (x: number, y: number, kind: number) => boolean;

function paintPark(
  ctx: BakeContext,
  b: Block,
  clear: ClearFn,
  open: OpenFn,
  pools: LightPool[],
): void {
  const { world } = ctx;
  const rnd = mulberry32(b.seed);
  // Low hedge border.
  for (let x = b.x; x < b.x + b.w; x++) {
    for (const y of [b.y, b.y + 1, b.y + b.h - 2, b.y + b.h - 1])
      if (open(x, y, G_PARK)) world.set(x, y, (x + y) % 5 === 0 ? PAL.leafDark : PAL.leafDeep);
  }
  for (let y = b.y; y < b.y + b.h; y++) {
    for (const x of [b.x, b.x + 1, b.x + b.w - 2, b.x + b.w - 1])
      if (open(x, y, G_PARK)) world.set(x, y, (x + y) % 5 === 0 ? PAL.leafDark : PAL.leafDeep);
  }
  // Two crossing gravel paths.
  const px = Math.round(b.x + b.w * (0.35 + rnd() * 0.3));
  const py = Math.round(b.y + b.h * (0.35 + rnd() * 0.3));
  for (let x = b.x + 2; x < b.x + b.w - 2; x++) {
    for (let k = -3; k < 3; k++)
      if (open(x, py + k, G_PARK))
        world.set(
          x,
          py + k,
          k === -3 || k === 2
            ? PAL.plazaLine
            : hash2(x, py + k, 5) < 0.2
              ? PAL.plazaAlt
              : PAL.plaza,
        );
  }
  for (let y = b.y + 2; y < b.y + b.h - 2; y++) {
    for (let k = -3; k < 3; k++) {
      if (!open(px + k, y, G_PARK)) continue;
      if (y >= py - 3 && y < py + 3) world.set(px + k, y, PAL.plaza);
      else
        world.set(
          px + k,
          y,
          k === -3 || k === 2
            ? PAL.plazaLine
            : hash2(px + k, y, 5) < 0.2
              ? PAL.plazaAlt
              : PAL.plaza,
        );
    }
  }
  // Fountain or pond at the crossing.
  if (clear(px - 9, py - 9, 18, 18, G_PARK)) {
    world.disc(px - 0.5, py - 0.5, 8, PAL.wallCap);
    world.disc(px - 0.5, py - 0.5, 7, PAL.kerbShade);
    world.disc(px - 0.5, py - 0.5, 6, PAL.glass);
    emissive(world, () => {
      world.ring(px - 0.5, py - 0.5, 3, PAL.glassLight);
      world.set(px - 1, py - 1, PAL.cyanHi);
      world.set(px, py - 1, PAL.cyan);
      world.set(px - 1, py, PAL.cyan);
    });
    pools.push({ x: px, y: py, radii: [11, 18], tint: TINT_CYAN, level: 0 });
  }
  // Lamps along the paths.
  for (const [lx, ly] of [
    [px + 6, b.y + 14],
    [px - 7, b.y + b.h - 14],
    [b.x + 14, py - 7],
    [b.x + b.w - 14, py + 6],
  ] as const) {
    if (!clear(lx - 2, ly - 2, 5, 5, G_PARK)) continue;
    lampHead(world, lx, ly);
    pools.push({ x: lx, y: ly, radii: [8, 15, 22], tint: TINT_WARM, level: 0 });
  }
  // Trees, biggest first.
  world.curHeight = 5;
  const placed: Array<[number, number, number]> = [];
  for (let k = 0; k < (b.w * b.h) / 420; k++) {
    const r = 5 + ((rnd() * 6) | 0);
    const cx = Math.round(b.x + 4 + r + rnd() * (b.w - 8 - 2 * r));
    const cy = Math.round(b.y + 4 + r + rnd() * (b.h - 8 - 2 * r));
    if (Math.abs(cx - px) < r + 5 || Math.abs(cy - py) < r + 5) continue;
    if (placed.some(([ox, oy, or]) => Math.hypot(ox - cx, oy - cy) < (or + r) * 0.8)) continue;
    if (!clear(cx - r, cy - r, 2 * r + 1, 2 * r + 1, G_PARK)) continue;
    placed.push([cx, cy, r]);
  }
  placed.sort((a, c) => a[1] - c[1]);
  for (const [cx, cy, r] of placed)
    tree(world, cx, cy, r, (cx * 31 + cy) | 0, hash2(cx, cy, 77) < 0.25);
  world.curHeight = -1;
  // Benches by the path.
  for (let k = 0; k < 3; k++) {
    const bx = Math.round(b.x + 10 + rnd() * (b.w - 30));
    if (Math.abs(bx - px) < 14 || !clear(bx, py + 4, 9, 3, G_PARK)) continue;
    world.rect(bx, py + 4, 9, 3, PAL.wood);
    world.hline(bx, py + 4, 9, PAL.woodLight);
    world.set(bx, py + 6, PAL.woodDark);
    world.set(bx + 8, py + 6, PAL.woodDark);
  }
}

function paintParking(
  ctx: BakeContext,
  b: Block,
  clear: ClearFn,
  open: OpenFn,
  pools: LightPool[],
): void {
  const { world } = ctx;
  const rnd = mulberry32(b.seed);
  const bayW = 24;
  const bayL = 38;
  const lane = 30;
  // Rows of bays in pairs, separated by driving lanes.
  let y = b.y + 6;
  let rowIndex = 0;
  while (y + bayL <= b.y + b.h - 4) {
    const count = Math.floor((b.w - 12) / bayW);
    const x0 = b.x + ((b.w - count * bayW) >> 1);
    for (let k = 0; k <= count; k++) {
      const lx = x0 + k * bayW;
      for (let yy = y; yy < y + bayL; yy++)
        if (open(lx, yy, G_PARKING) && hash2(lx, yy >> 1, 9) < 0.86)
          world.set(lx, yy, PAL.streetMark);
    }
    const lineY = rowIndex % 2 === 0 ? y : y + bayL - 1;
    for (let x = x0; x <= x0 + count * bayW; x++)
      if (open(x, lineY, G_PARKING)) world.set(x, lineY, PAL.streetMark);
    for (let k = 0; k < count; k++) {
      if (rnd() < 0.42) continue;
      const cx = x0 + k * bayW + 3 + ((rnd() * 2) | 0);
      const cy = y + 3 + ((rnd() * 2) | 0);
      if (!clear(cx - 1, cy - 1, 22, 36, G_PARKING)) continue;
      world.curHeight = 2;
      parkedCar(world, cx, cy, false, rowIndex % 2 === 1, LIVERIES[(rnd() * LIVERIES.length) | 0]!);
      world.curHeight = -1;
    }
    y += rowIndex % 2 === 0 ? bayL : bayL + lane;
    rowIndex++;
  }
  // Two flood lamps and a ticket booth.
  for (const [lx, ly] of [
    [b.x + (b.w >> 2), b.y + (b.h >> 1)],
    [b.x + b.w - (b.w >> 2), b.y + (b.h >> 1)],
  ] as const) {
    if (!open(lx, ly, G_PARKING)) continue;
    world.rect(lx - 1, ly - 1, 3, 3, PAL.steelDark);
    lampHead(world, lx, ly);
    pools.push({ x: lx, y: ly, radii: [14, 26, 38], tint: TINT_WARM, level: 0 });
  }
  if (clear(b.x + 4, b.y + b.h - 14, 12, 10, G_PARKING)) {
    world.curHeight = 4;
    box(world, b.x + 4, b.y + b.h - 14, 12, 10, PAL.kerbShade, PAL.kerb, PAL.steelDark, 2);
    world.curHeight = -1;
    emissive(world, () => world.rect(b.x + 7, b.y + b.h - 11, 6, 3, PAL.windowWarm));
  }
}

function paintPlaza(
  ctx: BakeContext,
  b: Block,
  clear: ClearFn,
  open: OpenFn,
  pools: LightPool[],
): void {
  const { world } = ctx;
  const rnd = mulberry32(b.seed);
  const cx = b.x + (b.w >> 1);
  const cy = b.y + (b.h >> 1);
  // Inlaid ring and a lit fountain.
  for (let y = cy - 30; y <= cy + 30; y++) {
    for (let x = cx - 30; x <= cx + 30; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= 30 && d > 27 && open(x, y, G_PLAZA)) world.set(x, y, PAL.kerbShade);
      else if (
        d <= 27 &&
        d > 12 &&
        open(x, y, G_PLAZA) &&
        (Math.floor((Math.atan2(y - cy, x - cx) / Math.PI) * 8 + 8) & 1) === 0
      )
        world.set(x, y, PAL.plazaLine);
    }
  }
  if (clear(cx - 12, cy - 12, 24, 24, G_PLAZA)) {
    world.disc(cx, cy, 11, PAL.wallHi);
    world.disc(cx, cy, 10, PAL.kerbShade);
    world.disc(cx, cy, 9, PAL.glass);
    emissive(world, () => {
      world.ring(cx, cy, 6, PAL.glassLight);
      world.ring(cx, cy, 3, PAL.cyan);
      world.set(cx, cy, PAL.cyanHi);
    });
    pools.push({ x: cx, y: cy, radii: [16, 26, 36], tint: TINT_CYAN, level: 0 });
  }
  // Planters with trees at the corners, lamps between.
  world.curHeight = 5;
  for (const [tx, ty] of [
    [b.x + 16, b.y + 16],
    [b.x + b.w - 16, b.y + 16],
    [b.x + 16, b.y + b.h - 16],
    [b.x + b.w - 16, b.y + b.h - 16],
  ] as const) {
    if (!clear(tx - 9, ty - 9, 18, 18, G_PLAZA)) continue;
    world.rect(tx - 8, ty - 8, 16, 16, PAL.kerbShade);
    world.rect(tx - 7, ty - 7, 14, 14, PAL.soil);
    tree(world, tx, ty, 7 + ((rnd() * 3) | 0), tx * 13 + ty, rnd() < 0.4);
  }
  world.curHeight = -1;
  for (const [lx, ly] of [
    [cx, b.y + 10],
    [cx, b.y + b.h - 10],
    [b.x + 10, cy],
    [b.x + b.w - 10, cy],
  ] as const) {
    if (!clear(lx - 2, ly - 2, 5, 5, G_PLAZA)) continue;
    world.rect(lx - 1, ly - 1, 3, 3, PAL.steelDark);
    lampHead(world, lx, ly);
    pools.push({ x: lx, y: ly, radii: [9, 17, 26], tint: TINT_GOLD, level: 0 });
  }
}

export { G_YARD };
