import { hash2, mulberry32 } from '@bolt/shared';
import type { BakeContext } from '../biome.js';
import type { Color } from '../canvas.js';
import { Canvas } from '../canvas.js';
import type { Scene } from '../oblique.js';
import type { Block, CityLayout } from './layout.js';
import { G_PARK, G_PARKING, G_PLAZA, G_QUAY, G_STREET, G_WATER } from './layout.js';
import { LIVERIES, PAL, TINT_CYAN, TINT_GOLD, TINT_WARM } from './palette.js';
import { parkCar, plantTree, stand, standLantern } from './props.js';
import type { LightOut } from './props.js';
import { BARRIER_REACH } from './road.js';
import { benchSprite, drawBox, emissive } from './sprites.js';

/**
 * Everything behind the barrier: the flat ground (side streets, yards, parks, lots, plazas)
 * and the things that stand on it, which go into the scene.
 */

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
        else if (hsh > 0.985 && lx < 3) c = PAL.waterGlint;
        else if (hsh > 0.984 && hsh <= 0.985 && lx === 1) c = PAL.waterSpark;
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

export function paintGround(
  ctx: BakeContext,
  scene: Scene,
  layout: CityLayout,
  out: LightOut,
): void {
  const { world, field } = ctx;
  const { w, h } = field;
  const data = world.data;
  for (let i = 0; i < w * h; i++) {
    if (field.edge[i]! <= 0) continue;
    const c = groundTone(layout.ground[i]!, i % w, (i / w) | 0);
    const o = i * 4;
    data[o] = (c >> 16) & 255;
    data[o + 1] = (c >> 8) & 255;
    data[o + 2] = c & 255;
    data[o + 3] = 255;
  }

  // Everything below draws only on open ground: never under roofs, never near the corridor.
  const open = (x: number, y: number, kind: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const i = y * w + x;
    return (
      field.edge[i]! > BARRIER_REACH + 3 && layout.roofId[i] === 0 && layout.ground[i] === kind
    );
  };
  const clear = (x: number, y: number, bw: number, bh: number, kind: number): boolean =>
    open(x, y, kind) &&
    open(x + bw - 1, y, kind) &&
    open(x, y + bh - 1, kind) &&
    open(x + bw - 1, y + bh - 1, kind) &&
    open(x + (bw >> 1), y + (bh >> 1), kind);

  // Side streets: footways, a broken center line, and cars left at the kerb.
  for (const st of layout.streets) {
    const wide = Math.min(st.w, st.h);
    const rnd = mulberry32((st.x * 31 + st.y * 17 + wide) | 0);
    const foot = wide >= 30 ? 4 : 3;
    if (st.horizontal) {
      const cy = st.y + (st.h >> 1);
      for (let x = st.x; x < st.x + st.w; x++) {
        if (open(x, cy, G_STREET) && ((x >> 3) & 3) < 2) world.set(x, cy, PAL.streetMark);
        for (let k = 0; k < foot; k++) {
          for (const yy of [st.y + k, st.y + st.h - 1 - k])
            if (open(x, yy, G_STREET))
              world.set(
                x,
                yy,
                k === foot - 1 ? PAL.kerbShade : x % 9 === 0 ? PAL.yard : PAL.yardAlt,
              );
        }
      }
      if (wide >= 30) {
        for (let x = st.x + 30; x < st.x + st.w - 30; x += 40) {
          if (rnd() < 0.45) continue;
          const north = rnd() < 0.5;
          const cyc = north ? st.y + foot + 10 : st.y + st.h - foot - 10;
          if (!clear(x - 18, cyc - 10, 36, 20, G_STREET)) continue;
          parkCar(scene, x, cyc, true, rnd() < 0.5, LIVERIES[(rnd() * LIVERIES.length) | 0]!);
        }
      }
    } else {
      const cx = st.x + (st.w >> 1);
      for (let y = st.y; y < st.y + st.h; y++) {
        if (open(cx, y, G_STREET) && ((y >> 3) & 3) < 2) world.set(cx, y, PAL.streetMark);
        for (let k = 0; k < foot; k++) {
          for (const xx of [st.x + k, st.x + st.w - 1 - k])
            if (open(xx, y, G_STREET))
              world.set(
                xx,
                y,
                k === foot - 1 ? PAL.kerbShade : y % 9 === 0 ? PAL.yard : PAL.yardAlt,
              );
        }
      }
    }
  }

  for (const block of layout.blocks) {
    if (block.kind === G_PARK) paintPark(ctx, scene, block, clear, open, out);
    else if (block.kind === G_PARKING) paintParking(ctx, scene, block, clear, open, out);
    else if (block.kind === G_PLAZA) paintPlaza(ctx, scene, block, clear, open, out);
  }
}

type ClearFn = (x: number, y: number, w: number, h: number, kind: number) => boolean;
type OpenFn = (x: number, y: number, kind: number) => boolean;

/** A round basin with a raised stone rim and lit water. */
export function fountain(ctx: BakeContext, scene: Scene, cx: number, cy: number, r: number): void {
  const cv = Canvas.sprite(2 * r + 3, 2 * r + 6);
  const mx = r + 1;
  const my = r + 1;
  cv.disc(mx, my + 3, r, PAL.kerbShade);
  cv.disc(mx, my, r, PAL.wallHi);
  cv.disc(mx, my, r - 1, PAL.wallCap);
  cv.disc(mx, my + 1, r - 2, PAL.kerbShade);
  emissive(cv, () => {
    cv.disc(mx, my + 1, r - 3, PAL.glass);
    cv.ring(mx, my + 1, r - 5, PAL.glassLight);
    cv.set(mx - 1, my, PAL.cyanHi);
    cv.set(mx, my, PAL.cyan);
    cv.set(mx, my - 1, PAL.cyanHi);
    cv.set(mx, my - 2, PAL.cyan);
  });
  scene.add({ art: cv, x: cx - mx, y: cy - my - 3, baseY: cy + r });
  scene.footprint(cx - r, cy - r, 2 * r, 2 * r, 2);
  void ctx;
}

function paintPark(
  ctx: BakeContext,
  scene: Scene,
  b: Block,
  clear: ClearFn,
  open: OpenFn,
  out: LightOut,
): void {
  const { world } = ctx;
  const rnd = mulberry32(b.seed);
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
            : hash2(x >> 1, py + k, 5) < 0.2
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
            : hash2(px + k, y >> 1, 5) < 0.2
              ? PAL.plazaAlt
              : PAL.plaza,
        );
    }
  }
  // Clipped hedge around the lawn, standing a few pixels proud.
  scene.extrude({
    x0: b.x,
    y0: b.y,
    x1: b.x + b.w,
    y1: b.y + b.h,
    shadow: 2,
    rise: (x, y) => {
      const m = Math.min(x - b.x, y - b.y, b.x + b.w - 1 - x, b.y + b.h - 1 - y);
      if (m > 2 || !open(x, y, G_PARK)) return 0;
      if (Math.abs(x - px) < 5 || Math.abs(y - py) < 5) return 0;
      return 4;
    },
    top: (x, y) => (hash2(x >> 1, y >> 1, 77) < 0.3 ? PAL.leafLight : PAL.leaf),
    side: (x, y, v) => (v === 0 ? PAL.leafDeep : (x + v) % 4 === 0 ? PAL.leafDeep : PAL.leafDark),
  });
  if (clear(px - 10, py - 10, 20, 20, G_PARK)) {
    fountain(ctx, scene, px, py, 8);
    out.pools.push({ x: px, y: py, radii: [13, 20], tint: TINT_CYAN });
  }
  for (const [lx, ly] of [
    [px + 7, b.y + 16],
    [px - 8, b.y + b.h - 12],
    [b.x + 16, py - 6],
    [b.x + b.w - 14, py + 9],
  ] as const) {
    if (!clear(lx - 2, ly - 2, 5, 5, G_PARK)) continue;
    standLantern(scene, out, lx, ly, TINT_WARM, [12, 22]);
  }
  const placed: Array<[number, number, number]> = [];
  for (let k = 0; k < (b.w * b.h) / 380; k++) {
    const r = 5 + ((rnd() * 6) | 0);
    const cx = Math.round(b.x + 5 + r + rnd() * (b.w - 10 - 2 * r));
    const cy = Math.round(b.y + 8 + r + rnd() * (b.h - 12 - r));
    if (Math.abs(cx - px) < r + 5 || Math.abs(cy - 4 - py) < 8) continue;
    if (placed.some(([ox, oy, or]) => Math.hypot(ox - cx, (oy - cy) * 1.4) < (or + r) * 0.85))
      continue;
    if (!clear(cx - 2, cy - 3, 5, 5, G_PARK)) continue;
    placed.push([cx, cy, r]);
  }
  for (const [cx, cy, r] of placed)
    plantTree(scene, cx, cy, r, (cx * 31 + cy) | 0, hash2(cx, cy, 77) < 0.25);
  for (let k = 0; k < 3; k++) {
    const bx = Math.round(b.x + 12 + rnd() * (b.w - 30));
    if (Math.abs(bx - px) < 14 || !clear(bx - 6, py - 12, 12, 8, G_PARK)) continue;
    stand(scene, benchSprite(), bx, py - 5, 10, 2);
  }
}

function paintParking(
  ctx: BakeContext,
  scene: Scene,
  b: Block,
  clear: ClearFn,
  open: OpenFn,
  out: LightOut,
): void {
  const { world } = ctx;
  const rnd = mulberry32(b.seed);
  const bayW = 24;
  const bayL = 40;
  const lane = 30;
  // Rows of bays in pairs, separated by driving lanes.
  let y = b.y + 8;
  let rowIndex = 0;
  while (y + bayL <= b.y + b.h - 4) {
    const count = Math.floor((b.w - 12) / bayW);
    const x0 = b.x + ((b.w - count * bayW) >> 1);
    for (let k = 0; k <= count; k++) {
      const lx = x0 + k * bayW;
      for (let yy = y; yy < y + bayL; yy++)
        if (open(lx, yy, G_PARKING)) world.set(lx, yy, PAL.streetMark);
    }
    const lineY = rowIndex % 2 === 0 ? y : y + bayL - 1;
    for (let x = x0; x <= x0 + count * bayW; x++)
      if (open(x, lineY, G_PARKING)) world.set(x, lineY, PAL.streetMark);
    for (let k = 0; k < count; k++) {
      if (rnd() < 0.42) continue;
      const cx = x0 + k * bayW + 12;
      const cy = y + 19 + ((rnd() * 3) | 0);
      if (!clear(cx - 10, cy - 18, 20, 38, G_PARKING)) continue;
      parkCar(scene, cx, cy, false, rowIndex % 2 === 1, LIVERIES[(rnd() * LIVERIES.length) | 0]!);
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
    standLantern(scene, out, lx, ly, TINT_WARM, [18, 34]);
  }
  if (clear(b.x + 4, b.y + b.h - 16, 14, 12, G_PARKING)) {
    const cv = Canvas.sprite(13, 9 + 9);
    drawBox(cv, 0, 0, 13, 9, 9, PAL.kerb, PAL.kerbShade);
    emissive(cv, () => {
      cv.rect(2, 11, 6, 4, PAL.windowMid);
      cv.hline(2, 11, 6, PAL.windowWarm);
    });
    cv.rect(9, 11, 3, 6, PAL.steelDark);
    scene.add({ art: cv, x: b.x + 4, y: b.y + b.h - 14 - 9, baseY: b.y + b.h - 6, faceFrom: 9 });
    scene.footprint(b.x + 4, b.y + b.h - 14, 13, 9, 3);
  }
}

function paintPlaza(
  ctx: BakeContext,
  scene: Scene,
  b: Block,
  clear: ClearFn,
  open: OpenFn,
  out: LightOut,
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
    fountain(ctx, scene, cx, cy, 10);
    out.pools.push({ x: cx, y: cy, radii: [18, 30], tint: TINT_CYAN });
  }
  for (const [tx, ty] of [
    [b.x + 16, b.y + 20],
    [b.x + b.w - 16, b.y + 20],
    [b.x + 16, b.y + b.h - 12],
    [b.x + b.w - 16, b.y + b.h - 12],
  ] as const) {
    if (!clear(tx - 6, ty - 6, 12, 10, G_PLAZA)) continue;
    world.rect(tx - 5, ty - 4, 10, 7, PAL.kerbShade);
    world.rect(tx - 4, ty - 3, 8, 5, PAL.soil);
    plantTree(scene, tx, ty, 7 + ((rnd() * 3) | 0), tx * 13 + ty, rnd() < 0.4);
  }
  for (const [lx, ly] of [
    [cx, b.y + 12],
    [cx, b.y + b.h - 8],
    [b.x + 10, cy],
    [b.x + b.w - 10, cy],
  ] as const) {
    if (!clear(lx - 2, ly - 2, 5, 5, G_PLAZA)) continue;
    standLantern(scene, out, lx, ly, TINT_GOLD, [12, 24]);
  }
}
