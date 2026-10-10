import { hash2, mulberry32 } from '@bolt/shared';
import type { BakeContext } from '../biome.js';
import { Canvas, col, mixc } from '../canvas.js';
import type { Color } from '../canvas.js';
import { drawText, textWidth } from '../font.js';
import { standBox } from '../oblique.js';
import type { Scene } from '../oblique.js';
import { paintRoofSurface } from './buildings.js';
import type { CityLayout, FixedLot, Lot, Reserve } from './layout.js';
import { G_PLAZA, G_QUAY, G_STREET, G_WATER, NEAR_STRIP } from './layout.js';
import { neonText } from './neon.js';
import {
  BUILDINGS,
  LIVERIES,
  PAL,
  ROOF_CONCRETE,
  ROOF_PLUM,
  ROOF_SLATE,
  ROOF_TEAL,
  TINT_COOL,
  TINT_CYAN,
  TINT_GOLD,
  TINT_HEX,
  TINT_PURPLE,
  TINT_WARM,
  darker,
  lighter,
} from './palette.js';
import { plantTree, stand, standLantern } from './props.js';
import type { LightOut } from './props.js';
import { CONTAINER_RISE, bollardSprite, containerSprite, drawBox, emissive } from './sprites.js';

/**
 * The five landmarks plus start line dressing, built as standing structures: a clock tower
 * with its face toward the camera, an arcade with a marquee facade and a star on the roof, a
 * lattice mast ringed with neon, portal cranes over the quay, and a rail deck on piers.
 */

export type LandmarkSites = {
  clock: { x: number; y: number };
  arcade: { x: number; y: number; w: number; h: number };
  /** Top-left corner of the arcade marquee on the facade. */
  marquee: { x: number; y: number };
  tower: { x: number; y: number };
  /** Top-left corner of the ring sprite and of the beacon sprite. */
  rings: { x: number; y: number };
  beacon: { x: number; y: number };
  viaduct: { y: number; roadX0: number; roadX1: number; west: number };
  start: { x: number; y: number };
};

const HARBOR = { x0: 560, x1: 3060, y0: 2452, water: 2600 };
export const VIADUCT_HALF = 17;
export const VIADUCT_RISE = 26;
const VIADUCT_GIRDER = 7;

const ARCADE_RISE = 26;
const MARQUEE_W = 88;
const MARQUEE_H = 14;

const propAt = (
  ctx: BakeContext,
  kind: string,
  fx: number,
  fy: number,
): { x: number; y: number } => {
  const p = ctx.def.props.find((q) => q.kind === kind);
  return p ? { x: Math.round(p.x), y: Math.round(p.y) } : { x: fx, y: fy };
};

/** Vertical extent of the solid ground around a point: the island between two roads. */
function island(scene: Scene, x: number, y: number): { top: number; bottom: number } {
  let top = y;
  let bottom = y;
  while (top > 0 && !scene.drive[(top - 1) * scene.w + x]) top--;
  while (bottom < scene.h - 1 && !scene.drive[(bottom + 1) * scene.w + x]) bottom++;
  return { top, bottom };
}

export function planLandmarks(
  ctx: BakeContext,
  scene: Scene,
): {
  reserves: Reserve[];
  fixed: FixedLot[];
  sites: LandmarkSites;
} {
  const clock = propAt(ctx, 'landmark_clock_tower', 655, 1315);
  const arcade = propAt(ctx, 'landmark_arcade', 800, 800);
  const tower = propAt(ctx, 'landmark_neon_tower', 1900, 826);
  const viaduct = propAt(ctx, 'landmark_tram_viaduct', 3145, 1560);
  const start = propAt(ctx, 'start_gantry', 1900, 2340);
  const h = ctx.def.worldHeight;
  const clockLot = { x: clock.x - 7, y: clock.y - 50, w: 100, h: 100 };
  const arcadeLot = { x: arcade.x - 110, y: arcade.y - 60, w: 230, h: 124 };
  // The grandstand backs onto the far bank of the start straight.
  const bank = island(scene, start.x, start.y - 140);
  const standLot = { x: start.x - 114, y: bank.bottom - 1 - 76, w: 228, h: 76 };
  // Where the viaduct crosses the corridor: found by scanning the field along its line.
  let roadX0 = viaduct.x;
  let roadX1 = viaduct.x;
  const row = viaduct.y * ctx.field.w;
  while (roadX0 > 0 && ctx.field.edge[row + roadX0]! <= 6) roadX0--;
  while (roadX1 < ctx.field.w - 1 && ctx.field.edge[row + roadX1]! <= 6) roadX1++;
  roadX0 -= 4;
  roadX1 += 5;
  const west = roadX0 - 440;
  const stationLot = { x: west - 96, y: viaduct.y - 48, w: 112, h: 96 };
  const isl = island(scene, tower.x, tower.y);
  const reserves: Reserve[] = [
    { x: clockLot.x - 10, y: clockLot.y - 28, w: 152, h: 156, ground: G_PLAZA },
    { x: arcadeLot.x - 14, y: arcadeLot.y - 14, w: 258, h: 204, ground: G_PLAZA },
    { x: tower.x - 40, y: isl.top, w: 80, h: isl.bottom - isl.top + 1, ground: G_PLAZA },
    {
      x: HARBOR.x0,
      y: HARBOR.y0,
      w: HARBOR.x1 - HARBOR.x0,
      h: HARBOR.water - HARBOR.y0,
      ground: G_QUAY,
    },
    {
      x: HARBOR.x0,
      y: HARBOR.water,
      w: HARBOR.x1 - HARBOR.x0,
      h: h - HARBOR.water,
      ground: G_WATER,
    },
    { x: standLot.x - 10, y: standLot.y - 30, w: 248, h: 112, ground: G_PLAZA },
    { x: stationLot.x - 10, y: stationLot.y - 10, w: 132, h: 126, ground: G_PLAZA },
    // Nothing is built under or right in front of the rail deck.
    { x: west, y: viaduct.y - 24, w: roadX0 - west, h: 66, ground: G_STREET },
    { x: roadX1, y: viaduct.y - 24, w: ctx.def.worldWidth - roadX1, h: 66, ground: G_STREET },
  ];
  const fixed: FixedLot[] = [
    { ...clockLot, family: ROOF_CONCRETE, rise: 16, tag: 'clock' },
    { ...arcadeLot, family: ROOF_PLUM, rise: ARCADE_RISE, tag: 'arcade' },
    {
      x: HARBOR.x0 + 24,
      y: HARBOR.y0 + 40,
      w: 250,
      h: 70,
      family: ROOF_TEAL,
      rise: 22,
      tag: 'warehouse',
    },
    {
      x: HARBOR.x1 - 300,
      y: HARBOR.y0 + 40,
      w: 276,
      h: 70,
      family: ROOF_SLATE,
      rise: 22,
      tag: 'warehouse',
    },
    { ...standLot, family: ROOF_SLATE, rise: 44, tag: 'grandstand' },
    { ...stationLot, family: ROOF_CONCRETE, rise: VIADUCT_RISE, tag: 'station' },
  ];
  // The mast stands on a drum whose south face is the wall of the lower road.
  const towerY = isl.bottom - 1 - 24;
  return {
    reserves,
    fixed,
    sites: {
      clock: { x: clockLot.x + 50, y: clockLot.y + 50 },
      arcade: arcadeLot,
      marquee: {
        x: arcadeLot.x + 71,
        y: arcadeLot.y + arcadeLot.h - ARCADE_RISE + 2,
      },
      tower: { x: tower.x, y: towerY },
      rings: { x: tower.x - RING_BOX_W / 2, y: 0 },
      beacon: { x: tower.x - 7, y: 0 },
      viaduct: { y: viaduct.y, roadX0, roadX1, west },
      start,
    },
  };
}

function thickLine(
  cv: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: Color,
  wide: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  for (let k = -(wide - 1) / 2; k <= (wide - 1) / 2; k += 0.5)
    cv.line(x0 + nx * k, y0 + ny * k, x1 + nx * k, y1 + ny * k, c);
}

function triangle(
  cv: Canvas,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  c: Color,
): void {
  const x0 = Math.floor(Math.min(ax, bx, cx));
  const x1 = Math.ceil(Math.max(ax, bx, cx));
  const y0 = Math.floor(Math.min(ay, by, cy));
  const y1 = Math.ceil(Math.max(ay, by, cy));
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (area === 0) return;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const w0 = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / area;
      const w1 = ((cx - bx) * (y - by) - (cy - by) * (x - bx)) / area;
      const w2 = ((ax - cx) * (y - cy) - (ay - cy) * (x - cx)) / area;
      if (w0 >= -0.01 && w1 >= -0.01 && w2 >= -0.01) cv.set(x, y, c);
    }
  }
}

function inStar(
  px: number,
  py: number,
  cx: number,
  cy: number,
  outer: number,
  inner: number,
): boolean {
  // Point in a five-pointed star, by angular sector.
  const dx = px - cx;
  const dy = py - cy;
  const r = Math.hypot(dx, dy);
  if (r > outer) return false;
  if (r <= inner * 0.98) return true;
  let a = Math.atan2(dy, dx) + Math.PI / 2;
  const sector = (Math.PI * 2) / 5;
  a = ((a % sector) + sector) % sector;
  if (a > sector / 2) a = sector - a;
  const tx = outer;
  const nx = inner * Math.cos(sector / 2);
  const ny = inner * Math.sin(sector / 2);
  const qx = r * Math.cos(a);
  const qy = r * Math.sin(a);
  return (nx - tx) * qy - ny * (qx - tx) >= 0;
}

/** Warns when a fixed lot would break the near-bank rule and returns the rise it may have. */
function allowedRise(scene: Scene, lot: Lot): number {
  let gap = 255;
  for (let x = lot.x; x < lot.x + lot.w; x++)
    gap = Math.min(gap, scene.clearN[lot.y * scene.w + x]!);
  if (gap >= 200) return lot.rise;
  const max = gap - NEAR_STRIP;
  if (max < lot.rise)
    console.warn(`landmark ${lot.tag}: rise ${lot.rise} capped to ${max} by the road to the north`);
  return Math.min(lot.rise, max);
}

// --- Clock tower ---------------------------------------------------------------------------

function paintClock(scene: Scene, lot: Lot, out: LightOut): void {
  const b = BUILDINGS[lot.family]!;
  const r = allowedRise(scene, lot);
  const w = lot.w;
  const d = lot.h;
  // The hall: a stone podium with a parapet and tall lit windows.
  const hall = Canvas.sprite(w, d + r);
  paintRoofSurface(hall, 0, 0, w, d, b, (lx, ly) =>
    lx % 14 === 13 || ly % 14 === 13
      ? b.roofLine
      : hash2(lx >> 2, ly >> 1, 51) < 0.08
        ? b.roofAlt
        : b.roof,
  );
  hall.rect(0, d, w, r, b.wall);
  hall.hline(0, d, w, b.trim);
  hall.hline(0, d + 1, w, b.line);
  hall.vline(w - 1, d, r, b.line);
  hall.hline(0, d + r - 1, w, PAL.ink);
  for (let x = 6; x + 6 < w - 4; x += 12) {
    if (x > 26 && x < 66) continue;
    hall.rect(x, d + 4, 6, r - 6, b.line);
    emissive(hall, () => {
      hall.rect(x + 1, d + 5, 4, r - 8, PAL.windowMid);
      hall.hline(x + 2, d + 4, 2, PAL.windowWarm);
      hall.vline(x + 1, d + 5, r - 8, PAL.windowWarm);
    });
  }
  // Lit lay lights either side of the shaft, a gilded finial on each corner.
  for (const lx of [10, w - 26]) {
    hall.rect(lx, 22, 16, 44, b.inner);
    hall.hline(lx, 22, 16, b.rimLow);
    emissive(hall, () => {
      for (let yy = 0; yy < 42; yy++)
        for (let xx = 0; xx < 14; xx++)
          if (xx % 5 !== 4 && yy % 11 !== 10)
            hall.set(lx + 1 + xx, 23 + yy, yy % 11 === 0 ? PAL.windowWarm : PAL.windowMid);
    });
  }
  for (const [fx, fy] of [
    [5, 9],
    [w - 10, 9],
    [5, d - 4],
    [w - 10, d - 4],
  ] as const) {
    hall.rect(fx, fy - 6, 5, 6, b.wall);
    hall.vline(fx, fy - 6, 6, b.trim);
    hall.hline(fx, fy - 7, 5, b.rim);
    hall.set(fx + 2, fy - 8, PAL.gold);
    hall.set(fx + 2, fy - 9, PAL.goldHi);
  }
  scene.add(standBox(hall, lot.x, lot.y, d, r));
  scene.footprint(lot.x, lot.y, w, d, 5);

  // The tower: a square shaft with the clock near the top and a copper spire.
  const sw = 38;
  const sd = 30;
  const sr = 84;
  const spire = 24;
  const sx = lot.x + ((w - sw) >> 1);
  const sy = lot.y + d - sd - 9;
  const head = spire + 6;
  const cv = Canvas.sprite(sw + 4, head + sd + sr);
  const fx = 2;
  const fy = head + sd;
  // Shaft face.
  for (let ly = 0; ly < sr; ly++) {
    for (let lx = 0; lx < sw; lx++) {
      const course = ly % 6 === 5;
      const quoin = lx < 3 || lx >= sw - 3;
      let c: Color = course ? b.wallAlt : b.wall;
      if (quoin) c = (Math.floor(ly / 6) & 1) === 0 ? b.trim : mixc(b.wall, b.trim, 0.5);
      if (lx === sw - 1) c = b.line;
      cv.set(fx + lx, fy + ly, c);
    }
  }
  for (const band of [34, 62]) {
    cv.hline(fx - 1, fy + band, sw + 2, b.trim);
    cv.hline(fx - 1, fy + band + 1, sw + 2, b.line);
  }
  // Slit windows and the door.
  for (const [wx, wy, lit] of [
    [10, 42, true],
    [26, 42, false],
    [10, 52, false],
    [26, 52, true],
  ] as const) {
    cv.rect(fx + wx, fy + wy, 3, 7, b.line);
    if (lit) emissive(cv, () => cv.rect(fx + wx + 1, fy + wy + 1, 1, 5, PAL.windowWarm));
  }
  cv.rect(fx + 13, fy + sr - 15, 12, 15, b.line);
  cv.rect(fx + 14, fy + sr - 13, 10, 13, PAL.woodDark);
  cv.vline(fx + 19, fy + sr - 13, 13, PAL.ink);
  emissive(cv, () => {
    cv.hline(fx + 15, fy + sr - 14, 8, PAL.gold);
    cv.hline(fx + 16, fy + sr - 15, 6, PAL.goldDim);
  });
  cv.hline(fx, fy + sr - 1, sw, PAL.ink);
  // The clock.
  const cx = fx + sw / 2 - 0.5;
  const cy = fy + 17;
  cv.disc(cx, cy, 15, PAL.ink);
  cv.disc(cx, cy, 14, PAL.goldDim);
  cv.ring(cx - 0.4, cy - 0.4, 14, PAL.gold);
  emissive(cv, () => {
    cv.disc(cx, cy, 12, col('#EBD9A4'));
    cv.disc(cx, cy, 10, col('#FFF3C6'));
    for (let hour = 0; hour < 12; hour++) {
      const a = (hour / 12) * Math.PI * 2 - Math.PI / 2;
      const px = Math.round(cx + Math.cos(a) * 10.5);
      const py = Math.round(cy + Math.sin(a) * 10.5);
      cv.set(px, py, PAL.ink);
      if (hour % 3 === 0)
        cv.set(Math.round(cx + Math.cos(a) * 9), Math.round(cy + Math.sin(a) * 9), PAL.ink);
    }
    const ha = ((10 + 10 / 60) / 12) * Math.PI * 2 - Math.PI / 2;
    const ma = (10 / 60) * Math.PI * 2 - Math.PI / 2;
    thickLine(cv, cx, cy, cx + Math.cos(ha) * 5.5, cy + Math.sin(ha) * 5.5, PAL.ink, 2);
    thickLine(cv, cx, cy, cx + Math.cos(ma) * 9, cy + Math.sin(ma) * 9, PAL.inkSoft, 1.5);
    cv.disc(cx, cy, 1, PAL.coral);
  });
  // Cornice and the spire: west slope lit, south slope in half tone, east slope dark.
  const ty = head;
  cv.rect(fx - 2, ty + sd - 2, sw + 4, 3, b.trim);
  cv.hline(fx - 2, ty + sd + 1, sw + 4, b.line);
  const copper = BUILDINGS[ROOF_TEAL]!;
  const ax = fx + sw / 2;
  const ay = ty + sd / 2 - spire;
  triangle(cv, fx - 1, ty, fx - 1, ty + sd - 2, ax, ay, copper.rim);
  triangle(cv, fx + sw, ty, fx + sw, ty + sd - 2, ax, ay, copper.inner);
  triangle(cv, fx - 1, ty + sd - 2, fx + sw, ty + sd - 2, ax, ay, copper.roof);
  cv.line(fx - 1, ty + sd - 2, ax, ay, copper.rimLow);
  cv.line(fx + sw, ty + sd - 2, ax, ay, copper.roofLine);
  cv.vline(Math.round(ax), ay - 5, 6, PAL.gold);
  cv.set(Math.round(ax), ay - 6, PAL.goldHi);
  // The shaft rises through the hall, so it is painted after it.
  scene.add({ art: cv, x: sx - fx, y: sy - sr - head, baseY: lot.y + d, faceFrom: head + sd });
  scene.footprint(sx, sy, sw, sd, 12);
  const gx = sx + sw / 2;
  out.pools.push({ x: gx, y: lot.y + d + 16, radii: [30, 52], tint: TINT_GOLD, squashY: 1.3 });
  out.lights.push({
    x: Math.round(gx),
    y: sy - sr + 17,
    radius: 86,
    color: TINT_HEX[TINT_GOLD]!,
    intensity: 0.7,
  });
}

// --- Starlight Arcade ----------------------------------------------------------------------

/** Marquee board with chasing bulbs. Frame 0 is the baked state. */
export function drawMarquee(cv: Canvas, x: number, y: number, frame: number): void {
  const w = MARQUEE_W;
  const h = MARQUEE_H;
  // The whole board is self-lit, so street light never shifts it away from the loop's frames.
  emissive(cv, () => {
    cv.rect(x, y, w, h, PAL.ink);
    cv.frame(x, y, w, h, PAL.steelDark);
    let i = 0;
    const bulb = (bx: number, by: number): void => {
      const phase = (((i - frame) % 4) + 4) % 4;
      cv.set(bx, by, phase === 0 ? PAL.goldHi : phase === 1 ? PAL.gold : PAL.goldDim);
      i++;
    };
    for (let bx = 2; bx < w - 2; bx += 3) bulb(x + bx, y + 1);
    for (let by = 4; by < h - 2; by += 3) bulb(x + w - 2, y + by);
    for (let bx = w - 3; bx >= 2; bx -= 3) bulb(x + bx, y + h - 2);
    for (let by = h - 4; by >= 3; by -= 3) bulb(x + 1, y + by);
    const tw = textWidth('PLAY', 'micro', 1);
    drawText(cv, x + ((w - tw) >> 1), y + 5, 'PLAY', PAL.cyan, 'micro', 1);
    const blink = frame % 2 === 0;
    drawText(cv, x + 14, y + 5, '>>', blink ? PAL.coral : PAL.coralDim, 'micro', 1);
    drawText(cv, x + w - 21, y + 5, '<<', blink ? PAL.coral : PAL.coralDim, 'micro', 1);
    drawText(cv, x + 24, y + 5, '>', blink ? PAL.coralDim : PAL.coral, 'micro', 1);
    drawText(cv, x + w - 27, y + 5, '<', blink ? PAL.coralDim : PAL.coral, 'micro', 1);
  });
}

function paintArcade(scene: Scene, lot: Lot, out: LightOut): void {
  const b = BUILDINGS[lot.family]!;
  const r = allowedRise(scene, lot);
  const w = lot.w;
  const d = lot.h;
  const cv = Canvas.sprite(w, d + r);
  paintRoofSurface(cv, 0, 0, w, d, b, (lx, ly) =>
    hash2((lx + (ly & 2)) >> 1, ly >> 1, 61) > 0.86 ? b.roofAlt : b.roof,
  );
  // Bulbs along the parapet.
  emissive(cv, () => {
    let i = 0;
    for (let x = 4; x < w - 3; x += 5) {
      cv.set(x, 1, i % 2 === 0 ? PAL.gold : PAL.goldDim);
      cv.set(x, d - 2, i++ % 2 === 0 ? PAL.goldHi : PAL.gold);
    }
    for (let y = 6; y < d - 4; y += 5) {
      cv.set(1, y, i % 2 === 0 ? PAL.gold : PAL.goldDim);
      cv.set(w - 2, y, i++ % 2 === 0 ? PAL.goldDim : PAL.gold);
    }
  });
  // The star, set flat into the roof.
  const sx = 62;
  const sy = 60;
  emissive(cv, () => {
    for (let yy = -46; yy <= 46; yy++) {
      for (let xx = -46; xx <= 46; xx++) {
        const px = sx + xx;
        const py = sy + yy;
        if (inStar(px, py, sx, sy, 43, 18)) {
          if (!inStar(px, py, sx, sy, 37, 15.4)) {
            const core = inStar(px, py, sx, sy, 41, 17.1) && !inStar(px, py, sx, sy, 39, 16.3);
            cv.set(px, py, core ? PAL.goldHi : PAL.gold);
          } else if (inStar(px, py, sx, sy, 33, 13.8)) {
            if (!inStar(px, py, sx, sy, 28, 11.7)) cv.set(px, py, PAL.purpleDim);
            else if (inStar(px, py, sx, sy, 24, 10) && !inStar(px, py, sx, sy, 20, 8.4))
              cv.set(px, py, PAL.cyan);
            else if (inStar(px, py, sx, sy, 15, 6.3))
              cv.set(px, py, inStar(px, py, sx, sy, 11, 4.6) ? PAL.coralHi : PAL.coral);
            else cv.set(px, py, PAL.ink);
          } else cv.set(px, py, PAL.ink);
        } else if (inStar(px, py, sx, sy, 45, 19)) cv.set(px, py, PAL.goldDim);
      }
    }
  });
  // The name, standing on a frame toward the front of the roof.
  const bx = 122;
  const bh = 46;
  const by = d - 14 - bh - 5;
  for (let k = 1; k <= 4; k++) cv.mapRect(bx + k, d - 14 + k, 98, 1, (c) => darker(c, 0.45));
  for (const lx of [bx + 4, bx + 46, bx + 90]) {
    cv.vline(lx, by + bh, 6, PAL.steelDark);
    cv.vline(lx + 1, by + bh, 6, PAL.steel);
  }
  cv.rect(bx, by, 98, bh, PAL.ink);
  cv.frame(bx, by, 98, bh, PAL.steelDark);
  cv.hline(bx, by, 98, PAL.steelLight);
  neonText(cv, bx + 13, by + 5, 'STARLIGHT', 0, 2);
  neonText(cv, bx + 13, by + 19, 'ARCADE', 1, 3);
  emissive(cv, () => {
    for (let k = 0; k < 90; k += 4)
      cv.set(bx + 4 + k, by + 37, k % 8 === 0 ? PAL.gold : PAL.purple);
    drawText(cv, bx + 21, by + 39, 'OPEN ALL NIGHT', PAL.mint, 'micro', 1);
  });
  // Facade: marquee over three sets of doors, poster cases either side.
  const fy = d;
  for (let ly = 0; ly < r; ly++)
    for (let lx = 0; lx < w; lx++) cv.set(lx, fy + ly, lx % 12 === 11 ? b.wallAlt : b.wall);
  cv.hline(0, fy, w, b.trim);
  cv.hline(0, fy + 1, w, b.line);
  cv.vline(w - 1, fy, r, b.line);
  cv.hline(0, fy + r - 1, w, PAL.ink);
  drawMarquee(cv, 71, fy + 2, 0);
  for (let k = 0; k < 3; k++) {
    const dx = 76 + k * 28;
    cv.rect(dx, fy + 16, 22, r - 17, b.line);
    emissive(cv, () => {
      cv.rect(dx + 1, fy + 17, 20, r - 19, PAL.windowMid);
      cv.hline(dx + 1, fy + 17, 20, PAL.windowWarm);
      cv.vline(dx + 10, fy + 18, r - 20, PAL.windowDim);
      cv.vline(dx + 11, fy + 18, r - 20, PAL.windowDim);
    });
  }
  const posters: readonly Color[] = [
    PAL.cyan,
    PAL.coral,
    PAL.gold,
    PAL.purple,
    PAL.mint,
    PAL.coral,
  ];
  posters.forEach((c, k) => {
    const px = k < 3 ? 8 + k * 20 : 168 + (k - 3) * 20;
    cv.rect(px, fy + 6, 14, r - 10, PAL.ink);
    emissive(cv, () => {
      cv.rect(px + 1, fy + 7, 12, r - 12, darker(c, 0.45));
      cv.rect(px + 3, fy + 9, 8, 5, c);
      cv.hline(px + 3, fy + r - 8, 8, PAL.ivory);
    });
  });
  scene.add(standBox(cv, lot.x, lot.y, d, r));
  scene.footprint(lot.x, lot.y, w, d, 7);
  const foot = lot.y + d + 8;
  out.pools.push({ x: lot.x + 115, y: foot, radii: [44, 70], tint: TINT_GOLD, squashY: 1.7 });
  out.pools.push({ x: lot.x + 30, y: foot, radii: [22, 36], tint: TINT_CYAN, squashY: 1.5 });
  out.pools.push({ x: lot.x + 196, y: foot, radii: [22, 36], tint: TINT_PURPLE, squashY: 1.5 });
  out.lights.push({
    x: lot.x + sx,
    y: lot.y + sy - r,
    radius: 150,
    color: TINT_HEX[TINT_GOLD]!,
    intensity: 0.8,
  });
  out.lights.push({
    x: lot.x + 170,
    y: lot.y + d - r - 30,
    radius: 150,
    color: TINT_HEX[TINT_PURPLE]!,
    intensity: 0.7,
  });
}

// --- Neon tower ----------------------------------------------------------------------------

const DRUM_R = 24;
const DRUM_RISE = 10;
const RING_BOX_W = 50;
const RINGS = [
  { r: 22, rise: 26, c: PAL.cyan, hi: PAL.cyanHi, dim: PAL.cyanDim },
  { r: 16, rise: 46, c: PAL.purple, hi: PAL.purpleHi, dim: PAL.purpleDim },
  { r: 8, rise: 52, c: PAL.coral, hi: PAL.coralHi, dim: PAL.coralDim },
] as const;
const MAST_RISE = 104;
/** Rows from the top of the ring sprite to the foot of the mast. */
export const RING_BOX_H = RINGS[2].rise + RINGS[2].r + 2;

/**
 * Ring neon for the tower, drawn relative to the foot of the mast at (cx, cy). `state` per
 * ring: 0 dim, 1 on, 2 hot. The rings are level circles, so they stay round in this view and
 * simply stack up the screen.
 */
export function drawTowerRings(
  cv: Canvas,
  cx: number,
  cy: number,
  state: readonly [number, number, number],
): void {
  emissive(cv, () => {
    RINGS.forEach((ring, k) => {
      const st = state[k]!;
      const ry = cy - ring.rise;
      cv.ring(cx - 0.5, ry - 0.5, ring.r + 1, st > 0 ? ring.dim : PAL.inkSoft, 4);
      cv.ring(cx - 0.5, ry - 0.5, ring.r, st === 0 ? ring.dim : ring.c, 2);
      if (st === 2) cv.ring(cx - 0.5, ry - 0.5, ring.r, ring.hi, 2);
      else if (st === 1) {
        // Hot core on the lit quadrant only.
        for (let a = Math.PI; a < Math.PI * 1.5; a += 0.02)
          cv.set(
            Math.round(cx - 0.5 + Math.cos(a) * (ring.r - 0.5)),
            Math.round(ry - 0.5 + Math.sin(a) * (ring.r - 0.5)),
            ring.hi,
          );
      }
    });
  });
}

/** Aircraft warning beacon on its cap. `level` 0 off, 1 dim, 2 bright. Canvas is 14 by 14. */
export function drawTowerHub(cv: Canvas, cx: number, cy: number, level: number): void {
  cv.rect(cx - 2, cy, 4, 5, PAL.steelDark);
  cv.hline(cx - 3, cy + 5, 6, PAL.steel);
  emissive(cv, () => {
    if (level === 2) {
      cv.rect(cx - 3, cy - 1, 6, 2, PAL.redDim);
      cv.rect(cx - 1, cy - 3, 2, 6, PAL.redDim);
      cv.rect(cx - 2, cy - 2, 4, 4, PAL.red);
      cv.rect(cx - 1, cy - 1, 2, 2, PAL.coralHi);
    } else if (level === 1) {
      cv.rect(cx - 2, cy - 2, 4, 4, PAL.redDim);
      cv.rect(cx - 1, cy - 1, 2, 2, PAL.red);
    } else {
      cv.rect(cx - 2, cy - 2, 4, 4, PAL.ink);
      cv.rect(cx - 1, cy - 1, 2, 2, PAL.redDim);
    }
  });
}

function paintTower(scene: Scene, sites: LandmarkSites, out: LightOut): void {
  const cx = sites.tower.x;
  const cy = sites.tower.y;
  const W = 2 * DRUM_R + 6;
  const H = MAST_RISE + 12 + DRUM_R + 1;
  const cv = Canvas.sprite(W, H);
  const mx = W >> 1;
  const my = MAST_RISE + 12;
  const slate = BUILDINGS[ROOF_SLATE]!;
  // Drum: south face first, then the deck.
  for (let x = -DRUM_R; x <= DRUM_R; x++) {
    const half = Math.sqrt(Math.max(0, (DRUM_R + 0.35) * (DRUM_R + 0.35) - x * x));
    const yb = Math.round(my + half);
    for (let v = 0; v < DRUM_RISE; v++) {
      const lit = x < -DRUM_R * 0.45;
      let c: Color = lit ? slate.wall : x > DRUM_R * 0.6 ? slate.line : slate.wallAlt;
      if (v === 0) c = PAL.ink;
      cv.set(mx + x, yb - v, c);
    }
    if ((x + 60) % 9 < 5 && Math.abs(x) < DRUM_R - 3)
      emissive(cv, () => cv.rect(mx + x, yb - 6, 1, 3, x % 18 < 9 ? PAL.cyanDim : PAL.cyan));
  }
  cv.disc(mx - 0.5, my - DRUM_RISE - 0.5, DRUM_R, slate.rim);
  cv.disc(mx - 0.5, my - DRUM_RISE - 0.5, DRUM_R - 1, slate.roofLine);
  cv.disc(mx - 0.5, my - DRUM_RISE + 0.5, DRUM_R - 3, slate.roof);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    cv.line(
      mx,
      my - DRUM_RISE,
      mx + Math.cos(a) * (DRUM_R - 4),
      my - DRUM_RISE + Math.sin(a) * (DRUM_R - 4),
      slate.roofLine,
    );
  }
  // Lattice mast, tapering, banded in warning paint, with a platform under each ring.
  for (let v = DRUM_RISE; v <= MAST_RISE; v++) {
    const t = (v - DRUM_RISE) / (MAST_RISE - DRUM_RISE);
    const half = Math.round(7 - t * 5);
    const y = my - v;
    const band = Math.floor(v / 13) % 2 === 0;
    const hi = band ? PAL.ivory : PAL.coralHi;
    const mid = band ? PAL.kerbIvoryDark : PAL.coral;
    const lo = band ? PAL.steel : PAL.coralDim;
    cv.set(mx - half, y, hi);
    cv.set(mx - half + 1, y, mid);
    cv.set(mx + half, y, lo);
    cv.set(mx + half - 1, y, lo);
    const span = half * 2 - 3;
    if (span > 0) {
      const m = v % (span * 2);
      cv.set(mx - half + 2 + (m < span ? m : span * 2 - 1 - m), y, mid);
      if (v % 13 === 0) cv.hline(mx - half, y, half * 2 + 1, hi);
    }
  }
  for (const ring of RINGS) {
    const y = my - ring.rise;
    cv.rect(mx - 6, y - 1, 12, 3, PAL.steelDark);
    cv.hline(mx - 6, y - 1, 12, PAL.steelLight);
  }
  emissive(cv, () => {
    // A string of cyan marker lights up the west leg.
    for (let v = DRUM_RISE + 6; v < MAST_RISE; v += 9) {
      const t = (v - DRUM_RISE) / (MAST_RISE - DRUM_RISE);
      cv.set(mx - Math.round(7 - t * 5) - 1, my - v, PAL.cyan);
    }
  });
  drawTowerRings(cv, mx, my, [1, 1, 1]);
  // The beacon on top is an animated prop of its own.
  const item = { art: cv, x: cx - mx, y: cy - my, baseY: cy + DRUM_R };
  scene.addSplit(item, { id: 'neon_tower_top', kind: 'tower_top', fade: true });
  scene.footprint(cx - DRUM_R, cy - DRUM_R, DRUM_R * 2, DRUM_R * 2, 8);
  sites.rings = { x: cx - RING_BOX_W / 2, y: cy - RING_BOX_H };
  sites.beacon = { x: cx - 7, y: cy - MAST_RISE - 12 };
  out.pools.push({ x: cx, y: cy + DRUM_R + 20, radii: [34, 58], tint: TINT_CYAN, squashY: 1.3 });
  out.pools.push({ x: cx, y: cy - 70, radii: [26, 44], tint: TINT_PURPLE });
  out.lights.push({ x: cx, y: cy - 30, radius: 70, color: TINT_HEX[TINT_CYAN]!, intensity: 0.8 });
}

// --- Harbor --------------------------------------------------------------------------------

const CRANE_Y = col('#D9A63E');
const CRANE_DK = col('#8C6628');
const CRANE_DEEP = col('#5A4222');
const HULL = col('#5A2B36');
const HULL_HI = col('#8C4652');
const HULL_DK = col('#3A1C28');
const DECK = col('#2F3850');
const DECK_LINE = col('#262E44');

const CRANE_RISE = 62;

/** Portal crane: four legs on the quay rails, a boom far out over the water, a load on wires. */
function crane(scene: Scene, x: number, out: LightOut, seed: number): void {
  const railA = 2566;
  const railB = 2586;
  const land = 2532;
  const tip = 2746;
  const top = land - CRANE_RISE - 10;
  const W = 66;
  const H = tip + 4 - top;
  const cv = Canvas.sprite(W, H);
  const mx = W >> 1;
  const Y = (wy: number): number => wy - top;
  const leg = (lx: number, gy: number): void => {
    for (let v = 0; v <= CRANE_RISE; v++) {
      cv.set(lx, Y(gy) - v, CRANE_Y);
      cv.set(lx + 1, Y(gy) - v, CRANE_DK);
      cv.set(lx + 2, Y(gy) - v, CRANE_DEEP);
      if (v % 16 < 3 && v > 6) {
        cv.set(lx, Y(gy) - v, PAL.coral);
        cv.set(lx + 1, Y(gy) - v, PAL.coralDim);
      }
    }
    cv.rect(lx - 2, Y(gy) - 2, 7, 3, PAL.steelDark);
    cv.hline(lx - 2, Y(gy) - 2, 7, PAL.steel);
  };
  // Back legs and their bracing first.
  leg(mx - 27, railA);
  leg(mx + 24, railA);
  for (let k = 0; k <= 50; k++) {
    const yy = Y(railA) - 8 - Math.round((k / 50) * 30);
    cv.set(mx - 25 + k, yy, CRANE_DK);
    cv.set(mx + 24 - k, yy, CRANE_DEEP);
  }
  cv.rect(mx - 27, Y(railA) - 44, 54, 3, CRANE_DK);
  // A-frame over the landward legs, seen from the front as a triangle.
  const apexY = Y(railA) - CRANE_RISE - 22;
  for (let k = 0; k <= 26; k++) {
    const yy = Y(railA) - CRANE_RISE - Math.round((k / 26) * 22);
    cv.set(mx - 26 + k, yy, PAL.gold);
    cv.set(mx - 25 + k, yy, CRANE_Y);
    cv.set(mx + 26 - k, yy, CRANE_DK);
    cv.set(mx + 25 - k, yy, CRANE_DEEP);
  }
  cv.rect(mx - 2, apexY - 1, 5, 3, CRANE_Y);
  emissive(cv, () => cv.rect(mx - 1, apexY - 3, 2, 2, PAL.red));
  // Front legs and the portal beam.
  leg(mx - 27, railB);
  leg(mx + 24, railB);
  cv.rect(mx - 27, Y(railB) - 44, 54, 4, CRANE_Y);
  cv.hline(mx - 27, Y(railB) - 44, 54, PAL.gold);
  cv.hline(mx - 27, Y(railB) - 41, 54, CRANE_DEEP);
  for (let k = 0; k < 54; k += 6) cv.rect(mx - 27 + k, Y(railB) - 43, 3, 2, PAL.coral);
  // Side girders at the top, tying the legs together under the boom.
  for (const lx of [mx - 27, mx + 24]) {
    for (let wy = railA; wy <= railB; wy++) {
      cv.set(lx, Y(wy) - CRANE_RISE, PAL.gold);
      cv.set(lx + 1, Y(wy) - CRANE_RISE, CRANE_Y);
      cv.set(lx + 2, Y(wy) - CRANE_RISE, CRANE_DK);
    }
  }
  cv.rect(mx - 27, Y(railB) - CRANE_RISE, 54, 4, CRANE_Y);
  cv.hline(mx - 27, Y(railB) - CRANE_RISE + 3, 54, CRANE_DEEP);
  // Hanging load: wires from the trolley down to a container over the water.
  const loadY = 2668;
  const loadRise = 26;
  const livery = LIVERIES[seed % LIVERIES.length]!;
  for (const wx of [mx - 9, mx + 8])
    for (let v = loadRise + CONTAINER_RISE; v < CRANE_RISE; v++)
      cv.set(wx, Y(loadY) - v, PAL.steelDark);
  const load = containerSprite(true, livery, false).art;
  cv.blit(load, mx - 15, Y(loadY) - loadRise - load.h + 7);
  // Boom: two chords with lacing, seen from above at full height, and its south end face.
  const by0 = Y(land) - CRANE_RISE;
  const by1 = Y(tip) - CRANE_RISE;
  for (let y = by0; y <= by1; y++) {
    const m = (y - by0) % 12;
    const zig = m < 6 ? m : 12 - m;
    cv.set(mx - 5 + Math.round((zig * 9) / 6), y, CRANE_DK);
    if (m === 0) cv.hline(mx - 5, y, 10, CRANE_Y);
    cv.set(mx - 7, y, PAL.gold);
    cv.set(mx - 6, y, CRANE_Y);
    cv.set(mx + 5, y, CRANE_Y);
    cv.set(mx + 6, y, CRANE_DK);
    if ((y - by0) % 24 < 3) {
      cv.set(mx - 7, y, PAL.coral);
      cv.set(mx - 6, y, PAL.coral);
      cv.set(mx + 5, y, PAL.coral);
      cv.set(mx + 6, y, PAL.coralDim);
    }
  }
  cv.rect(mx - 7, by1, 14, 5, CRANE_DEEP);
  cv.hline(mx - 7, by1, 14, CRANE_DK);
  cv.rect(mx - 7, by0 - 2, 14, 3, CRANE_DK);
  // Machinery house on the landward end, trolley and cab under the boom.
  drawBox(cv, mx - 12, by0 + 6 - 7, 24, 26, 7, PAL.kerbIvory, PAL.kerbIvoryDark);
  cv.rect(mx - 10, by0 + 3, 20, 3, PAL.kerbCoral);
  cv.rect(mx - 7, by0 + 12, 6, 6, PAL.steelDark);
  cv.rect(mx + 2, by0 + 12, 7, 4, PAL.steel);
  drawBox(cv, mx - 10, Y(loadY) - CRANE_RISE - 3, 20, 8, 4, PAL.steel, PAL.steelDark);
  drawBox(cv, mx + 8, Y(2612) - CRANE_RISE + 2, 11, 10, 8, PAL.kerbIvory, PAL.kerbIvoryDark);
  emissive(cv, () => {
    cv.rect(mx + 10, Y(2612) - CRANE_RISE + 14, 7, 3, PAL.windowWarm);
    cv.rect(mx - 1, by1 + 2, 2, 2, PAL.red);
    cv.rect(mx - 1, by0 - 2, 2, 2, PAL.red);
    // Floodlights under the portal.
    cv.rect(mx - 20, Y(railB) - 40, 3, 2, PAL.lamp);
    cv.rect(mx + 17, Y(railB) - 40, 3, 2, PAL.lamp);
  });
  const sx = x - mx;
  if (!scene.artFits(cv, sx, top)) console.warn(`crane at ${x} would cover drivable ground`);
  scene.add({ art: cv, x: sx, y: top, baseY: tip });
  // Ground shadows: boom, portal, and the load far below its container.
  scene.shadeRect(x - 7 + 14, land + 14, 14, tip - land);
  scene.shadeRect(x - 27 + 6, railA + 4, 56, railB - railA + 4);
  scene.shadeRect(x - 15 + 12, loadY - 12 + 10, 30, 13);
  for (const lx of [x - 27, x + 24])
    for (const ry of [railA, railB]) scene.footprint(lx, ry - 1, 3, 2, 10);
  out.pools.push({ x, y: 2552, radii: [44, 78], tint: TINT_COOL });
  out.pools.push({ x, y: 2640, radii: [24, 40], tint: TINT_GOLD });
  out.lights.push({ x, y: 2548, radius: 88, color: TINT_HEX[TINT_COOL]!, intensity: 0.9 });
}

/** Freighter: deck seen from above at freeboard height, the south side of the hull below it. */
function ship(
  scene: Scene,
  x0: number,
  yc: number,
  len: number,
  beam: number,
  rnd: () => number,
): void {
  const free = 9;
  const head = 30;
  const cv = Canvas.sprite(len, head + beam * 2 + 2 + free);
  const half = (u: number): number => {
    if (u < 0 || u >= len) return -1;
    if (u < 10) return beam - 7 + u * 0.7;
    if (u < len - 78) return beam;
    const t = (u - (len - 78)) / 78;
    return beam * Math.sqrt(Math.max(0, 1 - t * t));
  };
  const cy = head + beam;
  for (let u = 0; u < len; u++) {
    const hw = half(u);
    if (hw < 0) continue;
    const lo = Math.round(cy + hw);
    // Hull side below the deck edge.
    for (let v = 0; v < free; v++) {
      const c =
        v === free - 1
          ? PAL.waterDeep
          : v >= free - 3
            ? PAL.kerbCoralDark
            : v === 0
              ? HULL_HI
              : u > len - 40
                ? HULL_DK
                : HULL;
      cv.set(u, lo + v, c);
    }
    for (let v = -Math.ceil(hw); v <= Math.ceil(hw); v++) {
      const av = Math.abs(v);
      if (av > hw) continue;
      const rim = av > hw - 2.2 || u < 2 || half(u + 2) < av;
      let c: Color;
      if (rim) c = v < 0 || u < 2 ? HULL_HI : PAL.kerbIvoryDark;
      else c = u % 16 === 0 || v === 0 ? DECK_LINE : DECK;
      cv.set(u, cy + v, c);
    }
  }
  // Cargo, stowed in rows; back rows first.
  const rows = Math.floor((beam * 2 - 8) / 15);
  for (let rI = 0; rI < rows; rI++) {
    const v = -beam + 5 + rI * 15;
    for (let u = 66; u + 30 < len - 84; u += 32) {
      if (rnd() < 0.2) continue;
      const sp = containerSprite(true, LIVERIES[(rnd() * LIVERIES.length) | 0]!, rnd() < 0.4);
      cv.blit(sp.art, u, cy + v + 13 - sp.art.h);
    }
  }
  // Bridge house with lit windows toward the camera, funnel, mast.
  const bw = Math.min(42, Math.round(len * 0.12));
  const bd = beam * 2 - 16;
  const br = 18;
  const bx = 12;
  const byy = cy - beam + 8;
  drawBox(cv, bx, byy - br, bw, bd, br, PAL.kerbIvory, PAL.kerbIvoryDark);
  cv.frame(bx + 3, byy - br + 3, bw - 6, bd - 6, PAL.kerbShade);
  emissive(cv, () => {
    for (let k = 3; k + 3 < bw - 2; k += 5) {
      cv.rect(bx + k, byy - br + bd + 3, 3, 3, k % 10 === 3 ? PAL.windowWarm : PAL.windowMid);
      cv.rect(bx + k, byy - br + bd + 10, 3, 3, k % 15 === 3 ? PAL.windowMid : PAL.windowNight);
    }
  });
  const fxx = bx + (bw >> 1);
  const fyy = byy - br + (bd >> 1);
  for (let v = 0; v < 12; v++) cv.hline(fxx - 5, fyy - v, 11, v > 8 ? PAL.ink : PAL.kerbCoral);
  cv.hline(fxx - 5, fyy - 9, 11, PAL.kerbIvory);
  cv.vline(fxx - 5, fyy - 11, 12, PAL.coralHi);
  cv.vline(fxx + 5, fyy - 11, 12, PAL.coralDim);
  cv.vline(bx + bw - 6, byy - br - 12, 14, PAL.steelLight);
  cv.hline(bx + bw - 8, byy - br - 9, 5, PAL.steel);
  emissive(cv, () => {
    cv.set(bx + bw - 6, byy - br - 13, PAL.red);
    cv.set(len - 6, cy, PAL.mint);
  });
  scene.add({ art: cv, x: x0, y: yc - beam - head - free, baseY: yc + beam });
  for (let u = 0; u < len; u += 2) {
    const hw = half(u);
    if (hw > 0) scene.shadeRect(x0 + u + 6, Math.round(yc - hw) + 6, 2, Math.round(hw * 2));
  }
}

function boat(scene: Scene, x: number, y: number, paint: Color): void {
  const cv = Canvas.sprite(11, 24);
  const rows = [3, 5, 7, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 7];
  rows.forEach((wRow, k) => {
    const lx = 5 - (wRow >> 1);
    for (let j = 0; j < wRow; j++) {
      const rim = j === 0 || j === wRow - 1 || k === 0 || k === rows.length - 1;
      cv.set(
        lx + j,
        k,
        rim
          ? j === 0 || k === 0
            ? PAL.kerbIvory
            : PAL.kerbIvoryDark
          : k > 5 && k < 12
            ? paint
            : PAL.wood,
      );
    }
  });
  cv.rect(3, 7, 5, 3, PAL.glass);
  for (let j = 1; j < 10; j++) {
    cv.set(j, 19, PAL.kerbIvoryDark);
    cv.set(j, 20, darker(paint, 0.3));
    cv.set(j, 21, darker(paint, 0.3));
    cv.set(j, 22, PAL.waterDeep);
  }
  scene.add({ art: cv, x, y: y - 3, baseY: y + 19 });
  scene.shadeRect(x + 3, y + 3, 9, 19);
}

function paintWarehouse(scene: Scene, lot: Lot, out: LightOut): void {
  const b = BUILDINGS[lot.family]!;
  const r = allowedRise(scene, lot);
  const w = lot.w;
  const d = lot.h;
  const cv = Canvas.sprite(w, d + r);
  const ridge = d >> 1;
  paintRoofSurface(cv, 0, 0, w, d, b, (lx, ly) => {
    if (ly === ridge || ly === ridge - 1) return b.rim;
    if (ly === ridge + 1) return b.roofLine;
    // The slope away from the light is a tone down.
    const south = ly > ridge;
    return lx % 6 === 5 ? b.roofLine : south ? b.roofAlt : b.roof;
  });
  for (let sx = 14; sx + 20 < w - 10; sx += 30) {
    const lit = hash2(lot.x + sx, lot.y, 71) < 0.55;
    for (const sy of [8, d - 20]) {
      cv.rect(sx, sy, 20, 9, PAL.steelDark);
      cv.hline(sx, sy, 20, PAL.steelLight);
      for (let yy = 1; yy < 8; yy++) {
        for (let xx = 1; xx < 19; xx++) {
          if (xx % 5 === 0) continue;
          if (lit)
            emissive(cv, () => cv.set(sx + xx, sy + yy, yy === 1 ? PAL.windowWarm : PAL.windowMid));
          else cv.set(sx + xx, sy + yy, PAL.glass);
        }
      }
    }
  }
  const label = lot.x < 1500 ? 'DOCK 7' : 'PIER 12';
  // Facade: corrugated wall, loading doors, the name in tall paint.
  const fy = d;
  for (let ly = 0; ly < r; ly++)
    for (let lx = 0; lx < w; lx++) cv.set(lx, fy + ly, lx % 3 === 2 ? b.wallAlt : b.wall);
  cv.hline(0, fy, w, b.trim);
  cv.hline(0, fy + 1, w, b.line);
  cv.vline(w - 1, fy, r, b.line);
  cv.hline(0, fy + r - 1, w, PAL.ink);
  const tw = textWidth(label, 'micro', 2);
  const tx = (w - tw) >> 1;
  drawText(cv, tx, fy + 5, label, mixc(b.trim, PAL.kerbIvory, 0.4), 'micro', 2);
  for (let x = 8; x + 22 < w - 6; x += 34) {
    if (x + 22 > tx - 6 && x < tx + tw + 6) continue;
    const lit = hash2(lot.x + x, 5, 73) < 0.4;
    cv.rect(x - 1, fy + 5, 24, r - 6, b.line);
    for (let yy = fy + 6; yy < fy + r - 1; yy++) {
      if (lit && yy > fy + 10)
        emissive(cv, () => cv.hline(x, yy, 22, yy === fy + 11 ? PAL.windowWarm : PAL.windowMid));
      else cv.hline(x, yy, 22, (yy & 1) === 0 ? PAL.steel : PAL.steelDark);
    }
    emissive(cv, () => cv.set(x + 11, fy + 3, PAL.lamp));
    if (lit)
      out.pools.push({
        x: lot.x + x + 11,
        y: lot.y + d + 3,
        radii: [12, 20],
        tint: TINT_WARM,
        squashY: 1.5,
      });
  }
  scene.add(standBox(cv, lot.x, lot.y, d, r));
  scene.footprint(lot.x, lot.y, w, d, 6);
}

function paintHarbor(ctx: BakeContext, scene: Scene, layout: CityLayout, out: LightOut): void {
  const cv = ctx.world;
  const rnd = mulberry32(ctx.seed ^ 0x4a7b0);
  const H = HARBOR;
  const worldH = ctx.def.worldHeight;
  // Quay edge: a lit coping, then the wall dropping to the water, hung with fenders.
  for (let x = H.x0; x < H.x1; x++) {
    cv.set(x, H.water - 2, PAL.wallHi);
    cv.set(x, H.water - 1, PAL.wallCap);
    for (let v = 0; v < 7; v++)
      cv.set(
        x,
        H.water + v,
        v === 6
          ? PAL.waterDeep
          : x % 22 === 0
            ? PAL.wallBase
            : v < 2
              ? PAL.wallShade
              : darker(PAL.wallShade, 0.3),
      );
    if (x % 44 > 19 && x % 44 < 24)
      for (let v = 1; v < 6; v++)
        cv.set(x, H.water + v, v === 1 || v === 5 ? PAL.ink : PAL.inkSoft);
    if (((x >> 3) & 3) < 3) cv.set(x, H.water - 9, PAL.paintGoldWorn);
  }
  for (let x = H.x0 + 20; x < H.x1; x += 64) {
    if (x > 2196 && x < 2600) continue;
    stand(scene, bollardSprite(), x, H.water - 4, 3, 2);
  }
  // The basin's side walls.
  for (let y = H.water; y < worldH; y++) {
    for (const [x, c] of [
      [H.x0, PAL.wallCap],
      [H.x0 + 1, PAL.wallShade],
      [H.x0 + 2, PAL.wallBase],
      [H.x1 - 3, PAL.wallHi],
      [H.x1 - 2, PAL.wallCap],
      [H.x1 - 1, PAL.wallShade],
    ] as const)
      cv.set(x, y, c);
  }
  // Crane rails.
  for (let x = 880; x < 2740; x++) {
    for (const ry of [2566, 2586]) {
      cv.set(x, ry, x % 9 === 0 ? PAL.steelDark : PAL.railMid);
      cv.set(x, ry + 1, PAL.railGroove);
    }
  }
  // Container yard: blocks of three rows with aisles, kept clear under the cranes.
  const cranes = [1480, 2060];
  let x = 890;
  while (x < 2700) {
    const cols = 3 + ((rnd() * 5) | 0);
    const bw = cols * 15;
    if (x + bw > 2730) break;
    if (cranes.some((c) => x < c + 40 && c - 40 < x + bw)) {
      x += 15;
      continue;
    }
    cv.frame(x - 3, H.y0 + 12, bw + 4, 100, PAL.paintGoldWorn);
    const livery = LIVERIES[(rnd() * LIVERIES.length) | 0]!;
    for (let row = 0; row < 3; row++) {
      for (let c = 0; c < cols; c++) {
        if (rnd() < 0.2) continue;
        const paint = rnd() < 0.55 ? livery : LIVERIES[(rnd() * LIVERIES.length) | 0]!;
        // Nothing is stacked in the row beside the road: that strip stays low.
        const stacked = row > 0 && rnd() < 0.4;
        const sp = containerSprite(false, paint, stacked);
        const gx = x + c * 15 + 6;
        const gy = H.y0 + 15 + row * 32 + 29;
        if (!scene.spriteFits(sp, gx, gy)) continue;
        scene.place(sp, gx, gy, undefined, true);
        scene.footprint(gx - 6, gy - 29, 13, 30, stacked ? 5 : 3);
      }
    }
    x += bw + 20 + ((rnd() * 3) | 0) * 6;
  }
  // Timber pier with moored boats.
  const px = 1150;
  for (let y = H.water; y < H.water + 96; y++) {
    for (let k = 0; k < 22; k++) {
      const edge = k === 0 || k === 21;
      cv.set(
        px + k,
        y,
        edge
          ? PAL.woodDark
          : (y - H.water) % 4 === 3
            ? PAL.woodDark
            : hash2(k >> 2, y >> 2, 44) < 0.3
              ? PAL.woodLight
              : PAL.wood,
      );
    }
  }
  for (let k = 0; k < 22; k++)
    for (let v = 0; v < 4; v++)
      cv.set(
        px + k,
        H.water + 96 + v,
        v === 3 ? PAL.waterDeep : k % 7 === 0 ? PAL.ink : PAL.woodDark,
      );
  scene.shadeRect(px + 22, H.water + 4, 3, 96);
  boat(scene, px - 16, H.water + 14, PAL.kerbCoral);
  boat(scene, px - 16, H.water + 48, PAL.cyanDim);
  boat(scene, px + 28, H.water + 30, PAL.goldDim);
  standLantern(scene, out, px + 11, H.water + 92, TINT_WARM, [14, 26]);
  // Ships and cranes.
  ship(scene, 2196, 2662, 400, 37, rnd);
  ship(scene, 760, 2752, 250, 30, rnd);
  for (const c of cranes) crane(scene, c, out, c);
  // Lamps along the quay.
  for (let lx = H.x0 + 330; lx < H.x1 - 320; lx += 150) {
    if (cranes.some((c) => Math.abs(c - lx) < 50)) continue;
    standLantern(scene, out, lx, H.water - 12, TINT_COOL, [16, 30]);
  }
  // Channel buoys.
  emissive(cv, () => {
    for (const [bx, by, c] of [
      [1700, 2740, PAL.red],
      [1900, 2776, PAL.mint],
      [1320, 2770, PAL.red],
      [2700, 2760, PAL.mint],
    ] as const)
      cv.rect(bx, by, 2, 2, c);
  });
  for (const [bx, by, tint] of [
    [1700, 2740, 2],
    [1900, 2776, 1],
    [1320, 2770, 2],
    [2700, 2760, 1],
  ] as const)
    out.pools.push({ x: bx + 1, y: by + 1, radii: [5, 10], tint });
  for (const lot of layout.lots)
    if (lot && lot.tag === 'warehouse') paintWarehouse(scene, lot, out);
}

// --- Tram viaduct --------------------------------------------------------------------------

const BALLAST = col('#3A4058');
const BALLAST_LIGHT = col('#454C66');

/**
 * Rail deck seen in the oblique view, for world columns x0 to x1: the deck from above, then the
 * girder's south face. Row 0 of the art is the north edge of the deck.
 */
export function drawViaductDeck(cv: Canvas, ox: number, x0: number, x1: number): void {
  for (let x = x0; x < x1; x++) {
    for (let dy = -VIADUCT_HALF; dy < VIADUCT_HALF; dy++) {
      let c: Color;
      const sleeper = x % 5 < 2;
      const track1 = dy >= -14 && dy <= -3;
      const track2 = dy >= 2 && dy <= 13;
      if (dy === -17) c = PAL.steelHi;
      else if (dy === -16) c = PAL.steelLight;
      else if (dy === -15) c = PAL.steelDark;
      else if (dy === 14) c = PAL.steelDark;
      else if (dy === 15) c = PAL.steelLight;
      else if (dy === 16) c = PAL.steelHi;
      else if (dy === -11 || dy === -5 || dy === 4 || dy === 10) c = PAL.rail;
      else if (dy === -10 || dy === -4 || dy === 5 || dy === 11) c = PAL.railGroove;
      else if ((track1 || track2) && sleeper) c = PAL.wood;
      else if (dy === -2 || dy === 1) c = PAL.steelDark;
      else if (dy === -1 || dy === 0) c = x % 8 === 0 ? PAL.steelDark : PAL.steel;
      else c = hash2(x >> 1, dy, 55) < 0.2 ? BALLAST_LIGHT : BALLAST;
      cv.set(x - ox, dy + VIADUCT_HALF, c);
    }
    // Riveted plate girder.
    for (let v = 0; v < VIADUCT_GIRDER; v++) {
      const c =
        v === 0
          ? PAL.steel
          : v === VIADUCT_GIRDER - 1
            ? PAL.ink
            : x % 16 === 0
              ? PAL.steelDark
              : x % 16 === 8 && v === 3
                ? PAL.steel
                : PAL.wallShade;
      cv.set(x - ox, VIADUCT_HALF * 2 + v, c);
    }
    // Catenary masts on the center walkway.
    if (x % 56 === 28) {
      for (let v = 0; v < 12; v++)
        cv.set(x - ox, VIADUCT_HALF - 1 - v, v > 9 ? PAL.steelHi : PAL.inkSoft);
      cv.hline(x - 4 - ox, VIADUCT_HALF - 11, 9, PAL.inkSoft);
    }
  }
}

/** A two-car tram on the upper track, frozen at the platform. */
function drawTram(cv: Canvas, x: number, y: number): void {
  for (let car = 0; car < 2; car++) {
    const cx = x + car * 44;
    drawBox(cv, cx, y - 7, 42, 9, 7, PAL.kerbIvory, PAL.kerbIvoryDark);
    cv.rect(cx + 2, y - 5, 38, 2, PAL.kerbCoral);
    cv.rect(cx + 16, y - 3, 9, 3, PAL.steel);
    cv.hline(cx, y + 2, 42, PAL.kerbCoral);
    emissive(cv, () => {
      for (let k = 0; k < 8; k++)
        cv.rect(cx + 4 + k * 4.5, y + 3, 3, 3, k % 3 === 1 ? PAL.windowMid : PAL.windowWarm);
    });
  }
  emissive(cv, () => {
    cv.set(x + 86, y + 6, PAL.ivory);
    cv.set(x - 1, y + 6, PAL.red);
  });
}

function paintViaduct(
  scene: Scene,
  layout: CityLayout,
  sites: LandmarkSites,
  worldW: number,
  out: LightOut,
): void {
  const yc = sites.viaduct.y;
  const top = yc - VIADUCT_HALF - VIADUCT_RISE;
  const under = VIADUCT_RISE - VIADUCT_GIRDER;
  const segment = (x0: number, x1: number, tram: boolean): void => {
    const head = 14;
    const cv = Canvas.sprite(x1 - x0, head + VIADUCT_HALF * 2 + VIADUCT_RISE);
    // Piers stand under the deck: draw them first, the deck goes over their heads.
    for (let x = x0; x < x1; x++) {
      const m = ((x % 64) + 64) % 64;
      if (m >= 8) continue;
      for (let v = 0; v < under + 4; v++) {
        const c = m === 0 ? PAL.kerb : m === 7 ? PAL.steelDark : v === 0 ? PAL.ink : PAL.kerbShade;
        cv.set(x - x0, head + VIADUCT_HALF * 2 + VIADUCT_RISE - 1 - v, c);
      }
    }
    const deck = new Canvas(x1 - x0, VIADUCT_HALF * 2 + VIADUCT_GIRDER);
    drawViaductDeck(deck, x0, x0, x1);
    cv.blit(deck, 0, head);
    if (tram) drawTram(cv, 24, head + 4);
    scene.add({ art: cv, x: x0, y: top - head, baseY: yc + VIADUCT_HALF - 1 });
    scene.shadeRect(x0 + 8, yc - VIADUCT_HALF + 10, x1 - x0, VIADUCT_HALF * 2);
    for (let x = x0; x < x1; x++)
      if (((x % 64) + 64) % 64 === 0) scene.footprint(x, yc + VIADUCT_HALF - 3, 8, 3, 4);
  };
  segment(sites.viaduct.west, sites.viaduct.roadX0, true);
  segment(sites.viaduct.roadX1, worldW, false);
  // Abutments either side of the road: chunky piers with hazard paint, outside the corridor.
  for (const ax of [sites.viaduct.roadX0 - 8, sites.viaduct.roadX1]) {
    const cv = Canvas.sprite(8, under + 6);
    for (let v = 0; v < under + 6; v++) {
      for (let k = 0; k < 8; k++) {
        const stripe = (Math.floor((v + k) / 3) & 1) === 0;
        cv.set(
          k,
          under + 5 - v,
          v === 0
            ? PAL.ink
            : v < 14
              ? stripe
                ? PAL.paintGold
                : PAL.ink
              : k === 0
                ? PAL.kerb
                : k === 7
                  ? PAL.steelDark
                  : PAL.kerbShade,
        );
      }
    }
    if (scene.artFits(cv, ax, yc + VIADUCT_HALF + 1 - under - 6))
      scene.add({ art: cv, x: ax, y: yc + VIADUCT_HALF + 1 - under - 6, baseY: yc + VIADUCT_HALF });
  }
  // Station: the deck runs into its upper floor. Glazed train shed on top, a lit hall below.
  const lot = layout.lots.find((l) => l?.tag === 'station');
  if (lot) {
    const b = BUILDINGS[lot.family]!;
    const r = allowedRise(scene, lot);
    const w = lot.w;
    const d = lot.h;
    const cv = Canvas.sprite(w, d + r);
    paintRoofSurface(cv, 0, 0, w, d, b, (lx, ly) =>
      lx % 16 === 15 || ly % 16 === 15 ? b.roofLine : b.roof,
    );
    const gy = 30;
    cv.rect(6, gy, w - 12, 36, PAL.steelDark);
    for (let yy = 1; yy < 35; yy++) {
      for (let xx = 1; xx < w - 13; xx++) {
        const rib = xx % 9 === 0 || yy === 17 || yy === 18;
        if (rib) cv.set(6 + xx, gy + yy, PAL.steel);
        else if ((xx + yy * 2) % 11 === 0) cv.set(6 + xx, gy + yy, PAL.glassLight);
        else
          emissive(cv, () =>
            cv.set(6 + xx, gy + yy, yy < 17 ? PAL.glass : darker(PAL.glassLight, 0.25)),
          );
      }
    }
    cv.hline(6, gy, w - 12, PAL.steelLight);
    cv.rect(22, 8, 68, 16, PAL.ink);
    cv.frame(22, 8, 68, 16, b.rimLow);
    neonText(cv, 27, 11, 'TRAM', 0, 2);
    neonText(cv, 64, 13, 'LINE 5', 3, 1);
    const fy = d;
    for (let ly = 0; ly < r; ly++)
      for (let lx = 0; lx < w; lx++) cv.set(lx, fy + ly, lx % 14 === 13 ? b.wallAlt : b.wall);
    cv.hline(0, fy, w, b.trim);
    cv.hline(0, fy + 1, w, b.line);
    cv.vline(w - 1, fy, r, b.line);
    cv.hline(0, fy + r - 1, w, PAL.ink);
    for (let k = 0; k < 5; k++) {
      const ax = 8 + k * 20;
      cv.rect(ax, fy + 5, 14, r - 6, b.line);
      emissive(cv, () => {
        cv.rect(ax + 1, fy + 7, 12, r - 9, PAL.windowMid);
        cv.hline(ax + 3, fy + 5, 8, PAL.windowWarm);
        cv.hline(ax + 2, fy + 6, 10, PAL.windowWarm);
        cv.vline(ax + 6, fy + 7, r - 9, PAL.windowDim);
        cv.hline(ax + 1, fy + 13, 12, PAL.windowDim);
      });
    }
    scene.add(standBox(cv, lot.x, lot.y, d, r));
    scene.footprint(lot.x, lot.y, w, d, 7);
    out.pools.push({
      x: lot.x + w / 2,
      y: lot.y + d + 8,
      radii: [40, 62],
      tint: TINT_WARM,
      squashY: 1.8,
    });
    out.lights.push({
      x: lot.x + 56,
      y: lot.y + 16 - r,
      radius: 46,
      color: TINT_HEX[TINT_CYAN]!,
      intensity: 0.5,
    });
  }
}

// --- Start line ----------------------------------------------------------------------------

function paintGrandstand(scene: Scene, lot: Lot, sites: LandmarkSites, out: LightOut): void {
  const b = BUILDINGS[lot.family]!;
  const w = lot.w;
  const d = lot.h;
  const canopyRise = allowedRise(scene, lot);
  const seats: readonly Color[] = [
    PAL.coral,
    PAL.cyanDim,
    PAL.gold,
    PAL.purple,
    PAL.kerbIvory,
    PAL.mintDim,
    PAL.kerbCoral,
    PAL.steelLight,
  ];
  // Tiers climb away from the track: each is a tread seen from above and a riser below it.
  const TIERS = 8;
  const TREAD = 6;
  const STEP = 3;
  const front = 6;
  const cv = Canvas.sprite(w, canopyRise + d);
  const baseRow = canopyRise + d - 1;
  // Back wall up to the canopy.
  const backY = baseRow - TIERS * (TREAD + STEP) - front;
  cv.rect(0, 30, w, backY - 26, b.wallLow);
  for (let x = 6; x < w; x += 19) cv.vline(x, 30, backY - 26, b.line);
  for (let t = TIERS - 1; t >= 0; t--) {
    const y0 = baseRow - front - (t + 1) * (TREAD + STEP) + 1;
    for (let x = 0; x < w; x++) {
      const aisle = x % 38 < 3 || x < 2 || x >= w - 2;
      for (let k = 0; k < TREAD; k++) {
        let c: Color = t % 2 === 0 ? b.roofAlt : b.roof;
        if (aisle) c = b.rimLow;
        else if (k >= 1 && k <= 3 && x % 3 !== 2) {
          const hsh = hash2((x / 3) | 0, t, 6021);
          if (hsh < 0.78) {
            const seat = seats[(hash2((x / 3) | 0, t, 6022) * seats.length) | 0]!;
            c = k === 1 ? lighter(seat, 0.2) : k === 2 ? seat : darker(seat, 0.4);
          } else c = k === 3 ? b.inner : b.roofLine;
        }
        cv.set(x, y0 + k, c);
      }
      for (let k = 0; k < STEP; k++)
        cv.set(x, y0 + TREAD + k, aisle ? b.line : k === 0 ? b.wall : b.line);
    }
  }
  // Front wall on the collision edge, with hoardings.
  for (let x = 0; x < w; x++) {
    for (let k = 0; k < front; k++) {
      const board = Math.floor(x / 38) % 3;
      let c: Color = k === 0 ? b.trim : k === front - 1 ? PAL.ink : b.wall;
      if (k > 0 && k < front - 1 && x % 38 > 3 && x % 38 < 36)
        c = board === 0 ? PAL.coralDim : board === 1 ? PAL.cyanDim : PAL.purpleDim;
      cv.set(x, baseRow - front + 1 + k, c);
    }
  }
  // Canopy over the back rows, on columns, its fascia facing the track.
  const cd = 26;
  const cy0 = 0;
  for (let x = 8; x < w; x += 53) {
    cv.vline(x, cy0 + cd, backY - cd + 4, PAL.steelLight);
    cv.vline(x + 1, cy0 + cd, backY - cd + 4, PAL.steelDark);
  }
  paintRoofSurface(cv, 0, cy0, w, cd, b, (lx) => (lx % 14 === 13 ? b.roofLine : b.roof));
  cv.rect(0, cy0 + cd, w, 9, PAL.ink);
  cv.hline(0, cy0 + cd, w, b.trim);
  const text = 'BOLT RIVALS GRAND PRIX';
  neonText(cv, (w - textWidth(text, 'micro', 1)) >> 1, cy0 + cd + 2, text, 3, 1);
  emissive(cv, () => {
    for (let x = 6; x < w - 4; x += 12) cv.rect(x, cy0 + cd + 9, 2, 1, PAL.lamp);
  });
  cv.hline(0, cy0 + cd + 9, w, b.line);
  scene.add({ art: cv, x: lot.x, y: lot.y - canopyRise, baseY: lot.y + d - 1 });
  scene.footprint(lot.x, lot.y, w, d, 8);
  // Flood pools on the grid: the best lit place on the circuit.
  out.pools.push({
    x: sites.start.x + 14,
    y: sites.start.y,
    radii: [110, 168],
    tint: TINT_COOL,
    squashY: 1.55,
  });
  for (const dy of [-44, 44])
    out.lights.push({
      x: sites.start.x + 10,
      y: sites.start.y + dy,
      radius: 110,
      color: TINT_HEX[TINT_COOL]!,
      intensity: 1,
    });
}

function paintPlazaDressing(
  ctx: BakeContext,
  scene: Scene,
  layout: CityLayout,
  sites: LandmarkSites,
  out: LightOut,
): void {
  const { field } = ctx;
  const ok = (x: number, y: number, m: number): boolean => {
    for (const [px, py] of [
      [x - m, y - m],
      [x + m, y - m],
      [x - m, y + m],
      [x + m, y + m],
    ] as const) {
      if (px < 0 || py < 0 || px >= field.w || py >= field.h) return false;
      const i = py * field.w + px;
      if (field.edge[i]! < 12 || layout.roofId[i] !== 0 || layout.ground[i] !== G_PLAZA)
        return false;
    }
    return true;
  };
  const planter = (x: number, y: number, r: number, warm: boolean): void => {
    if (!ok(x, y, 4)) return;
    ctx.world.rect(x - 5, y - 4, 10, 7, PAL.kerbShade);
    ctx.world.rect(x - 4, y - 3, 8, 5, PAL.soil);
    plantTree(scene, x, y, r, x * 5 + y, warm);
  };
  const lamp = (x: number, y: number, tint: number): void => {
    if (!ok(x, y, 3)) return;
    standLantern(scene, out, x, y, tint, [14, 26]);
  };
  // Clock square: trees round the hall, lamps on the axes.
  const c = sites.clock;
  for (const [dx, dy] of [
    [66, -66],
    [84, -30],
    [84, 30],
    [66, 70],
    [20, -70],
    [-30, -66],
    [-28, 70],
    [20, 74],
  ] as const)
    planter(c.x + dx, c.y + dy, 7, (dx + dy) % 3 === 0);
  lamp(c.x + 70, c.y, TINT_GOLD);
  lamp(c.x - 6, c.y - 68, TINT_GOLD);
  lamp(c.x - 30, c.y + 62, TINT_GOLD);
  lamp(c.x + 44, c.y + 62, TINT_GOLD);
  // Arcade forecourt.
  const a = sites.arcade;
  for (let x = a.x + 10; x < a.x + a.w; x += 44) {
    planter(x, a.y - 4, 5, true);
    planter(x + 22, a.y + a.h + 22, 6, false);
  }
  for (let y = a.y + 14; y < a.y + a.h; y += 40) {
    planter(a.x - 8, y, 5, false);
    planter(a.x + a.w + 7, y + 20, 5, true);
  }
  for (let x = a.x + 34; x < a.x + a.w; x += 54) lamp(x, a.y + a.h + 14, TINT_PURPLE);
  // Tower island.
  const t = sites.tower;
  for (const dx of [-32, 32]) planter(t.x + dx, t.y + 6, 5, dx > 0);
  // Grandstand ends.
  const s = sites.start;
  for (const dx of [-120, 120]) lamp(s.x + dx, s.y - 150, TINT_COOL);
}

export function paintLandmarks(
  ctx: BakeContext,
  scene: Scene,
  layout: CityLayout,
  sites: LandmarkSites,
  out: LightOut,
): void {
  const cv = ctx.world;
  cv.curFlags = 0;
  paintHarbor(ctx, scene, layout, out);
  paintPlazaDressing(ctx, scene, layout, sites, out);
  for (const lot of layout.lots) {
    if (!lot || !lot.tag) continue;
    if (lot.tag === 'clock') paintClock(scene, lot, out);
    else if (lot.tag === 'arcade') paintArcade(scene, lot, out);
    else if (lot.tag === 'grandstand') paintGrandstand(scene, lot, sites, out);
  }
  paintTower(scene, sites, out);
  paintViaduct(scene, layout, sites, ctx.def.worldWidth, out);
}
