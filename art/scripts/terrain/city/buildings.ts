import { hash2, mulberry32 } from '@bolt/shared';
import type { TerrainLight } from '@bolt/shared';
import type { BakeContext } from '../biome.js';
import { Canvas, col, mixc } from '../canvas.js';
import type { Color } from '../canvas.js';
import { drawText } from '../font.js';
import type { LightPool } from '../lighting.js';
import { leanOf } from '../oblique.js';
import type { Scene } from '../oblique.js';
import { facadeBays, paintFacade, westWall } from './facade.js';
import type { FacadeKind } from './facade.js';
import { CORNICE, FLOOR_N, G_YARD, riseForFloors } from './layout.js';
import type { CityLayout, Lot, Rect } from './layout.js';
import { GLYPHS, NEON, SHOP_NAMES, drawNeonSign, neonSignSize } from './neon.js';
import type { NeonSignSpec } from './neon.js';
import {
  BUILDINGS,
  LIVERIES,
  PAL,
  ROOF_CONCRETE,
  ROOF_MAROON,
  ROOF_OLIVE,
  ROOF_PLUM,
  ROOF_SLATE,
  ROOF_TEAL,
  TINT_HEX,
  contactShade,
  darker,
  lighter,
} from './palette.js';
import type { BuildingRamp } from './palette.js';
import { Solid } from './solid.js';
import type { Mass } from './solid.js';
import { parkCar, stand } from './props.js';
import { binSprite, crateStack, drawBox, dumpsterSprite, emissive } from './sprites.js';

/**
 * Buildings. Each lot becomes one solid made of a few masses: a main block and, more often
 * than not, a lower front, a wing, a turret or a shaft on a podium. Every mass shows a roof, a
 * west wall toward the light and a south wall in shade, and takes the shadow of whatever
 * stands taller to its north-west. Roof dressing stands up too, each piece with its own faces
 * and its own shadow, painted back to front.
 */

/** Headroom above a roof for antennas, tanks, billboards and signs. */
export const ROOF_HEAD = 32;

const SEED = 9203;
const SOLAR_DARK = col('#1B2A50');
const SOLAR = col('#24396B');
const SOLAR_HI = col('#4F7CC0');

function roofTexture(lot: Lot, b: BuildingRamp, lx: number, ly: number): Color {
  const flip = (lot.seed & 1) === 1;
  switch (lot.family) {
    case ROOF_SLATE: {
      // Standing-seam metal sheets.
      const q = flip ? lx : ly;
      return q % 7 === 6 ? b.roofLine : q % 7 === 0 ? b.roofAlt : b.roof;
    }
    case ROOF_TEAL: {
      // Ribbed copper-green sheet.
      const q = flip ? lx : ly;
      return q % 4 === 0 ? b.roofAlt : b.roof;
    }
    case ROOF_MAROON: {
      // Clay tiles in staggered courses.
      const row = ly >> 2;
      const xo = lx + (row & 1) * 3;
      if ((ly & 3) === 3) return b.roofLine;
      return xo % 6 === 5 ? b.roofAlt : b.roof;
    }
    case ROOF_PLUM: {
      // Tar and gravel.
      const hsh = hash2((lx + (ly & 2)) >> 1, ly >> 1, SEED + 2 + lot.id);
      return hsh < 0.04 ? b.roofLine : hsh > 0.86 ? b.roofAlt : b.roof;
    }
    case ROOF_OLIVE: {
      // Membrane sheets with patch repairs.
      const q = flip ? lx : ly;
      if (q % 13 === 12) return b.roofLine;
      return hash2(lx >> 3, ly >> 2, SEED + 3 + lot.id) < 0.14 ? b.roofAlt : b.roof;
    }
    case ROOF_CONCRETE:
    default: {
      // Cast slabs.
      if (lx % 16 === 15 || ly % 16 === 15) return b.roofLine;
      return hash2(lx >> 2, ly >> 1, SEED + 4 + lot.id) < 0.07 ? b.roofAlt : b.roof;
    }
  }
}

/**
 * Tone of a flat roof inside its parapet. The parapet is two pixels thick with a bright outer
 * edge on the sides toward the light; the north wall shows its inner face in shade, and both it
 * and the west wall throw a line of shadow onto the roof.
 */
export function roofTone(
  b: BuildingRamp,
  w: number,
  d: number,
  lx: number,
  ly: number,
  texture: (lx: number, ly: number) => Color,
): Color {
  if (ly === 0 || lx === 0) return b.rim;
  if (ly === d - 1 || lx === w - 1) return b.trim;
  if (ly === 1 || lx === 1 || ly === d - 2 || lx === w - 2) return b.rimLow;
  if (ly <= 3) return b.inner;
  if (ly === 4 || lx <= 3) return b.roofLine;
  return texture(lx, ly);
}

/** Roof surface with its parapet, painted straight into a canvas. */
export function paintRoofSurface(
  cv: Canvas,
  x0: number,
  y0: number,
  w: number,
  d: number,
  b: BuildingRamp,
  texture: (lx: number, ly: number) => Color,
): void {
  for (let ly = 0; ly < d; ly++)
    for (let lx = 0; lx < w; lx++) cv.set(x0 + lx, y0 + ly, roofTone(b, w, d, lx, ly, texture));
}

// --- Things that stand on roofs ---------------------------------------------------------------
// Each takes the north-west corner of its footprint on the roof and draws upward from there.

function castOnRoof(cv: Canvas, x: number, y: number, w: number, d: number, len: number): void {
  for (let k = 1; k <= len; k++) {
    for (let i = 0; i < w; i++) cv.map(x + i + k, y + d - 1 + k, contactShade);
    for (let j = 0; j < d - 1; j++) cv.map(x + w - 1 + k, y + j + k, contactShade);
  }
}

function riser(
  cv: Canvas,
  x: number,
  y: number,
  w: number,
  d: number,
  r: number,
  top: Color,
  face: Color,
): void {
  castOnRoof(cv, x, y, w, d, Math.max(2, Math.min(4, r >> 1)));
  drawBox(cv, x + leanOf(r), y - r, w, d, r, top, face);
}

function acUnit(cv: Canvas, x: number, y: number): void {
  const r = 5;
  riser(cv, x, y, 9, 6, r, PAL.steelLight, PAL.steel);
  const tx = x + leanOf(r);
  cv.ring(tx + 3, y - r + 2.5, 2, PAL.steelDark);
  cv.set(tx + 3, y - r + 2, PAL.steel);
  cv.hline(x + 2, y + 3, 6, PAL.steelDark);
  cv.hline(x + 2, y + 1, 6, PAL.steelDark);
}

function vent(cv: Canvas, x: number, y: number): void {
  castOnRoof(cv, x, y, 4, 3, 1);
  cv.rect(x, y - 3, 4, 3, PAL.steelLight);
  cv.rect(x + 1, y - 3, 2, 2, PAL.ink);
  cv.hline(x, y - 3, 4, PAL.steelHi);
  cv.rect(x, y, 4, 3, PAL.steel);
  cv.vline(x + 3, y, 3, PAL.steelDark);
}

function bigFan(cv: Canvas, x: number, y: number): void {
  castOnRoof(cv, x, y, 9, 8, 1);
  cv.rect(x, y + 6, 9, 2, PAL.steelDark);
  cv.disc(x + 4, y + 2, 4, PAL.steel);
  cv.disc(x + 4, y + 2, 3, PAL.steelDark);
  cv.hline(x + 2, y + 2, 5, PAL.steelLight);
  cv.vline(x + 4, y, 5, PAL.steelLight);
  cv.set(x + 4, y + 2, PAL.ink);
  cv.set(x + 2, y - 1, PAL.steelHi);
}

/** Timber water tank up on a steel stand. */
function tank(cv: Canvas, x: number, y: number): void {
  const w = 11;
  castOnRoof(cv, x, y, w, 6, 7);
  const foot = y + 5;
  // Legs and bracing.
  for (const lx of [x, x + w - 2]) {
    cv.vline(lx, foot - 7, 8, PAL.steelLight);
    cv.vline(lx + 1, foot - 7, 8, PAL.steelDark);
  }
  cv.line(x + 1, foot - 1, x + w - 2, foot - 6, PAL.steelDark);
  cv.hline(x, foot - 7, w, PAL.steel);
  // Barrel: staves lit from the west, hoops round it.
  const top = foot - 20;
  for (let i = 0; i < w; i++) {
    const c =
      i < 3
        ? PAL.woodLight
        : i > w - 4
          ? PAL.woodDark
          : i % 2 === 0
            ? PAL.wood
            : darker(PAL.wood, 0.12);
    cv.vline(x + i, top + 2, 12, c);
  }
  cv.hline(x, top + 5, w, PAL.steelDark);
  cv.hline(x, top + 10, w, PAL.steelDark);
  cv.hline(x, top + 13, w, PAL.ink);
  // Conical lid.
  cv.hline(x + 1, top + 1, w - 2, PAL.woodLight);
  cv.hline(x + 3, top, w - 6, lighter(PAL.woodLight, 0.2));
  cv.hline(x, top + 2, w, PAL.woodDark);
  cv.set(x + (w >> 1), top - 1, PAL.steelLight);
}

function skylight(cv: Canvas, x: number, y: number, w: number, h: number, lit: boolean): void {
  cv.rect(x, y, w, h, PAL.steelDark);
  cv.hline(x, y, w, PAL.steelLight);
  cv.hline(x, y + h, w, PAL.ink);
  if (lit) {
    emissive(cv, () => {
      for (let yy = 1; yy < h - 1; yy++) {
        for (let xx = 1; xx < w - 1; xx++) {
          if (xx % 4 === 0) continue;
          cv.set(x + xx, y + yy, yy === 1 ? PAL.windowWarm : PAL.windowMid);
        }
      }
    });
  } else {
    for (let yy = 1; yy < h - 1; yy++)
      for (let xx = 1; xx < w - 1; xx++)
        if (xx % 4 !== 0) cv.set(x + xx, y + yy, (xx + yy) % 6 === 0 ? PAL.glassLight : PAL.glass);
  }
}

/** Stair bulkhead with a door and a lamp over it. */
function hut(cv: Canvas, x: number, y: number, w: number, b: BuildingRamp): void {
  const r = 12;
  castOnRoof(cv, x, y, w, 8, 5);
  drawBox(cv, x + leanOf(r), y - r, w, 8, r, b.roof, b.wall);
  cv.hline(x + leanOf(r), y - r, w, b.rim);
  cv.hline(x + leanOf(r), y - r + 7, w, b.trim);
  cv.hline(x + leanOf(r - 1), y - r + 8, w, b.deep);
  const dx = x + (w >> 1) - 1;
  cv.rect(dx, y - 1, 5, 9, b.deep);
  cv.rect(dx + 1, y, 3, 8, PAL.steelDark);
  cv.vline(dx + 1, y, 8, PAL.steel);
  emissive(cv, () => cv.set(dx + 6, y - 2, PAL.lamp));
}

/** Mechanical penthouse: a louvred plant room with a flue. */
function plantRoom(cv: Canvas, x: number, y: number, w: number, d: number): void {
  const r = 10;
  castOnRoof(cv, x, y, w, d, 4);
  drawBox(cv, x + leanOf(r), y - r, w, d, r, PAL.steelLight, PAL.steelDark);
  cv.rect(x + leanOf(r) + 2, y - r + 2, w - 4, d - 4, PAL.steel);
  cv.hline(x + leanOf(r), y - r, w, PAL.steelHi);
  for (let k = 2; k < r - 2; k += 2) cv.hline(x + 3 + leanOf(r - k), y - r + d + k, w - 5, PAL.ink);
  // Flue.
  const fx = x + w - 5;
  cv.rect(fx, y - r - 7 + (d >> 1), 3, 8, PAL.steel);
  cv.vline(fx, y - r - 7 + (d >> 1), 8, PAL.steelHi);
  cv.hline(fx - 1, y - r - 8 + (d >> 1), 5, PAL.steelDark);
}

function antenna(cv: Canvas, x: number, y: number, len: number, beacon: boolean): void {
  for (let k = 1; k <= 4; k++) cv.map(x + k, y + k, contactShade);
  cv.vline(x, y - len, len + 1, PAL.steelLight);
  cv.hline(x - 2, y - len + 3, 5, PAL.steel);
  cv.hline(x - 1, y - len + 6, 3, PAL.steel);
  cv.set(x, y, PAL.steelDark);
  if (beacon) emissive(cv, () => cv.set(x, y - len, PAL.red));
  else cv.set(x, y - len, PAL.steelHi);
}

function dish(cv: Canvas, x: number, y: number): void {
  castOnRoof(cv, x + 1, y + 1, 4, 2, 2);
  cv.vline(x + 3, y - 3, 5, PAL.steelDark);
  cv.disc(x + 3, y - 5, 3, PAL.steelLight);
  cv.disc(x + 3.5, y - 4.5, 2, PAL.steel);
  cv.set(x + 2, y - 7, PAL.steelHi);
  cv.set(x + 3, y - 5, PAL.ink);
}

function solar(cv: Canvas, x: number, y: number, cols: number, rows: number): void {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = x + c * 8;
      const py = y + r * 7;
      cv.map(px + 1, py + 6, contactShade);
      cv.mapRect(px + 2, py + 6, 6, 1, contactShade);
      cv.rect(px, py - 1, 7, 4, SOLAR);
      cv.hline(px, py - 1, 7, SOLAR_HI);
      cv.vline(px + 3, py, 3, SOLAR_DARK);
      cv.set(px + 1, py, PAL.cyanHi);
      cv.hline(px, py + 3, 7, SOLAR_DARK);
      cv.set(px, py + 4, PAL.steelDark);
      cv.set(px + 6, py + 4, PAL.steelDark);
    }
  }
}

function pipeRun(cv: Canvas, x: number, y: number, len: number, horizontal: boolean): void {
  for (let k = 0; k < len; k++) {
    const flange = k % 7 === 3;
    if (horizontal) {
      cv.set(x + k, y, flange ? PAL.steelHi : PAL.steelLight);
      cv.set(x + k, y + 1, flange ? PAL.steel : PAL.steelDark);
      cv.map(x + k + 1, y + 2, contactShade);
    } else {
      cv.set(x, y + k, flange ? PAL.steelHi : PAL.steelLight);
      cv.set(x + 1, y + k, flange ? PAL.steel : PAL.steelDark);
      cv.map(x + 2, y + k + 1, contactShade);
    }
  }
}

function duct(cv: Canvas, x: number, y: number, len: number, horizontal: boolean): void {
  if (horizontal) {
    riser(cv, x, y, len, 4, 4, PAL.steelLight, PAL.steel);
    for (let k = 6; k < len - 2; k += 6) cv.vline(x + 1 + k, y - 4, 4, PAL.steelDark);
  } else {
    riser(cv, x, y, 5, len, 4, PAL.steelLight, PAL.steel);
    for (let k = 6; k < len - 2; k += 6) cv.hline(x + 1, y - 4 + k, 5, PAL.steelDark);
  }
}

function chimney(cv: Canvas, x: number, y: number, b: BuildingRamp): void {
  const r = 10;
  castOnRoof(cv, x, y, 5, 4, 4);
  drawBox(cv, x + leanOf(r), y - r, 5, 4, r, b.rimLow, b.wall);
  cv.rect(x + leanOf(r) + 1, y - r + 1, 3, 2, PAL.ink);
  cv.hline(x + leanOf(r) - 1, y - r + 4, 7, b.trim);
}

function garden(cv: Canvas, x: number, y: number, w: number, h: number, rnd: () => number): void {
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const seam = yy % 3 === 2;
      cv.set(
        x + xx,
        y + yy,
        seam
          ? PAL.woodDark
          : hash2(x + xx, Math.floor(yy / 3), 31) < 0.3
            ? PAL.woodLight
            : PAL.wood,
      );
    }
  }
  // Planter along the north side, clipped shrubs standing in it.
  cv.rect(x, y, w, 3, PAL.soil);
  for (let k = 1; k < w - 3; k += 5) {
    cv.rect(x + k, y - 2, 4, 4, PAL.leafDark);
    cv.hline(x + k, y - 2, 4, rnd() < 0.5 ? PAL.leaf : PAL.leafLight);
    cv.hline(x + k, y + 2, 4, PAL.leafDeep);
  }
  if (w >= 22 && h >= 16) {
    const tx = x + w - 9;
    const ty = y + h - 6;
    cv.mapRect(tx - 1, ty + 2, 5, 1, contactShade);
    cv.rect(tx - 2, ty - 2, 5, 2, PAL.kerbIvory);
    cv.vline(tx, ty, 2, PAL.steelDark);
    cv.set(tx - 4, ty, PAL.coral);
    cv.set(tx + 4, ty, PAL.coral);
  }
  emissive(cv, () => {
    for (let k = 4; k < w - 3; k += 5) cv.set(x + k, y + 5 + ((k / 5) & 1), PAL.gold);
  });
}

function helipad(cv: Canvas, cx: number, cy: number, r: number): void {
  cv.disc(cx, cy, r, PAL.streetDark);
  cv.ring(cx, cy, r, PAL.steelDark);
  cv.ring(cx, cy, r - 2, PAL.paintWorn, 2);
  drawText(cv, cx - 4, cy - 6, 'H', PAL.paint, 'micro', 3);
  emissive(cv, () => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      cv.set(
        Math.round(cx + Math.cos(a) * (r + 2)),
        Math.round(cy + Math.sin(a) * (r + 2)),
        k % 2 === 0 ? PAL.mint : PAL.red,
      );
    }
  });
}

function pool(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x - 2, y - 2, w + 4, h + 4, PAL.kerbIvoryDark);
  cv.hline(x - 2, y - 2, w + 4, PAL.kerbIvory);
  cv.vline(x - 2, y - 2, h + 4, PAL.kerbIvory);
  emissive(cv, () => {
    cv.rect(x, y, w, h, PAL.glassLight);
    cv.rect(x, y, w, 2, PAL.glass);
    for (let yy = 3; yy < h - 1; yy += 3)
      for (let xx = 2 + ((yy / 3) & 1) * 3; xx < w - 3; xx += 7)
        cv.hline(x + xx, y + yy, 3, PAL.cyan);
    cv.set(x + 2, y + 3, PAL.cyanHi);
    cv.set(x + 3, y + 3, PAL.cyanHi);
  });
}

/** Hoarding standing on a lattice frame, facing south. (x, y) is the foot of its west leg. */
export function billboard(cv: Canvas, x: number, y: number, w: number, rnd: () => number): void {
  const h = 16;
  const legs = 7;
  castOnRoof(cv, x, y, w, 2, 6);
  const step = Math.max(8, Math.floor((w - 7) / 2));
  for (let lx = x + 3; lx < x + w - 2; lx += step) {
    cv.vline(lx, y - legs, legs + 1, PAL.steelLight);
    cv.vline(lx + 1, y - legs, legs + 1, PAL.steelDark);
    // Back stay.
    cv.line(lx + 2, y - legs + 1, lx + 5, y - 1, PAL.steelDark);
  }
  cv.hline(x + 2, y - 3, w - 4, PAL.steelDark);
  const by = y - legs - h;
  cv.rect(x, by, w, h, PAL.steelDark);
  cv.hline(x, by, w, PAL.steelHi);
  cv.vline(x, by, h, PAL.steelLight);
  cv.hline(x + 1, by + h, w - 1, PAL.ink);
  const a = NEON[(rnd() * 4) | 0]!;
  let bc = NEON[(rnd() * 4) | 0]!;
  if (bc === a) bc = NEON[(NEON.indexOf(a) + 1) % 4]!;
  const style = (rnd() * 3) | 0;
  emissive(cv, () => {
    for (let yy = 1; yy < h - 1; yy++) {
      for (let xx = 1; xx < w - 1; xx++) {
        let c: Color = PAL.inkSoft;
        if (style === 0) c = xx + yy * 2 < w * 0.7 ? a.dim : PAL.inkSoft;
        else if (style === 1) c = yy > h * 0.55 ? a.dim : PAL.inkSoft;
        else c = Math.hypot(xx - w * 0.3, yy - h * 0.5) < h * 0.36 ? a.dim : PAL.inkSoft;
        cv.set(x + xx, by + yy, c);
      }
    }
    const g = GLYPHS[(rnd() * GLYPHS.length) | 0]!;
    if (g.h + 4 <= h && g.w + 8 <= w)
      cv.stamp(x + w - g.w - 3, by + ((h - g.h) >> 1), g, { a: bc.c, b: bc.hi });
    // Wordmark bars: abstract, no real brand.
    for (let k = 0; k < 3; k++)
      cv.hline(
        x + 3,
        by + 3 + k * 3,
        Math.max(4, Math.round((w * 0.4 - k * 3) * (0.6 + rnd() * 0.4))),
        k === 0 ? PAL.ivory : bc.c,
      );
    for (let k = 4; k < w - 3; k += 8) cv.set(x + k, by + h - 1, PAL.lamp);
  });
}

/** Neon sign on a frame, facing south. Returns the top-left corner of the sign board. */
export function standingSign(
  cv: Canvas,
  x: number,
  y: number,
  spec: NeonSignSpec,
): { x: number; y: number } {
  const size = neonSignSize(spec);
  const legs = 5;
  castOnRoof(cv, x, y, size.w, 2, 4);
  for (const lx of [x + 2, x + size.w - 4]) {
    cv.vline(lx, y - legs, legs + 1, PAL.steelLight);
    cv.vline(lx + 1, y - legs, legs + 1, PAL.steelDark);
  }
  const by = y - legs - size.h;
  drawNeonSign(cv, x, by, spec);
  return { x, y: by };
}

export type PlacedSign = { x: number; y: number; w: number; h: number; spec: NeonSignSpec };

export type BuildingsOutput = {
  pools: LightPool[];
  lights: TerrainLight[];
};

/** A sign that must stand on a particular roof, for the animated loops. */
export type SignRequest = { lot: Lot; spec: NeonSignSpec; placed: PlacedSign | null };

function kindFor(lot: Lot, rnd: () => number): FacadeKind {
  const roll = rnd();
  if (lot.front <= 8) {
    if (lot.floors >= 4 && lot.w >= 40 && roll < 0.3) return 'office';
    return roll < 0.84 ? 'shop' : 'flats';
  }
  if (lot.family === ROOF_TEAL || lot.family === ROOF_OLIVE) {
    if (lot.w >= 36 && lot.floors <= 3 && roll < 0.5) return 'works';
  }
  if ((lot.family === ROOF_SLATE || lot.family === ROOF_CONCRETE) && lot.floors >= 4 && lot.w >= 40)
    return roll < 0.55 ? 'office' : 'flats';
  if (lot.w >= 44 && lot.floors <= 2 && roll < 0.14) return 'works';
  return roll < 0.36 ? 'shop' : 'flats';
}

const FLAT = 0;
const GABLE_NS = 1;
const GABLE_EW = 2;
const HIP = 3;

/** One box of a building, with what its walls and roof should look like. */
type Part = Mass & {
  /** True when the south wall has a street floor. */
  ground: boolean;
  roofKind: number;
  /** Height of the ridge above the eaves on a pitched roof. */
  gable: number;
  /** Roof takes mechanical clutter; `features` also allows signs, gardens and the like. */
  dress: boolean;
  features: boolean;
  windows: boolean;
  /** Parts of this roof that something else stands on, in roof coordinates. */
  taken: Rect[];
};

/**
 * Breaks a lot into masses. Most buildings are more than one box: a lower front, a wing that
 * stops a storey or two short, a corner turret, a shaft set back on a podium. Every step
 * exposes a wall and gives the taller part something to throw its shadow on.
 */
function planParts(lot: Lot, rnd: () => number, kind: FacadeKind, plain: boolean): Part[] {
  const F = lot.floors;
  const R = riseForFloors(F);
  const mk = (r: Rect, rise: number, base: number, more: Partial<Part> = {}): Part => ({
    x: r.x,
    y: r.y,
    w: r.w,
    d: r.h,
    r: rise,
    base,
    ground: base === 0,
    roofKind: FLAT,
    gable: 0,
    dress: true,
    features: false,
    windows: true,
    taken: [],
    ...more,
  });
  const full: Rect = { x: lot.x, y: lot.y, w: lot.w, h: lot.h };
  if (plain) return [mk(full, R, 0, { features: true })];

  if (lot.tower > 0) {
    // Podium, shaft, and a crown or plant floor on top.
    const podium = mk(full, R, 0);
    const tw = Math.min(
      lot.w - 10,
      Math.max(30, Math.round((lot.w * (0.48 + rnd() * 0.2)) / 2) * 2),
    );
    const td = Math.min(lot.h - 12, Math.max(26, Math.round(lot.h * (0.46 + rnd() * 0.16))));
    const tx = lot.x + 5 + ((rnd() * Math.max(1, lot.w - tw - 9)) | 0);
    const ty = lot.y + 4;
    const shaft = mk({ x: tx, y: ty, w: tw, h: td }, riseForFloors(F + lot.tower), R, {
      dress: false,
    });
    podium.taken.push({ x: tx - lot.x - 2, y: 0, w: tw + 4 + leanOf(shaft.r - R), h: td + 8 });
    const parts = [podium, shaft];
    if (tw >= 34 && td >= 28 && rnd() < 0.75) {
      const inset = 5;
      parts.push(
        mk(
          { x: tx + inset, y: ty + inset, w: tw - inset * 2, h: td - inset * 2 },
          shaft.r + 9,
          shaft.r,
          {
            windows: false,
            dress: true,
          },
        ),
      );
      shaft.taken.push({ x: 0, y: 0, w: tw, h: td });
    } else shaft.dress = true;
    return parts;
  }

  const roll = rnd();
  const pitched =
    lot.family === ROOF_MAROON || lot.family === ROOF_TEAL || lot.family === ROOF_OLIVE;
  if (pitched && F <= 3 && lot.w <= 110 && lot.h <= 90 && roll < 0.6) {
    const ns = lot.h > lot.w;
    const g = Math.min(Math.max(5, Math.round(Math.min(lot.w, lot.h) * 0.2)), 13, lot.cap - R);
    if (g >= 4)
      return [mk(full, R, 0, { roofKind: ns ? GABLE_NS : GABLE_EW, gable: g, dress: false })];
  }
  if (F >= 2 && lot.h >= 44 && roll < 0.36) {
    // Lower front, taller back.
    const k = Math.min(F - 1, 1 + ((rnd() * 2) | 0));
    const df = Math.max(16, Math.round(lot.h * (0.3 + rnd() * 0.2)));
    const front = mk({ x: lot.x, y: lot.y + lot.h - df, w: lot.w, h: df }, riseForFloors(F - k), 0);
    const back = mk({ x: lot.x, y: lot.y, w: lot.w, h: lot.h - df }, R, front.r, {
      wbase: 0,
      features: true,
    });
    return [back, front];
  }
  if (F >= 2 && lot.w >= 58 && roll < 0.64) {
    // A wing that stops short of the main block.
    const grid = facadeBays(lot.w, kind);
    const split = grid.x(1 + ((rnd() * (grid.bays - 1)) | 0)) + 1;
    const west = rnd() < 0.5;
    const k = Math.min(F - 1, 1 + ((rnd() * 2) | 0));
    const ww = west ? split : lot.w - split;
    if (ww >= 24 && lot.w - ww >= 24) {
      const wingR = riseForFloors(F - k);
      const wing = mk(
        { x: west ? lot.x : lot.x + lot.w - ww, y: lot.y, w: ww, h: lot.h },
        wingR,
        0,
      );
      const main = mk({ x: west ? lot.x + ww : lot.x, y: lot.y, w: lot.w - ww, h: lot.h }, R, 0, {
        wbase: west ? wingR : 0,
        features: true,
      });
      return [main, wing];
    }
  }
  if (F >= 2 && lot.w >= 46 && lot.h >= 32 && roll < 0.8 && R + FLOOR_N + 13 <= lot.cap) {
    // Corner turret under a pyramid cap.
    const s = 18 + ((rnd() * 3) | 0) * 2;
    const west = rnd() < 0.5;
    const main = mk(full, R, 0, { features: true });
    const tx = west ? 0 : lot.w - s;
    main.taken.push({ x: tx - 2, y: lot.h - s - 2, w: s + 4 + leanOf(FLOOR_N), h: s + 2 });
    const turret = mk({ x: lot.x + tx, y: lot.y + lot.h - s, w: s, h: s }, R + FLOOR_N, 0, {
      wbase: west ? 0 : R,
      roofKind: HIP,
      gable: 12,
      dress: false,
    });
    return [main, turret];
  }
  return [mk(full, R, 0, { features: true })];
}

function ridgeHeight(p: Part, lx: number, ly: number): number {
  if (p.roofKind === GABLE_NS) {
    const mid = (p.w - 1) / 2;
    return Math.round(p.gable * (1 - Math.abs(lx - mid) / mid));
  }
  if (p.roofKind === GABLE_EW) {
    const mid = (p.d - 1) / 2;
    return Math.round(p.gable * (1 - Math.abs(ly - mid) / mid));
  }
  const m = Math.min(lx, p.w - 1 - lx, ly, p.d - 1 - ly);
  return Math.min(p.gable, Math.round((m * p.gable) / (Math.min(p.w, p.d) / 2 - 1)));
}

/**
 * Pitched roof texture. The slope toward the light is the bright one and the slope away from
 * it drops into shade, which is what makes the ridge stand up.
 */
function pitchTone(p: Part, b: BuildingRamp, lx: number, ly: number): Color {
  const course = (q: number, c: Color, alt: Color): Color => (q % 4 === 3 ? alt : c);
  const shade = mixc(b.roofLine, b.inner, 0.45);
  const shadeAlt = mixc(b.roofLine, b.inner, 0.75);
  if (p.roofKind === GABLE_NS) {
    const mid = (p.w - 1) / 2;
    if (Math.abs(lx - mid) < 1) return b.rim;
    if (lx === 0) return b.rimLow;
    if (lx === p.w - 1) return b.inner;
    return lx < mid ? course(ly, b.roof, b.roofAlt) : course(ly, shade, shadeAlt);
  }
  if (p.roofKind === GABLE_EW) {
    const mid = (p.d - 1) / 2;
    if (Math.abs(ly - mid) < 1) return b.rim;
    if (ly === 0) return b.rimLow;
    if (ly === p.d - 1) return b.inner;
    if (lx === 0) return b.rimLow;
    return ly < mid
      ? course(lx, b.roof, b.roofAlt)
      : course(lx, mixc(b.roofLine, b.roofAlt, 0.4), b.roofLine);
  }
  // Pyramid: four slopes meeting at a point, each with its own value.
  const dw = lx;
  const de = p.w - 1 - lx;
  const dn = ly;
  const ds = p.d - 1 - ly;
  const m = Math.min(dw, de, dn, ds);
  if (m === 0) return dn === 0 || dw === 0 ? b.rim : b.trim;
  if (m === dw && m === dn) return b.rim;
  if (m === dw) return course(ly, lighter(b.roof, 0.12), b.roof);
  if (m === dn) return course(lx, b.roofAlt, b.trim);
  if (m === ds) return course(lx, b.pier, b.wall);
  return course(ly, b.wall, b.wallLow);
}

type Plan = { lot: Lot; rnd: () => number; kind: FacadeKind; parts: Part[] };

export function buildBuildings(
  ctx: BakeContext,
  scene: Scene,
  layout: CityLayout,
  wantsBillboard: (lot: Lot) => boolean,
  requests: readonly SignRequest[],
  out: BuildingsOutput,
): void {
  dressYards(ctx, scene, layout);
  // First every building decides its masses, so that the shadow volume knows all of them.
  const plans: Plan[] = [];
  for (const lot of layout.lots) {
    if (!lot || lot.tag) continue;
    const rnd = mulberry32(lot.seed);
    const kind = kindFor(lot, rnd);
    const request = requests.some((q) => q.lot === lot);
    const parts = planParts(lot, rnd, kind, request);
    for (const p of parts) scene.solid(p.x, p.y, p.w, p.d, p.r);
    plans.push({ lot, rnd, kind, parts });
  }
  scene.later(() => {
    const names = { cursor: 0 };
    for (const plan of plans) paintLot(scene, plan, wantsBillboard, requests, out, names);
  });
}

/**
 * Back yards. Where a lot stops short of its neighbor, the strip of open ground in front of
 * its wall gets what a service yard holds: bins, crates, a car nosed in out of the street.
 */
function dressYards(ctx: BakeContext, scene: Scene, layout: CityLayout): void {
  const { w, h } = layout;
  const edge = ctx.field.edge;
  const free = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const i = y * w + x;
    return layout.roofId[i] === 0 && layout.ground[i] === G_YARD && edge[i]! > 26;
  };
  for (const lot of layout.lots) {
    if (!lot || lot.tag || lot.w < 30) continue;
    const rnd = mulberry32(lot.seed ^ 0x9e37);
    const sy = lot.y + lot.h;
    // Depth of the open strip along the whole south side.
    let depth = 0;
    for (; depth < 26; depth++) {
      let open = true;
      for (let x = lot.x + 2; x < lot.x + lot.w - 2 && open; x += 4) open = free(x, sy + depth);
      if (!open) break;
    }
    if (depth < 12) continue;
    const foot = sy + Math.min(depth, 24) - 3;
    let x = lot.x + 6 + ((rnd() * 8) | 0);
    while (x < lot.x + lot.w - 20) {
      const roll = rnd();
      if (roll < 0.3 && depth >= 24 && x + 34 < lot.x + lot.w) {
        if (
          parkCar(
            scene,
            x + 16,
            foot - 9,
            true,
            rnd() < 0.5,
            LIVERIES[(rnd() * LIVERIES.length) | 0]!,
          )
        )
          x += 38;
      } else if (roll < 0.55) {
        const sp = dumpsterSprite(LIVERIES[(rnd() * LIVERIES.length) | 0]!);
        if (stand(scene, sp, x + 8, foot, 15, 3)) x += 19;
      } else if (roll < 0.75) {
        if (stand(scene, crateStack((rnd() * 9999) | 0), x + 9, foot, 17, 3)) x += 21;
      } else if (roll < 0.85) {
        if (stand(scene, binSprite(), x + 2, foot, 4, 2)) x += 7;
      }
      x += 8 + ((rnd() * 26) | 0);
    }
  }
}

function paintLot(
  scene: Scene,
  plan: Plan,
  wantsBillboard: (lot: Lot) => boolean,
  requests: readonly SignRequest[],
  out: BuildingsOutput,
  names: { cursor: number },
): void {
  const { lot, rnd, kind, parts } = plan;
  const b = BUILDINGS[lot.family]!;
  const request = requests.find((q) => q.lot === lot);
  const solid = new Solid(scene, parts, ROOF_HEAD, 2);
  const cv = solid.cv;
  const street = lot.front <= 8 ? 1 : lot.roadDist < 120 ? 0.7 : 0.3;
  const nextName = (): string => SHOP_NAMES[names.cursor++ % SHOP_NAMES.length]!;

  // --- Roofs and walls --------------------------------------------------------------------
  let named = false;
  parts.forEach((p, index) => {
    if (p.roofKind === FLAT) {
      const ox = p.x - lot.x;
      const oy = p.y - lot.y;
      // Depth by value: the higher a roof stands, the more sky it catches. Low roofs sit a
      // step down, so a stack of roofs separates into near and far.
      const low = p.r <= riseForFloors(2);
      const high = p.r >= riseForFloors(5);
      solid.roof(p, (lx, ly) =>
        roofTone(b, p.w, p.d, lx, ly, (tx, ty) => {
          const c = roofTexture(lot, b, tx + ox, ty + oy);
          return low ? mixc(c, b.roofLine, 0.45) : high ? lighter(c, 0.07) : c;
        }),
      );
    } else {
      solid.roofShaped(
        p,
        (lx, ly) => ridgeHeight(p, lx, ly),
        (lx, ly) => pitchTone(p, b, lx, ly),
        b.wall,
        b.west,
      );
    }
    solid.west(p, westWall(b, p.r, (p.wbase ?? p.base) === 0, lot.seed + index * 131, p.windows));
    const rows = p.r - p.base;
    if (rows <= 0) return;
    const face = Canvas.sprite(p.w, rows);
    const wantsName = kind === 'shop' && p.ground && !named && p.w >= 30;
    if (wantsName) named = true;
    const res = paintFacade(face, p.w, rows, b, {
      kind: p.windows ? kind : 'works',
      family: lot.family,
      seed: lot.seed ^ (index * 7919),
      ground: p.ground,
      name: wantsName ? nextName() : '',
      street,
    });
    if (!p.windows) {
      // A blank plant floor: louvres instead of windows.
      for (let ly = CORNICE + 1; ly < rows - 1; ly += 2) face.hline(3, ly, p.w - 6, b.wallLow);
    }
    solid.south(p, face);
    for (const dc of res.decals) solid.decal(p, dc.x, dc.y, dc.art);
    if (!p.ground) return;
    const footY = p.y + p.d;
    for (const g of res.glows) {
      // Light spills onto whatever ground lies at the foot of the wall.
      out.pools.push({
        x: p.x + g.x,
        y: footY + 2,
        radii: [g.reach * 0.6, g.reach],
        tint: g.tint,
        squashY: 1.5,
      });
      if (lot.front <= 30 && g.reach >= 12)
        out.lights.push({
          x: Math.round(p.x + g.x),
          y: footY + 2,
          radius: Math.round(g.reach + 6),
          color: TINT_HEX[g.tint]!,
          intensity: 0.4,
        });
    }
  });

  // --- Roof dressing, collected and then painted back to front ----------------------------
  const draws: Array<{ key: number; fn: () => void }> = [];
  for (const p of parts) {
    if (!p.dress || p.roofKind !== FLAT) continue;
    const w = p.w;
    const d = p.d;
    const occ: Rect[] = p.taken.slice();
    const fits = (x: number, y: number, bw: number, bh: number): boolean => {
      if (x < 5 || y < 7 || x + bw > w - 4 || y + bh > d - 4) return false;
      for (const o of occ)
        if (x < o.x + o.w + 2 && o.x < x + bw + 2 && y < o.y + o.h + 2 && o.y < y + bh + 2)
          return false;
      return true;
    };
    const place = (bw: number, bh: number, tries = 10): { x: number; y: number } | null => {
      for (let t = 0; t < tries; t++) {
        const x = 5 + ((rnd() * Math.max(1, w - bw - 9)) | 0);
        const y = 7 + ((rnd() * Math.max(1, d - bh - 11)) | 0);
        if (fits(x, y, bw, bh)) {
          occ.push({ x, y, w: bw, h: bh });
          return { x, y };
        }
      }
      return null;
    };
    /** Queues a thing whose footprint's north-west corner is roof point `at`, `bh` deep. */
    const add = (
      at: { x: number; y: number },
      bh: number,
      fn: (x: number, y: number) => void,
    ): void => {
      draws.push({
        key: p.y + at.y + bh,
        fn: () =>
          solid.onRoof(p, at.y + bh + 8, () => fn(solid.roofX(p, at.x), solid.roofY(p, at.y))),
      });
    };
    const minDim = Math.min(w, d);
    const area = w * d;
    let hasFeature = !p.features;

    // A sign somebody asked for comes first, toward the front of the roof.
    if (request && p.features) {
      const size = neonSignSize(request.spec);
      const x = (w - size.w) >> 1;
      const y = Math.max(8, d - 8);
      occ.push({ x, y: y - 2, w: size.w, h: 4 });
      add({ x, y }, 2, (cx, cy) => {
        const at = standingSign(cv, cx, cy, request.spec);
        request.placed = {
          x: solid.ox + at.x,
          y: solid.oy + at.y,
          w: size.w,
          h: size.h,
          spec: request.spec,
        };
      });
      const nc = NEON[request.spec.color]!;
      out.pools.push({
        x: p.x + w / 2,
        y: p.y + d + 6,
        radii: [18, 30],
        tint: nc.tint,
        squashY: 1.4,
      });
      out.lights.push({
        x: Math.round(p.x + w / 2),
        y: p.y + d,
        radius: 64,
        color: nc.hex,
        intensity: 0.7,
      });
      hasFeature = true;
    }

    // Billboard Row: every roof that can carry a hoarding gets one, facing the straight.
    if (!hasFeature && w >= 44 && d >= 20 && wantsBillboard(lot)) {
      const bw = Math.min(w - 10, 38 + ((rnd() * 14) | 0));
      const x = 5 + ((rnd() * Math.max(1, w - bw - 9)) | 0);
      const y = d - 7;
      occ.push({ x, y: y - 3, w: bw, h: 5 });
      add({ x, y }, 2, (cx, cy) => billboard(cv, cx, cy, bw, rnd));
      hasFeature = true;
      out.lights.push({
        x: Math.round(p.x + x + bw / 2),
        y: p.y + d,
        radius: Math.round(bw * 0.62),
        color: '#FFC47A',
        intensity: 0.4,
      });
    }

    // One feature on roomy roofs.
    if (!hasFeature && minDim >= 50 && area >= 3600) {
      const roll = rnd();
      if (roll < 0.14 && minDim >= 60) {
        const at = place(42, 42, 6);
        if (at) add(at, 0, (x, y) => helipad(cv, x + 21, y + 21, 17));
      } else if (roll < 0.34) {
        const gw = 26 + ((rnd() * 20) | 0);
        const gh = 18 + ((rnd() * 12) | 0);
        const at = place(gw, gh, 6);
        if (at) add(at, 0, (x, y) => garden(cv, x, y, gw, gh, rnd));
      } else if (roll < 0.5) {
        const cols = 3 + ((rnd() * 3) | 0);
        const rows = 2 + ((rnd() * 3) | 0);
        const at = place(cols * 8, rows * 7, 6);
        if (at) add(at, rows * 7, (x, y) => solar(cv, x, y, cols, rows));
      } else if (roll < 0.6) {
        const pw = 24 + ((rnd() * 14) | 0);
        const at = place(pw + 4, 18, 6);
        if (at) add(at, 0, (x, y) => pool(cv, x + 2, y + 2, pw, 14));
      } else if (roll < 0.86) {
        const bw = 38 + ((rnd() * 12) | 0);
        const at = place(bw, 4, 6);
        if (at) {
          add(at, 4, (x, y) => billboard(cv, x, y + 2, bw, rnd));
          hasFeature = true;
        }
      }
    }

    // Rooftop neon: common beside the track, rare deeper in the city.
    const nearTrack = lot.roadDist < 70;
    if (!hasFeature && w >= 34 && d >= 18 && rnd() < (nearTrack ? 0.3 : 0.1)) {
      const useGlyph = rnd() < 0.42;
      const color = (rnd() * 4) | 0;
      const spec: NeonSignSpec = {
        text: rnd() < 0.82 || !useGlyph ? nextName() : '',
        color,
        accent: (color + 1 + ((rnd() * 3) | 0)) % 4,
        scale: w >= 70 && rnd() < 0.5 ? 2 : 1,
        glyph: useGlyph ? (rnd() * GLYPHS.length) | 0 : -1,
      };
      let size = neonSignSize(spec);
      if (size.w > w - 12) {
        spec.scale = 1;
        size = neonSignSize(spec);
      }
      const at = size.w <= w - 12 ? place(size.w, 4, 8) : null;
      if (at) {
        add(at, 4, (x, y) => standingSign(cv, x, y + 2, spec));
        const nc = NEON[spec.color]!;
        out.lights.push({
          x: Math.round(p.x + at.x + size.w / 2),
          y: p.y + at.y - p.r,
          radius: 46,
          color: nc.hex,
          intensity: 0.5,
        });
      }
    }

    // Structures with real height first: a stair bulkhead, a tank on its stand, a plant room.
    if (minDim >= 26 && rnd() < 0.5) {
      const hw = 11 + ((rnd() * 4) | 0);
      const at = place(hw + 4, 8);
      if (at) add(at, 8, (x, y) => hut(cv, x, y, hw, b));
    }
    if (minDim >= 28 && rnd() < 0.3) {
      const at = place(13, 6);
      if (at) add(at, 6, (x, y) => tank(cv, x + 1, y));
    }
    if (minDim >= 40 && area >= 2600 && rnd() < 0.4) {
      const pw = 18 + ((rnd() * 4) | 0) * 2;
      const pd = 10 + ((rnd() * 3) | 0) * 2;
      const at = place(pw + 4, pd);
      if (at) add(at, pd, (x, y) => plantRoom(cv, x, y, pw, pd));
    }
    // Then the small mechanical clutter: each roof favors a couple of kinds so roofs differ.
    const count = Math.max(1, Math.min(8, Math.round(area / 900)));
    const bias = (rnd() * 6) | 0;
    for (let k = 0; k < count; k++) {
      let roll = rnd() * 18;
      if (rnd() < 0.45) roll = bias * 3 + rnd() * 3;
      if (roll < 3) {
        const at = place(11, 6);
        if (at) add(at, 6, (x, y) => acUnit(cv, x, y));
        if (at && rnd() < 0.4 && fits(at.x + 13, at.y, 11, 6)) {
          const q = { x: at.x + 13, y: at.y };
          occ.push({ x: q.x, y: q.y, w: 11, h: 6 });
          add(q, 6, (x, y) => acUnit(cv, x, y));
        }
      } else if (roll < 6) {
        const at = place(4, 3);
        if (at) add(at, 3, (x, y) => vent(cv, x, y));
      } else if (roll < 7.5) {
        const at = place(9, 8);
        if (at) add(at, 8, (x, y) => bigFan(cv, x, y));
      } else if (roll < 10) {
        const sw = 9 + ((rnd() * 3) | 0) * 4;
        const sh2 = rnd() < 0.5 ? 6 : 8;
        const at = place(sw, sh2);
        const lit = rnd() < 0.55;
        if (at) add(at, sh2, (x, y) => skylight(cv, x, y, sw, sh2, lit));
      } else if (roll < 11.5) {
        const at = place(5, 3);
        const len = 10 + ((rnd() * 8) | 0);
        const beacon = rnd() < 0.35;
        if (at) add(at, 3, (x, y) => antenna(cv, x + 2, y + 1, len, beacon));
      } else if (roll < 12.5) {
        const at = place(7, 4);
        if (at) add(at, 4, (x, y) => dish(cv, x, y + 2));
      } else if (roll < 13.5) {
        const at = place(16, 14);
        if (at) add(at, 14, (x, y) => solar(cv, x, y, 2, 2));
      } else if (roll < 15) {
        const horizontal = rnd() < 0.5;
        const len = 10 + ((rnd() * 18) | 0);
        const at = horizontal ? place(len, 3) : place(3, len);
        if (at) add(at, 0, (x, y) => pipeRun(cv, x, y, len, horizontal));
      } else if (roll < 16.5) {
        const horizontal = rnd() < 0.5;
        const len = 12 + ((rnd() * 14) | 0);
        const at = horizontal ? place(len + 2, 4) : place(7, len);
        if (at) add(at, horizontal ? 4 : len, (x, y) => duct(cv, x, y, len, horizontal));
      } else {
        const at = place(8, 4);
        if (at) add(at, 4, (x, y) => chimney(cv, x, y, b));
      }
    }
  }
  // A mast on top of anything tall.
  const top = parts[parts.length - 1]!;
  if (lot.tower > 0) {
    draws.push({
      key: top.y + (top.d >> 1) + 1,
      fn: () =>
        solid.onRoof(top, (top.d >> 1) + 6, () =>
          antenna(cv, solid.roofX(top, top.w >> 1), solid.roofY(top, top.d >> 1), 18, true),
        ),
    });
  }
  draws.sort((p, q) => p.key - q.key);
  for (const dr of draws) dr.fn();
  scene.add(solid.item());
}

export { ROOF_MAROON, ROOF_PLUM };
