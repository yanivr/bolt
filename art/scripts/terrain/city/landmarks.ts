import { hash2, mulberry32 } from '@bolt/shared';
import type { TerrainLight } from '@bolt/shared';
import type { BakeContext } from '../biome.js';
import type { Canvas, Color } from '../canvas.js';
import { col } from '../canvas.js';
import { drawText, textWidth } from '../font.js';
import type { LightPool } from '../lighting.js';
import type { CityLayout, FixedLot, Lot, Reserve } from './layout.js';
import { G_PLAZA, G_QUAY, G_WATER } from './layout.js';
import { neonText } from './neon.js';
import {
  LIVERIES,
  PAL,
  ROOFS,
  ROOF_CONCRETE,
  ROOF_OLIVE,
  ROOF_PLUM,
  ROOF_SLATE,
  ROOF_TEAL,
  TINT_COOL,
  TINT_CYAN,
  TINT_GOLD,
  TINT_HEX,
  TINT_PURPLE,
  TINT_WARM,
  contactShade,
  darker,
  lighter,
} from './palette.js';
import { box, dropShadow, emissive, lampHead, tree } from './sprites.js';

/**
 * The five landmarks plus start line dressing. Each one is built for a silhouette that reads
 * from across the screen: a round lit clock, a giant star, concentric rings, crane booms over
 * water, and a rail deck striding across the avenue.
 */

export type LandmarkOutput = { pools: LightPool[]; lights: TerrainLight[]; claimed: Set<number> };

export type LandmarkSites = {
  clock: { x: number; y: number };
  arcade: { x: number; y: number; w: number; h: number };
  marquee: { x: number; y: number };
  tower: { x: number; y: number };
  viaduct: { y: number; roadX0: number; roadX1: number };
  start: { x: number; y: number };
};

const HARBOR = { x0: 560, x1: 3060, y0: 2452, water: 2600 };
export const VIADUCT_HALF = 17;

const propAt = (
  ctx: BakeContext,
  kind: string,
  fx: number,
  fy: number,
): { x: number; y: number } => {
  const p = ctx.def.props.find((q) => q.kind === kind);
  return p ? { x: Math.round(p.x), y: Math.round(p.y) } : { x: fx, y: fy };
};

export function planLandmarks(ctx: BakeContext): {
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
  const reserves: Reserve[] = [
    { x: clockLot.x - 10, y: clockLot.y - 28, w: 152, h: 156, ground: G_PLAZA },
    { x: arcadeLot.x - 14, y: arcadeLot.y - 14, w: 258, h: 152, ground: G_PLAZA },
    { x: tower.x - 62, y: tower.y - 40, w: 410, h: 82, ground: G_PLAZA },
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
    { x: start.x - 124, y: start.y - 200, w: 248, h: 92, ground: G_PLAZA },
    { x: viaduct.x - 560, y: viaduct.y - 58, w: 132, h: 116, ground: G_PLAZA },
  ];
  const fixed: FixedLot[] = [
    { ...clockLot, family: ROOF_CONCRETE, height: 20, tag: 'clock' },
    { ...arcadeLot, family: ROOF_PLUM, height: 9, tag: 'arcade' },
    {
      x: tower.x - 32,
      y: tower.y - 32,
      w: 64,
      h: 64,
      family: ROOF_SLATE,
      height: 16,
      tag: 'tower',
      round: true,
    },
    { x: tower.x + 196, y: tower.y - 24, w: 60, h: 46, family: ROOF_OLIVE, height: 5, tag: '' },
    {
      x: HARBOR.x0 + 24,
      y: HARBOR.y0 + 14,
      w: 250,
      h: 96,
      family: ROOF_TEAL,
      height: 8,
      tag: 'warehouse',
    },
    {
      x: HARBOR.x1 - 300,
      y: HARBOR.y0 + 14,
      w: 276,
      h: 96,
      family: ROOF_SLATE,
      height: 8,
      tag: 'warehouse',
    },
    {
      x: start.x - 114,
      y: start.y - 190,
      w: 228,
      h: 76,
      family: ROOF_SLATE,
      height: 8,
      tag: 'grandstand',
    },
    {
      x: viaduct.x - 550,
      y: viaduct.y - 48,
      w: 112,
      h: 96,
      family: ROOF_CONCRETE,
      height: 9,
      tag: 'station',
    },
  ];
  // Where the viaduct crosses the corridor: found by scanning the field along its line.
  let roadX0 = viaduct.x;
  let roadX1 = viaduct.x;
  const row = viaduct.y * ctx.field.w;
  while (roadX0 > 0 && ctx.field.edge[row + roadX0]! <= 6) roadX0--;
  while (roadX1 < ctx.field.w - 1 && ctx.field.edge[row + roadX1]! <= 6) roadX1++;
  return {
    reserves,
    fixed,
    sites: {
      clock: { x: clockLot.x + 50, y: clockLot.y + 50 },
      arcade: arcadeLot,
      marquee: { x: arcadeLot.x + 71, y: arcadeLot.y + 7 },
      tower,
      viaduct: { y: viaduct.y, roadX0: roadX0 - 4, roadX1: roadX1 + 5 },
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
  // Edge from the tip (angle 0, radius outer) to the notch (angle sector/2, radius inner).
  const tx = outer;
  const nx = inner * Math.cos(sector / 2);
  const ny = inner * Math.sin(sector / 2);
  const qx = r * Math.cos(a);
  const qy = r * Math.sin(a);
  return (nx - tx) * qy - ny * (qx - tx) >= 0;
}

// --- Clock tower ---------------------------------------------------------------------------

function paintClock(ctx: BakeContext, lot: Lot, out: LandmarkOutput): void {
  const cv = ctx.world;
  const r = ROOFS[lot.family]!;
  const cx = lot.x + 50;
  const cy = lot.y + 50;
  // Stepped stone tiers.
  box(cv, lot.x + 5, lot.y + 5, 90, 90, r.alt, r.hi, r.deep, 0);
  cv.frame(lot.x + 6, lot.y + 6, 88, 88, r.par);
  cv.hline(lot.x + 7, lot.y + 93, 87, r.dark);
  cv.vline(lot.x + 93, lot.y + 7, 87, r.dark);
  // Corner finials: small lit pyramids.
  for (const [fx, fy] of [
    [lot.x + 8, lot.y + 8],
    [lot.x + 81, lot.y + 8],
    [lot.x + 8, lot.y + 81],
    [lot.x + 81, lot.y + 81],
  ] as const) {
    dropShadow(cv, fx, fy, 11, 11, 3);
    for (let yy = 0; yy < 11; yy++) {
      for (let xx = 0; xx < 11; xx++) {
        const upper = xx + yy < 10;
        const left = xx < yy;
        const c =
          xx === yy || xx + yy === 10
            ? r.par
            : upper
              ? left
                ? r.par
                : r.hi
              : left
                ? r.dark
                : r.deep;
        cv.set(fx + xx, fy + yy, c);
      }
    }
    cv.frame(fx, fy, 11, 11, r.deep);
    cv.set(fx + 5, fy + 5, PAL.goldHi);
  }
  // Bronze bezel.
  cv.mapDisc(cx + 3, cy + 3, 40, contactShade);
  cv.disc(cx, cy, 41, PAL.ink);
  for (let yy = -40; yy <= 40; yy++) {
    for (let xx = -40; xx <= 40; xx++) {
      const d = Math.hypot(xx, yy);
      if (d > 40.3 || d <= 35.3) continue;
      const lit = xx + yy < -22;
      const shade = xx + yy > 26;
      cv.set(
        cx + xx,
        cy + yy,
        d > 39.3 || d <= 36.3
          ? lit
            ? PAL.gold
            : PAL.goldDim
          : lit
            ? PAL.goldHi
            : shade
              ? PAL.woodDark
              : PAL.gold,
      );
    }
  }
  emissive(cv, () => {
    const faceEdge = col('#EBD9A4');
    const face = col('#FFF3C6');
    cv.disc(cx, cy, 35, faceEdge);
    cv.disc(cx, cy, 30, face);
    cv.ring(cx, cy, 35, PAL.windowMid);
    // Hour marks.
    for (let hour = 0; hour < 12; hour++) {
      const a = (hour / 12) * Math.PI * 2 - Math.PI / 2;
      const major = hour % 3 === 0;
      thickLine(
        cv,
        cx + Math.cos(a) * (major ? 24 : 28),
        cy + Math.sin(a) * (major ? 24 : 28),
        cx + Math.cos(a) * 32,
        cy + Math.sin(a) * 32,
        PAL.ink,
        major ? 3 : 1.5,
      );
    }
    // Minute dots.
    for (let m = 0; m < 60; m++) {
      if (m % 5 === 0) continue;
      const a = (m / 60) * Math.PI * 2;
      cv.set(Math.round(cx + Math.cos(a) * 33), Math.round(cy + Math.sin(a) * 33), PAL.windowDim);
    }
    // Hands at ten past ten.
    const ha = ((10 + 10 / 60) / 12) * Math.PI * 2 - Math.PI / 2;
    const ma = (10 / 60) * Math.PI * 2 - Math.PI / 2;
    thickLine(
      cv,
      cx - Math.cos(ha) * 4,
      cy - Math.sin(ha) * 4,
      cx + Math.cos(ha) * 17,
      cy + Math.sin(ha) * 17,
      PAL.ink,
      3.5,
    );
    thickLine(
      cv,
      cx - Math.cos(ma) * 5,
      cy - Math.sin(ma) * 5,
      cx + Math.cos(ma) * 27,
      cy + Math.sin(ma) * 27,
      PAL.inkSoft,
      2.5,
    );
    cv.disc(cx, cy, 4, PAL.ink);
    cv.disc(cx, cy, 3, PAL.coral);
    cv.set(cx - 1, cy - 1, PAL.coralHi);
  });
  out.pools.push({ x: cx, y: cy, radii: [50, 58], tint: TINT_GOLD, level: lot.id });
  out.pools.push({ x: cx, y: cy, radii: [68, 86], tint: TINT_GOLD, level: 0 });
  out.lights.push({ x: cx, y: cy, radius: 86, color: TINT_HEX[TINT_GOLD]!, intensity: 0.7 });
}

// --- Starlight Arcade ----------------------------------------------------------------------

/** Marquee board with chasing bulbs. Frame 0 is the baked state. */
export function drawMarquee(cv: Canvas, x: number, y: number, frame: number): void {
  const w = 88;
  const h = 14;
  cv.rect(x, y, w, h, PAL.ink);
  cv.frame(x, y, w, h, PAL.steelDark);
  emissive(cv, () => {
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

function paintArcade(ctx: BakeContext, lot: Lot, sites: LandmarkSites, out: LandmarkOutput): void {
  const cv = ctx.world;
  const r = ROOFS[lot.family]!;
  // Raised central hall.
  box(cv, lot.x + 8, lot.y + 26, lot.w - 16, lot.h - 34, r.alt, r.hi, r.deep, 0);
  cv.frame(lot.x + 9, lot.y + 27, lot.w - 18, lot.h - 36, r.par);
  cv.rect(lot.x + 11, lot.y + 29, lot.w - 22, lot.h - 40, r.dark);
  // Perimeter bulbs.
  emissive(cv, () => {
    let i = 0;
    for (let x = lot.x + 4; x < lot.x + lot.w - 3; x += 5) {
      cv.set(x, lot.y + 3, i % 2 === 0 ? PAL.gold : PAL.goldDim);
      cv.set(x, lot.y + lot.h - 4, i++ % 2 === 0 ? PAL.goldDim : PAL.gold);
    }
    for (let y = lot.y + 8; y < lot.y + lot.h - 5; y += 5) {
      cv.set(lot.x + 3, y, i % 2 === 0 ? PAL.gold : PAL.goldDim);
      cv.set(lot.x + lot.w - 4, y, i++ % 2 === 0 ? PAL.goldDim : PAL.gold);
    }
  });
  // The star.
  const sx = lot.x + 62;
  const sy = lot.y + 76;
  emissive(cv, () => {
    for (let yy = -44; yy <= 44; yy++) {
      for (let xx = -44; xx <= 44; xx++) {
        const px = sx + xx;
        const py = sy + yy;
        if (inStar(px, py, sx, sy, 43, 18)) {
          if (!inStar(px, py, sx, sy, 37, 15.4)) {
            const core = inStar(px, py, sx, sy, 41, 17.1) && !inStar(px, py, sx, sy, 39, 16.3);
            cv.set(px, py, core ? PAL.goldHi : PAL.gold);
          } else if (inStar(px, py, sx, sy, 33, 13.8)) {
            if (!inStar(px, py, sx, sy, 28, 11.7))
              cv.set(px, py, (xx + yy) % 2 === 0 ? PAL.purpleDim : PAL.inkSoft);
            else if (inStar(px, py, sx, sy, 24, 10) && !inStar(px, py, sx, sy, 20, 8.4))
              cv.set(px, py, PAL.cyan);
            else if (inStar(px, py, sx, sy, 15, 6.3))
              cv.set(px, py, inStar(px, py, sx, sy, 11, 4.6) ? PAL.coralHi : PAL.coral);
            else cv.set(px, py, PAL.ink);
          } else {
            cv.set(px, py, PAL.ink);
          }
        } else if (inStar(px, py, sx, sy, 45, 19)) {
          cv.set(px, py, PAL.goldDim);
        }
      }
    }
  });
  // Lettering.
  const tx = lot.x + 124;
  cv.rect(tx - 6, lot.y + 36, 96, 62, PAL.ink);
  cv.frame(tx - 6, lot.y + 36, 96, 62, PAL.steelDark);
  cv.hline(tx - 6, lot.y + 36, 96, PAL.steel);
  neonText(cv, tx + 6, lot.y + 43, 'STARLIGHT', 0, 2);
  neonText(cv, tx + 6, lot.y + 60, 'ARCADE', 1, 3);
  emissive(cv, () => {
    for (let k = 0; k < 84; k += 4) cv.set(tx + k, lot.y + 80, k % 8 === 0 ? PAL.gold : PAL.purple);
    for (let k = 0; k < 84; k += 4) cv.set(tx + k, lot.y + 92, k % 8 === 0 ? PAL.purple : PAL.gold);
    drawText(cv, tx + 8, lot.y + 84, 'OPEN ALL NIGHT', PAL.mint, 'micro', 1);
  });
  drawMarquee(cv, sites.marquee.x, sites.marquee.y, 0);
  // Glow.
  out.pools.push({ x: sx, y: sy, radii: [52, 62], tint: TINT_GOLD, level: lot.id });
  out.pools.push({
    x: tx + 44,
    y: lot.y + 66,
    radii: [50, 60],
    tint: TINT_CYAN,
    level: lot.id,
    squashY: 1.4,
  });
  out.pools.push({
    x: lot.x + lot.w / 2,
    y: lot.y + lot.h / 2,
    radii: [128, 156],
    tint: TINT_PURPLE,
    level: 0,
    squashY: 1.45,
  });
  out.lights.push({ x: sx, y: sy, radius: 150, color: TINT_HEX[TINT_GOLD]!, intensity: 0.8 });
  out.lights.push({
    x: tx + 44,
    y: lot.y + 66,
    radius: 150,
    color: TINT_HEX[TINT_PURPLE]!,
    intensity: 0.7,
  });
}

// --- Neon tower ----------------------------------------------------------------------------

/** Ring neon for the tower. `state` per ring: 0 dim, 1 on, 2 hot. Rings are outer, mid, inner. */
export function drawTowerRings(
  cv: Canvas,
  cx: number,
  cy: number,
  state: readonly [number, number, number],
): void {
  const rings = [
    { r: 26, c: PAL.cyan, hi: PAL.cyanHi, dim: PAL.cyanDim },
    { r: 19, c: PAL.purple, hi: PAL.purpleHi, dim: PAL.purpleDim },
    { r: 12, c: PAL.coral, hi: PAL.coralHi, dim: PAL.coralDim },
  ];
  emissive(cv, () => {
    rings.forEach((ring, k) => {
      const st = state[k]!;
      cv.ring(cx - 0.5, cy - 0.5, ring.r + 1, st > 0 ? ring.dim : PAL.inkSoft, 4);
      cv.ring(cx - 0.5, cy - 0.5, ring.r, st === 0 ? ring.dim : ring.c, 2);
      if (st === 2) cv.ring(cx - 0.5, cy - 0.5, ring.r, ring.hi, 2);
      else if (st === 1) {
        // Hot core on the lit quadrant only.
        for (let a = Math.PI; a < Math.PI * 1.5; a += 0.02)
          cv.set(
            Math.round(cx - 0.5 + Math.cos(a) * (ring.r - 0.5)),
            Math.round(cy - 0.5 + Math.sin(a) * (ring.r - 0.5)),
            ring.hi,
          );
      }
    });
  });
}

/** Aircraft warning beacon. `level` 0 off, 1 dim, 2 bright. */
export function drawBeacon(cv: Canvas, cx: number, cy: number, level: number): void {
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

/** Central hub of the tower with its beacon. Redrawn whole for every beacon frame. */
export function drawTowerHub(cv: Canvas, cx: number, cy: number, level: number): void {
  cv.disc(cx - 0.5, cy - 0.5, 6, PAL.ink);
  cv.disc(cx - 0.5, cy - 0.5, 5, PAL.steelDark);
  cv.ring(cx - 0.5, cy - 0.5, 5, PAL.steel);
  drawBeacon(cv, cx, cy, level);
}

function paintTower(ctx: BakeContext, lot: Lot, out: LandmarkOutput): void {
  const cv = ctx.world;
  const cx = lot.x + 32;
  const cy = lot.y + 32;
  cv.disc(cx - 0.5, cy - 0.5, 29, PAL.inkSoft);
  // Radial struts.
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    cv.line(
      cx + Math.cos(a) * 7,
      cy + Math.sin(a) * 7,
      cx + Math.cos(a) * 28,
      cy + Math.sin(a) * 28,
      PAL.steelDark,
    );
  }
  drawTowerRings(cv, cx, cy, [1, 1, 1]);
  drawTowerHub(cv, cx, cy, 2);
  out.pools.push({ x: cx, y: cy, radii: [48, 62], tint: TINT_CYAN, level: 0 });
  out.lights.push({ x: cx, y: cy, radius: 62, color: TINT_HEX[TINT_CYAN]!, intensity: 0.8 });
}

function paintTowerPlaza(
  ctx: BakeContext,
  layout: CityLayout,
  sites: LandmarkSites,
  out: LandmarkOutput,
): void {
  const cv = ctx.world;
  const { field } = ctx;
  const ok = (x: number, y: number, m: number): boolean => {
    for (const [px, py] of [
      [x - m, y - m],
      [x + m, y - m],
      [x - m, y + m],
      [x + m, y + m],
    ] as const) {
      const i = py * field.w + px;
      if (field.edge[i]! < 9 || layout.roofId[i] !== 0 || layout.ground[i] !== G_PLAZA)
        return false;
    }
    return true;
  };
  const y = sites.tower.y;
  let n = 0;
  for (let x = sites.tower.x + 62; x < sites.tower.x + 340; x += 34) {
    if (!ok(x, y, 9)) continue;
    if (n % 3 === 2) {
      cv.rect(x - 1, y - 1, 3, 3, PAL.steelDark);
      lampHead(cv, x, y);
      out.pools.push({ x, y, radii: [10, 18, 27], tint: TINT_WARM, level: 0 });
    } else {
      cv.rect(x - 8, y - 8, 16, 16, PAL.kerbShade);
      cv.rect(x - 7, y - 7, 14, 14, PAL.soil);
      cv.curHeight = 5;
      tree(cv, x, y, 7, x * 3 + 1, n % 2 === 0);
      cv.curHeight = -1;
    }
    n++;
  }
}

// --- Harbor --------------------------------------------------------------------------------

const CRANE_Y = col('#D9A63E');
const CRANE_DK = col('#8C6628');
const CRANE_DEEP = col('#5A4222');
const HULL = col('#5A2B36');
const HULL_HI = col('#8C4652');
const DECK = col('#2F3850');
const DECK_LINE = col('#262E44');

function container(
  cv: Canvas,
  x: number,
  y: number,
  horizontal: boolean,
  paint: Color,
  stacked: boolean,
): void {
  const w = horizontal ? 30 : 13;
  const h = horizontal ? 13 : 30;
  const base = stacked ? lighter(paint, 0.14) : paint;
  dropShadow(cv, x, y, w, h, stacked ? 4 : 2);
  cv.rect(x, y, w, h, base);
  for (let k = 2; k < (horizontal ? w : h) - 2; k += 3) {
    if (horizontal) cv.vline(x + k, y + 1, h - 2, darker(base, 0.2));
    else cv.hline(x + 1, y + k, w - 2, darker(base, 0.2));
  }
  cv.frame(x, y, w, h, darker(base, 0.5));
  cv.hline(x + 1, y + 1, w - 2, lighter(base, 0.28));
  cv.vline(x + 1, y + 1, h - 2, lighter(base, 0.28));
  for (const [px, py] of [
    [x, y],
    [x + w - 1, y],
    [x, y + h - 1],
    [x + w - 1, y + h - 1],
  ] as const)
    cv.set(px, py, PAL.ink);
  // Door end with lock rods.
  if (horizontal) {
    cv.vline(x + w - 3, y + 2, h - 4, darker(base, 0.34));
    cv.set(x + w - 2, y + 4, PAL.steelLight);
    cv.set(x + w - 2, y + h - 5, PAL.steelLight);
  } else {
    cv.hline(x + 2, y + h - 3, w - 4, darker(base, 0.34));
    cv.set(x + 4, y + h - 2, PAL.steelLight);
    cv.set(x + w - 5, y + h - 2, PAL.steelLight);
  }
}

function crane(cv: Canvas, x: number, out: LandmarkOutput, seed: number): void {
  const railA = 2566;
  const railB = 2586;
  const top = 2474;
  const tip = 2748;
  // Boom shadow thrown onto quay and water.
  for (let y = top; y <= tip; y++)
    for (let k = -8; k <= 8; k++) cv.map(x + k + 12, y + 12, contactShade);
  for (let k = -28; k <= 28; k++)
    for (let j = 0; j < 30; j++) cv.map(x + k + 6, railA - 4 + j + 6, contactShade);
  // Hanging load and its far shadow: the gap between them sells the height.
  const loadY = 2664;
  const livery = LIVERIES[seed % LIVERIES.length]!;
  for (let yy = 0; yy < 13; yy++)
    for (let xx = 0; xx < 30; xx++) cv.map(x - 15 + xx + 16, loadY + yy + 16, contactShade);
  container(cv, x - 15, loadY, true, livery, false);
  // Portal: sill beams on the rails and two side frames.
  for (const ry of [railA, railB]) {
    box(cv, x - 28, ry - 3, 56, 6, CRANE_Y, PAL.gold, CRANE_DK, 0);
    cv.rect(x - 28, ry + 3, 8, 2, PAL.ink);
    cv.rect(x + 20, ry + 3, 8, 2, PAL.ink);
  }
  box(cv, x - 28, railA - 3, 6, railB - railA + 6, CRANE_Y, PAL.gold, CRANE_DK, 0);
  box(cv, x + 22, railA - 3, 6, railB - railA + 6, CRANE_Y, PAL.gold, CRANE_DK, 0);
  for (let k = 0; k < 4; k++) {
    cv.rect(x - 28, railA + 1 + k * 5, 6, 2, PAL.coral);
    cv.rect(x + 22, railA + 1 + k * 5, 6, 2, PAL.coral);
  }
  // Boom: two chords with zigzag lacing.
  for (let y = top; y <= tip; y++) {
    const m = (y - top) % 12;
    const zig = m < 6 ? m : 12 - m;
    cv.set(x - 5 + Math.round((zig * 9) / 6), y, CRANE_DK);
    if (m === 0) cv.hline(x - 5, y, 10, CRANE_Y);
  }
  for (let y = top; y <= tip; y++) {
    cv.set(x - 7, y, PAL.gold);
    cv.set(x - 6, y, CRANE_Y);
    cv.set(x + 5, y, CRANE_Y);
    cv.set(x + 6, y, CRANE_DK);
    if ((y - top) % 24 < 3) {
      cv.set(x - 7, y, PAL.coral);
      cv.set(x - 6, y, PAL.coral);
      cv.set(x + 5, y, PAL.coral);
      cv.set(x + 6, y, PAL.coralDim);
    }
  }
  cv.rect(x - 7, top - 2, 14, 3, CRANE_DEEP);
  cv.rect(x - 7, tip, 14, 3, CRANE_DEEP);
  // Machinery house over the landside legs.
  box(cv, x - 13, 2522, 26, 34, PAL.kerbIvoryDark, PAL.kerbIvory, PAL.steelDark, 0);
  cv.rect(x - 11, 2526, 22, 4, PAL.kerbCoral);
  cv.rect(x - 8, 2536, 7, 7, PAL.steelDark);
  cv.ring(x - 5, 2539, 2, PAL.steel);
  cv.rect(x + 2, 2536, 8, 5, PAL.steel);
  cv.hline(x + 2, 2536, 8, PAL.steelLight);
  cv.rect(x - 10, 2548, 20, 2, PAL.steelDark);
  // Trolley and operator cab.
  box(cv, x - 10, loadY - 2, 20, 9, PAL.steelDark, PAL.steel, PAL.ink, 0);
  cv.rect(x - 3, loadY, 6, 5, PAL.steel);
  box(cv, x + 7, 2608, 12, 14, PAL.kerbIvoryDark, PAL.kerbIvory, PAL.steelDark, 0);
  emissive(cv, () => {
    cv.rect(x + 9, 2617, 8, 3, PAL.windowWarm);
    cv.set(x - 1, tip + 1, PAL.red);
    cv.set(x, tip + 1, PAL.red);
    cv.set(x - 1, top - 1, PAL.red);
    cv.set(x, top - 1, PAL.red);
  });
  lampHead(cv, x - 25, railA - 6);
  lampHead(cv, x + 25, railA - 6);
  lampHead(cv, x, 2600);
  out.pools.push({ x, y: 2548, radii: [36, 62, 88], tint: TINT_COOL, level: 0 });
  out.pools.push({ x, y: 2612, radii: [22, 38], tint: TINT_GOLD, level: 0 });
  out.lights.push({ x, y: 2548, radius: 88, color: TINT_HEX[TINT_COOL]!, intensity: 0.9 });
}

function ship(cv: Canvas, x0: number, yc: number, len: number, rnd: () => number): void {
  const half = (u: number): number => {
    if (u < 0 || u >= len) return -1;
    if (u < 10) return 30 + u * 0.7;
    if (u < len - 78) return 37;
    const t = (u - (len - 78)) / 78;
    return 37 * Math.sqrt(Math.max(0, 1 - t * t));
  };
  for (let u = 0; u < len; u++) {
    const hw = half(u);
    for (let v = -Math.ceil(hw); v <= Math.ceil(hw); v++)
      if (Math.abs(v) <= hw) cv.map(x0 + u + 6, yc + v + 6, contactShade);
  }
  for (let u = 0; u < len; u++) {
    const hw = half(u);
    for (let v = -Math.ceil(hw); v <= Math.ceil(hw); v++) {
      const av = Math.abs(v);
      if (av > hw) continue;
      const rim = av > hw - 2.2 || u < 2 || half(u + 2) < av;
      let c: Color;
      if (rim) c = v < 0 || u < 2 ? HULL_HI : HULL;
      else if (av > hw - 3.4) c = PAL.kerbIvoryDark;
      else
        c =
          u % 16 === 0 || v === 0 ? DECK_LINE : hash2(x0 + u, yc + v, 12) < 0.05 ? DECK_LINE : DECK;
      cv.set(x0 + u, yc + v, c);
    }
  }
  // Cargo.
  for (let u = 66; u + 30 < len - 84; u += 32) {
    for (let v = -30; v <= 17; v += 15) {
      if (rnd() < 0.2) continue;
      container(cv, x0 + u, yc + v, true, LIVERIES[(rnd() * LIVERIES.length) | 0]!, rnd() < 0.4);
    }
  }
  // Bridge, funnel, mast.
  box(cv, x0 + 12, yc - 30, 42, 60, PAL.kerbIvoryDark, PAL.kerbIvory, PAL.steelDark, 4);
  cv.rect(x0 + 16, yc - 26, 34, 52, PAL.kerb);
  cv.frame(x0 + 16, yc - 26, 34, 52, PAL.kerbShade);
  cv.mapDisc(x0 + 30, yc + 3, 7, contactShade);
  cv.disc(x0 + 27, yc, 7, PAL.coralDim);
  cv.disc(x0 + 26.5, yc - 0.5, 5.6, PAL.kerbCoral);
  cv.disc(x0 + 27, yc, 3, PAL.ink);
  cv.set(x0 + 23, yc - 4, PAL.coralHi);
  cv.rect(x0 + 40, yc - 14, 5, 5, PAL.steelDark);
  cv.hline(x0 + 38, yc - 12, 9, PAL.steelLight);
  emissive(cv, () => {
    for (let v = -24; v <= 24; v += 4)
      cv.rect(x0 + 52, yc + v - 1, 2, 2, v % 8 === 0 ? PAL.windowWarm : PAL.windowMid);
    cv.set(x0 + 42, yc - 12, PAL.red);
    cv.set(x0 + len - 6, yc, PAL.mint);
  });
  // Bow gear.
  cv.disc(x0 + len - 30, yc - 6, 2, PAL.steel);
  cv.disc(x0 + len - 30, yc + 6, 2, PAL.steel);
  cv.rect(x0 + len - 52, yc - 5, 10, 10, DECK_LINE);
  cv.frame(x0 + len - 52, yc - 5, 10, 10, PAL.steel);
}

function boat(cv: Canvas, x: number, y: number, paint: Color): void {
  const rows = [3, 5, 7, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 7];
  rows.forEach((wRow, k) => {
    for (let j = 0; j < wRow; j++) cv.map(x + 5 - (wRow >> 1) + j + 3, y + k + 3, contactShade);
  });
  rows.forEach((wRow, k) => {
    const lx = x + 5 - (wRow >> 1);
    for (let j = 0; j < wRow; j++) {
      const rim = j === 0 || j === wRow - 1 || k === 0 || k === rows.length - 1;
      cv.set(
        lx + j,
        y + k,
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
  cv.rect(x + 3, y + 7, 5, 3, PAL.glass);
}

function paintHarbor(ctx: BakeContext, layout: CityLayout, out: LandmarkOutput): void {
  const cv = ctx.world;
  const rnd = mulberry32(ctx.seed ^ 0x4a7b0);
  const H = HARBOR;
  const worldH = ctx.def.worldHeight;
  // Quay wall and safety line.
  for (let x = H.x0; x < H.x1; x++) {
    cv.set(x, H.water - 4, PAL.wallHi);
    cv.set(x, H.water - 3, PAL.wallCap);
    cv.set(x, H.water - 2, PAL.wallShade);
    cv.set(x, H.water - 1, PAL.wallBase);
    if ((x >> 2) % 3 !== 0) cv.set(x, H.water, PAL.waterDeep);
    if (((x >> 3) & 3) < 3) cv.set(x, H.water - 10, PAL.paintGoldWorn);
    if (x % 64 === 20) {
      cv.rect(x, H.water - 8, 3, 3, PAL.steelDark);
      cv.set(x, H.water - 8, PAL.steelLight);
    }
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
    if (cranes.some((c) => x < c + 36 && c - 36 < x + bw)) {
      x += 15;
      continue;
    }
    // Painted bay outline.
    cv.frame(x - 3, H.y0 + 9, bw + 4, 100, PAL.paintGoldWorn);
    const livery = LIVERIES[(rnd() * LIVERIES.length) | 0]!;
    for (let row = 0; row < 3; row++) {
      for (let c = 0; c < cols; c++) {
        if (rnd() < 0.2) continue;
        const paint = rnd() < 0.55 ? livery : LIVERIES[(rnd() * LIVERIES.length) | 0]!;
        cv.curHeight = 3;
        container(cv, x + c * 15, H.y0 + 12 + row * 32, false, paint, rnd() < 0.36);
        cv.curHeight = -1;
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
    for (let k = 1; k <= 3; k++) cv.map(px + 21 + k, y + k, contactShade);
  }
  for (let y = H.water + 8; y < H.water + 96; y += 20) {
    cv.rect(px - 1, y, 3, 3, PAL.woodDark);
    cv.rect(px + 20, y, 3, 3, PAL.woodDark);
    cv.set(px - 1, y, PAL.woodLight);
    cv.set(px + 20, y, PAL.woodLight);
  }
  boat(cv, px - 16, H.water + 14, PAL.kerbCoral);
  boat(cv, px - 16, H.water + 44, PAL.cyanDim);
  boat(cv, px + 28, H.water + 30, PAL.goldDim);
  lampHead(cv, px + 11, H.water + 90);
  out.pools.push({ x: px + 11, y: H.water + 90, radii: [12, 22, 32], tint: TINT_WARM, level: 0 });
  // Freighter alongside.
  cv.curHeight = 4;
  ship(cv, 2196, 2662, 400, rnd);
  cv.curHeight = -1;
  cv.line(2210, 2626, 2204, H.water - 6, PAL.steel);
  cv.line(2560, 2640, 2580, H.water - 6, PAL.steel);
  // A second, smaller hull further out, mostly in the dark.
  cv.curHeight = 3;
  ship(cv, 760, 2752, 250, rnd);
  cv.curHeight = -1;
  for (const c of cranes) crane(cv, c, out, c);
  // Channel buoys.
  emissive(cv, () => {
    for (const [bx, by, c] of [
      [1700, 2740, PAL.red],
      [1900, 2776, PAL.mint],
      [1320, 2770, PAL.red],
      [2700, 2760, PAL.mint],
    ] as const) {
      cv.rect(bx, by, 2, 2, c);
    }
  });
  for (const [bx, by, tint] of [
    [1700, 2740, 2],
    [1900, 2776, 1],
    [1320, 2770, 2],
    [2700, 2760, 1],
  ] as const)
    out.pools.push({ x: bx + 1, y: by + 1, radii: [5, 10], tint, level: 0 });
  // Warehouses.
  for (const lot of layout.lots) {
    if (!lot || lot.tag !== 'warehouse') continue;
    out.claimed.add(lot.id);
    cv.clipMap = layout.roofId;
    cv.clipId = lot.id;
    const r = ROOFS[lot.family]!;
    const ridge = lot.y + (lot.h >> 1);
    cv.hline(lot.x + 3, ridge - 1, lot.w - 6, r.hi);
    cv.hline(lot.x + 3, ridge, lot.w - 6, r.par);
    cv.hline(lot.x + 3, ridge + 1, lot.w - 6, r.deep);
    for (let sx = lot.x + 14; sx + 20 < lot.x + lot.w - 10; sx += 30) {
      const lit = hash2(sx, lot.y, 71) < 0.55;
      for (const sy of [lot.y + 14, lot.y + lot.h - 24]) {
        cv.rect(sx, sy, 20, 9, PAL.steelDark);
        cv.hline(sx, sy, 20, PAL.steel);
        if (lit) {
          emissive(cv, () => {
            for (let yy = 1; yy < 8; yy++)
              for (let xx = 1; xx < 19; xx++)
                cv.set(
                  sx + xx,
                  sy + yy,
                  xx % 5 === 0 ? PAL.windowDim : yy === 1 ? PAL.windowWarm : PAL.windowMid,
                );
          });
          out.pools.push({
            x: sx + 10,
            y: sy + 4,
            radii: [13, 18],
            tint: TINT_WARM,
            level: lot.id,
            squashY: 1.4,
          });
        } else {
          for (let yy = 1; yy < 8; yy++)
            for (let xx = 1; xx < 19; xx++)
              cv.set(sx + xx, sy + yy, xx % 5 === 0 ? PAL.steelDark : PAL.glass);
        }
      }
    }
    const label = lot.x < 1500 ? 'DOCK 7' : 'PIER 12';
    drawText(
      cv,
      lot.x + ((lot.w - textWidth(label, 'micro', 3)) >> 1),
      ridge - 22,
      label,
      r.par,
      'micro',
      3,
    );
    cv.clipMap = null;
  }
}

// --- Tram viaduct --------------------------------------------------------------------------

const BALLAST = col('#2B2F40');
const BALLAST_LIGHT = col('#353A4D');

/** Draws the rail deck between world x0 and x1 onto `cv`, whose origin is at (ox, oy). */
export function drawViaduct(
  cv: Canvas,
  ox: number,
  oy: number,
  yc: number,
  x0: number,
  x1: number,
  caps = true,
): void {
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
      else if (dy === 15) c = PAL.steel;
      else if (dy === 16) c = PAL.ink;
      else if (dy === -11 || dy === -5 || dy === 4 || dy === 10) c = PAL.rail;
      else if (dy === -10 || dy === -4 || dy === 5 || dy === 11) c = PAL.railGroove;
      else if ((track1 || track2) && sleeper) c = PAL.woodDark;
      else if (dy === -2 || dy === 1) c = PAL.steelDark;
      else if (dy === -1 || dy === 0) c = x % 8 === 0 ? PAL.steelDark : PAL.steel;
      else c = hash2(x >> 1, dy, 55) < 0.2 ? BALLAST_LIGHT : BALLAST;
      cv.set(x - ox, yc + dy - oy, c);
    }
    // Girder caps poke out past the deck at each pier.
    if (caps && x % 64 < 6) {
      for (const dy of [-20, -19, -18, 17, 18, 19]) {
        const lit = dy === -20 || x % 64 === 0;
        cv.set(
          x - ox,
          yc + dy - oy,
          lit ? PAL.kerb : dy === 19 || x % 64 === 5 ? PAL.steelDark : PAL.kerbShade,
        );
      }
    }
    // Catenary masts on the center walkway.
    if (x % 56 === 28) {
      for (let dy = -13; dy <= 12; dy++) cv.set(x - ox, yc + dy - oy, PAL.inkSoft);
      cv.rect(x - 1 - ox, yc - 2 - oy, 3, 3, PAL.steelHi);
      cv.set(x + 1 - ox, yc - oy, PAL.steel);
    }
  }
}

/** A two-car tram on the upper track, frozen at the platform. */
function drawTram(cv: Canvas, x: number, yc: number): void {
  for (let car = 0; car < 2; car++) {
    const cx = x + car * 44;
    box(cv, cx, yc - 14, 42, 11, PAL.kerbIvoryDark, PAL.kerbIvory, PAL.steelDark, 0);
    cv.rect(cx + 2, yc - 12, 38, 2, PAL.kerbCoral);
    cv.rect(cx + 4, yc - 9, 34, 3, PAL.steelDark);
    cv.rect(cx + 16, yc - 10, 9, 4, PAL.steel);
    emissive(cv, () => {
      for (let k = 0; k < 8; k++) cv.rect(cx + 5 + k * 4, yc - 5, 3, 1, PAL.windowWarm);
    });
  }
  cv.rect(x + 42, yc - 12, 2, 7, PAL.ink);
  emissive(cv, () => {
    cv.set(x + 86, yc - 12, PAL.ivory);
    cv.set(x + 86, yc - 6, PAL.ivory);
    cv.set(x - 1, yc - 12, PAL.red);
    cv.set(x - 1, yc - 6, PAL.red);
  });
}

function paintViaductGround(
  ctx: BakeContext,
  layout: CityLayout,
  sites: LandmarkSites,
  out: LandmarkOutput,
): void {
  const cv = ctx.world;
  const yc = sites.viaduct.y;
  const west = sites.viaduct.roadX0 - 440;
  cv.curHeight = 13;
  drawViaduct(cv, 0, 0, yc, west, sites.viaduct.roadX0);
  drawViaduct(cv, 0, 0, yc, sites.viaduct.roadX1, ctx.def.worldWidth);
  drawTram(cv, west + 18, yc);
  cv.curHeight = -1;
  // The deck hides whatever roof is under it, so rooftop light must not bleed onto it.
  for (let y = yc - 20; y < yc + 20; y++) {
    for (let x = west; x < ctx.def.worldWidth; x++) {
      if (x >= sites.viaduct.roadX0 && x < sites.viaduct.roadX1) continue;
      if (cv.height![y * layout.w + x] === 13) layout.roofId[y * layout.w + x] = 0;
    }
  }
  // Abutments either side of the road: chunky piers with hazard paint, outside the corridor.
  for (const ax of [sites.viaduct.roadX0 - 7, sites.viaduct.roadX1 + 1]) {
    cv.curHeight = 13;
    box(cv, ax, yc - 24, 6, 48, PAL.kerbShade, PAL.kerb, PAL.steelDark, 0);
    for (let k = 0; k < 48; k += 6) cv.rect(ax + 1, yc - 23 + k, 4, 3, PAL.paintGold);
    cv.curHeight = -1;
  }
  // Station building at the west end.
  const lot = layout.lots.find((l) => l?.tag === 'station');
  if (lot) {
    out.claimed.add(lot.id);
    cv.clipMap = layout.roofId;
    cv.clipId = lot.id;
    const r = ROOFS[lot.family]!;
    // Glazed platform canopy across the middle.
    const gy = lot.y + 30;
    cv.rect(lot.x + 6, gy, lot.w - 12, 36, PAL.steelDark);
    for (let yy = 1; yy < 35; yy++) {
      for (let xx = 1; xx < lot.w - 13; xx++) {
        const rib = xx % 9 === 0 || yy === 17 || yy === 18;
        cv.set(
          lot.x + 6 + xx,
          gy + yy,
          rib ? PAL.steel : (xx + yy * 2) % 11 === 0 ? PAL.glassLight : PAL.glass,
        );
      }
    }
    cv.hline(lot.x + 6, gy, lot.w - 12, PAL.steelLight);
    cv.rect(lot.x + 22, lot.y + 8, 68, 16, PAL.ink);
    cv.frame(lot.x + 22, lot.y + 8, 68, 16, r.par);
    neonText(cv, lot.x + 27, lot.y + 11, 'TRAM', 0, 2);
    neonText(cv, lot.x + 64, lot.y + 13, 'LINE 5', 3, 1);
    emissive(cv, () => {
      for (let k = 0; k < lot.w - 20; k += 6)
        cv.set(lot.x + 10 + k, lot.y + lot.h - 12, PAL.windowWarm);
    });
    cv.clipMap = null;
    out.pools.push({
      x: lot.x + 56,
      y: lot.y + 16,
      radii: [36, 46],
      tint: TINT_CYAN,
      level: lot.id,
      squashY: 1.6,
    });
    out.pools.push({
      x: lot.x + 56,
      y: lot.y + lot.h - 12,
      radii: [40, 54],
      tint: TINT_WARM,
      level: lot.id,
      squashY: 2.2,
    });
    out.lights.push({
      x: lot.x + 56,
      y: lot.y + 16,
      radius: 46,
      color: TINT_HEX[TINT_CYAN]!,
      intensity: 0.5,
    });
  }
}

// --- Start line ----------------------------------------------------------------------------

function paintStart(
  ctx: BakeContext,
  layout: CityLayout,
  sites: LandmarkSites,
  out: LandmarkOutput,
): void {
  const cv = ctx.world;
  const lot = layout.lots.find((l) => l?.tag === 'grandstand');
  if (lot) {
    out.claimed.add(lot.id);
    cv.clipMap = layout.roofId;
    cv.clipId = lot.id;
    const r = ROOFS[lot.family]!;
    const seats = [
      PAL.coralDim,
      PAL.cyanDim,
      PAL.goldDim,
      PAL.purpleDim,
      PAL.kerbIvoryDark,
      PAL.mintDim,
      PAL.kerbCoral,
      PAL.steel,
    ];
    // Canopy over the back rows, open tiers of seats toward the track.
    const tiers = 9;
    for (let t = 0; t < tiers; t++) {
      const y = lot.y + 22 + t * 5;
      cv.hline(lot.x + 5, y + 4, lot.w - 10, r.deep);
      for (let x = lot.x + 6; x < lot.x + lot.w - 6; x++) {
        const aisle = (x - lot.x) % 38 < 3;
        for (let k = 0; k < 4; k++) {
          let c: Color = t % 2 === 0 ? r.alt : r.base;
          if (aisle) c = r.par;
          else if (k < 2 && (x - lot.x) % 3 !== 2) {
            const hsh = hash2((x - lot.x) / 3, t, 6021);
            if (hsh < 0.74) c = seats[(hash2((x - lot.x) / 3, t, 6022) * seats.length) | 0]!;
            else c = r.dark;
            if (k === 1 && hsh < 0.74) c = darker(c, 0.3);
          }
          cv.set(x, y + k, c);
        }
      }
    }
    box(cv, lot.x + 3, lot.y + 3, lot.w - 6, 17, r.par, r.hi, r.deep, 3);
    for (let x = lot.x + 12; x < lot.x + lot.w - 8; x += 14) cv.vline(x, lot.y + 5, 13, r.base);
    neonText(
      cv,
      lot.x + ((lot.w - textWidth('BOLT RIVALS GRAND PRIX', 'micro', 1)) >> 1),
      lot.y + 9,
      'BOLT RIVALS GRAND PRIX',
      3,
      1,
    );
    emissive(cv, () => {
      for (let x = lot.x + 8; x < lot.x + lot.w - 6; x += 18)
        cv.rect(x, lot.y + 19, 2, 1, PAL.lamp);
    });
    cv.clipMap = null;
    out.pools.push({
      x: lot.x + lot.w / 2,
      y: lot.y + 44,
      radii: [110, 130],
      tint: TINT_WARM,
      level: lot.id,
      squashY: 3,
    });
  }
  // Flood pools on the grid: the best lit place on the circuit.
  out.pools.push({
    x: sites.start.x + 14,
    y: sites.start.y,
    radii: [84, 128, 168],
    tint: TINT_COOL,
    level: 0,
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
  layout: CityLayout,
  sites: LandmarkSites,
  out: LandmarkOutput,
): void {
  const cv = ctx.world;
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
      if (field.edge[i]! < 9 || layout.roofId[i] !== 0 || layout.ground[i] !== G_PLAZA)
        return false;
    }
    return true;
  };
  const planter = (x: number, y: number, r: number, warm: boolean): void => {
    if (!ok(x, y, r + 2)) return;
    cv.rect(x - r - 1, y - r - 1, 2 * r + 2, 2 * r + 2, PAL.kerbShade);
    cv.rect(x - r, y - r, 2 * r, 2 * r, PAL.soil);
    cv.curHeight = 5;
    tree(cv, x, y, r, x * 5 + y, warm);
    cv.curHeight = -1;
  };
  const lamp = (x: number, y: number, tint: number): void => {
    if (!ok(x, y, 3)) return;
    cv.rect(x - 1, y - 1, 3, 3, PAL.steelDark);
    lampHead(cv, x, y);
    out.pools.push({ x, y, radii: [10, 18, 27], tint, level: 0 });
  };
  // Clock square: trees at the corners, lamps on the axes.
  const c = sites.clock;
  for (const [dx, dy] of [
    [66, -66],
    [84, -30],
    [84, 30],
    [66, 66],
    [20, -70],
    [20, 70],
    [-30, -66],
    [-30, 66],
  ] as const)
    planter(c.x + dx, c.y + dy, 7, (dx + dy) % 3 === 0);
  lamp(c.x + 70, c.y, TINT_GOLD);
  lamp(c.x - 6, c.y - 68, TINT_GOLD);
  lamp(c.x - 6, c.y + 68, TINT_GOLD);
  // Arcade forecourt.
  const a = sites.arcade;
  for (let x = a.x + 10; x < a.x + a.w; x += 44) {
    planter(x, a.y - 8, 5, true);
    planter(x + 22, a.y + a.h + 7, 5, false);
  }
  for (let y = a.y + 14; y < a.y + a.h; y += 40) {
    planter(a.x - 8, y, 5, false);
    planter(a.x + a.w + 7, y + 20, 5, true);
  }
  // Grandstand apron and station forecourt.
  const s = sites.start;
  for (let x = s.x - 116; x <= s.x + 116; x += 58) lamp(x, s.y - 106, TINT_COOL);
  planter(s.x - 120, s.y - 196, 4, false);
  planter(s.x + 120, s.y - 196, 4, true);
}

export function paintLandmarks(
  ctx: BakeContext,
  layout: CityLayout,
  sites: LandmarkSites,
  out: LandmarkOutput,
): void {
  const cv = ctx.world;
  cv.curFlags = 0;
  cv.curHeight = -1;
  paintHarbor(ctx, layout, out);
  paintPlazaDressing(ctx, layout, sites, out);
  paintTowerPlaza(ctx, layout, sites, out);
  for (const lot of layout.lots) {
    if (!lot || !lot.tag) continue;
    if (lot.visible < lot.w * lot.h * (lot.round ? 0.7 : 1))
      console.warn(
        `landmark ${lot.tag} is clipped by the corridor (${lot.visible} of ${lot.w * lot.h} px)`,
      );
    if (lot.tag === 'warehouse' || lot.tag === 'station' || lot.tag === 'grandstand') continue;
    out.claimed.add(lot.id);
    cv.clipMap = layout.roofId;
    cv.clipId = lot.id;
    if (lot.tag === 'clock') paintClock(ctx, lot, out);
    else if (lot.tag === 'arcade') paintArcade(ctx, lot, sites, out);
    else if (lot.tag === 'tower') paintTower(ctx, lot, out);
    cv.clipMap = null;
  }
  paintViaductGround(ctx, layout, sites, out);
  paintStart(ctx, layout, sites, out);
}
