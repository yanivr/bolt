import { hash2, mulberry32 } from '@bolt/shared';
import type { TerrainLight } from '@bolt/shared';
import type { BakeContext } from '../biome.js';
import type { Canvas, Color } from '../canvas.js';
import { col } from '../canvas.js';
import { drawText } from '../font.js';
import type { LightPool } from '../lighting.js';
import { boxCanvas, standBox } from '../oblique.js';
import type { Scene } from '../oblique.js';
import { facadeBays, paintFacade } from './facade.js';
import type { FacadeKind } from './facade.js';
import { FLOOR_N } from './layout.js';
import type { CityLayout, Lot, Rect } from './layout.js';
import { GLYPHS, NEON, SHOP_NAMES, drawNeonSign, neonSignSize } from './neon.js';
import type { NeonSignSpec } from './neon.js';
import {
  BUILDINGS,
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
} from './palette.js';
import type { BuildingRamp } from './palette.js';
import { drawBox, emissive } from './sprites.js';

/**
 * Buildings. Each lot becomes one standing sprite: the roof seen from above with its parapet
 * and whatever stands on it, and the south facade below. Roof dressing stands up too, each
 * piece with its own small south face, painted back to front.
 */

/** Headroom above the roof for antennas, tanks, billboards and signs. */
export const ROOF_HEAD = 24;

/** Rows by which the roof of a lower wing sits below the main roof: one storey. */
const WING_DROP = FLOOR_N;

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

/** Roof surface with its parapet: lit rim all round, the north wall's inner face in shadow. */
export function paintRoofSurface(
  cv: Canvas,
  x0: number,
  y0: number,
  w: number,
  d: number,
  b: BuildingRamp,
  texture: (lx: number, ly: number) => Color,
): void {
  for (let ly = 0; ly < d; ly++) {
    for (let lx = 0; lx < w; lx++) {
      let c: Color;
      if (ly === 0 || lx === 0) c = b.rim;
      else if (ly === d - 1 || lx === w - 1) c = b.rimLow;
      else if (ly <= 2) c = b.inner;
      else if (ly === 3 || lx <= 2) c = b.roofLine;
      else c = texture(lx, ly);
      cv.set(x0 + lx, y0 + ly, c);
    }
  }
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
  castOnRoof(cv, x, y, w, d, Math.max(1, Math.min(3, r >> 1)));
  drawBox(cv, x, y - r, w, d, r, top, face);
}

function acUnit(cv: Canvas, x: number, y: number): void {
  riser(cv, x, y, 9, 6, 4, PAL.steelLight, PAL.steel);
  cv.ring(x + 3, y - 4 + 2.5, 2, PAL.steelDark);
  cv.set(x + 3, y - 4 + 2, PAL.steel);
  cv.hline(x + 1, y + 3, 7, PAL.steelDark);
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

/** Timber water tank on a steel stand. */
function tank(cv: Canvas, x: number, y: number): void {
  const w = 11;
  castOnRoof(cv, x, y, w, 6, 3);
  const foot = y + 5;
  // Legs.
  for (const lx of [x + 1, x + w - 2]) cv.vline(lx, foot - 4, 5, PAL.steelDark);
  cv.hline(x + 1, foot - 2, w - 2, PAL.steelDark);
  // Barrel.
  const top = foot - 15;
  for (let i = 0; i < w; i++) {
    const c =
      i < 2
        ? PAL.woodLight
        : i > w - 3
          ? PAL.woodDark
          : i % 2 === 0
            ? PAL.wood
            : darker(PAL.wood, 0.12);
    cv.vline(x + i, top + 2, 10, c);
  }
  cv.hline(x, top + 5, w, PAL.steelDark);
  cv.hline(x, top + 9, w, PAL.steelDark);
  // Conical lid.
  cv.hline(x + 1, top + 1, w - 2, PAL.woodLight);
  cv.hline(x + 3, top, w - 6, PAL.woodLight);
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
  riser(cv, x, y, w, 7, 9, b.roofAlt, b.wallAlt);
  cv.frame(x, y - 9, w, 7, b.rimLow);
  cv.hline(x, y - 9, w, b.rim);
  const dx = x + (w >> 1) - 1;
  cv.rect(dx, y, 4, 6, PAL.ink);
  cv.rect(dx + 1, y + 1, 2, 5, PAL.steelDark);
  emissive(cv, () => cv.set(dx + 5, y, PAL.lamp));
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
    riser(cv, x, y, len, 4, 3, PAL.steelLight, PAL.steel);
    for (let k = 6; k < len - 2; k += 6) cv.vline(x + k, y - 3, 7, PAL.steelDark);
  } else {
    riser(cv, x, y, 5, len, 3, PAL.steelLight, PAL.steel);
    for (let k = 6; k < len - 2; k += 6) cv.hline(x, y - 3 + k, 5, PAL.steelDark);
  }
}

function chimney(cv: Canvas, x: number, y: number, b: BuildingRamp): void {
  riser(cv, x, y, 5, 4, 7, b.rimLow, b.wall);
  cv.rect(x + 1, y - 6, 3, 2, PAL.ink);
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

/** Hoarding standing on lattice legs, facing south. (x, y) is the foot of its west leg. */
export function billboard(cv: Canvas, x: number, y: number, w: number, rnd: () => number): void {
  const h = 15;
  const legs = 4;
  castOnRoof(cv, x, y, w, 2, 3);
  for (let lx = x + 3; lx < x + w - 2; lx += Math.max(8, Math.floor((w - 7) / 2))) {
    cv.vline(lx, y - legs, legs + 1, PAL.steelDark);
    cv.vline(lx + 1, y - legs, legs + 1, PAL.steel);
  }
  const by = y - legs - h;
  cv.rect(x, by, w, h, PAL.steelDark);
  cv.hline(x, by, w, PAL.steelLight);
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
  const legs = 3;
  castOnRoof(cv, x, y, size.w, 2, 2);
  for (const lx of [x + 2, x + size.w - 4]) {
    cv.vline(lx, y - legs, legs + 1, PAL.steelDark);
    cv.vline(lx + 1, y - legs, legs + 1, PAL.steel);
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
    if (lot.floors >= 3 && lot.w >= 40 && roll < 0.3) return 'office';
    return roll < 0.86 ? 'shop' : 'flats';
  }
  if (lot.family === ROOF_TEAL || lot.family === ROOF_OLIVE) {
    if (lot.w >= 36 && roll < 0.55) return 'works';
  }
  if ((lot.family === ROOF_SLATE || lot.family === ROOF_CONCRETE) && lot.floors >= 3 && lot.w >= 40)
    return roll < 0.6 ? 'office' : 'flats';
  if (lot.w >= 44 && roll < 0.14) return 'works';
  return roll < 0.38 ? 'shop' : 'flats';
}

type Occupied = Rect[];

export function buildBuildings(
  ctx: BakeContext,
  scene: Scene,
  layout: CityLayout,
  wantsBillboard: (lot: Lot) => boolean,
  requests: readonly SignRequest[],
  out: BuildingsOutput,
): void {
  let nameCursor = 0;
  for (const lot of layout.lots) {
    if (!lot || lot.tag) continue;
    const rnd = mulberry32(lot.seed);
    const b = BUILDINGS[lot.family]!;
    const w = lot.w;
    const d = lot.h;
    const r = lot.rise;
    const cv = boxCanvas(w, d, r, ROOF_HEAD);
    const ry = ROOF_HEAD;
    const request = requests.find((q) => q.lot === lot);
    const kind = kindFor(lot, rnd);
    // Some buildings step down a storey over part of their width. The split falls between two
    // window bays, so the lower wing simply has one floor fewer.
    let wing: { x0: number; w: number } | null = null;
    if (!request && lot.floors >= 2 && w >= 56 && rnd() < 0.42) {
      const grid = facadeBays(w, kind);
      const split = grid.x(1 + ((rnd() * (grid.bays - 1)) | 0));
      const cand = rnd() < 0.5 ? { x0: split, w: w - split } : { x0: 0, w: split };
      if (cand.w >= 22 && w - cand.w >= 22) wing = cand;
    }
    const drop = (x: number): number =>
      wing && x >= wing.x0 && x < wing.x0 + wing.w ? WING_DROP : 0;
    const mainX = wing && wing.x0 === 0 ? wing.w : 0;
    const mainW = wing ? w - wing.w : w;
    paintRoofSurface(cv, mainX, ry, mainW, d, b, (lx, ly) => roofTexture(lot, b, lx + mainX, ly));

    // --- Facade, then the lower wing's roof across the top of it ------------------------
    const street = lot.front <= 8 ? 1 : lot.roadDist < 120 ? 0.7 : 0.3;
    const glows = paintFacade(cv, 0, ry + d, w, r, b, {
      kind,
      family: lot.family,
      floors: lot.floors,
      seed: lot.seed,
      name: kind === 'shop' ? SHOP_NAMES[nameCursor++ % SHOP_NAMES.length]! : '',
      street,
    });
    if (wing) {
      const wx = wing.x0;
      paintRoofSurface(cv, wx, ry + WING_DROP, wing.w, d, b, (lx, ly) =>
        roofTexture(lot, b, lx + wx + 5, ly),
      );
      cv.hline(wx, ry + WING_DROP + d, wing.w, b.trim);
      cv.hline(wx, ry + WING_DROP + d + 1, wing.w, b.line);
      // The taller part throws its shadow across a wing to its east.
      if (wx > 0) cv.mapRect(wx + 1, ry + WING_DROP + 1, 4, d - 2, contactShade);
    }

    // --- Roof dressing, collected and then painted back to front -----------------------
    const draws: Array<{ key: number; fn: () => void }> = [];
    const occ: Occupied = [];
    const fits = (x: number, y: number, bw: number, bh: number): boolean => {
      if (x < 5 || y < 6 || x + bw > w - 4 || y + bh > d - 3) return false;
      for (const o of occ)
        if (x < o.x + o.w + 2 && o.x < x + bw + 2 && y < o.y + o.h + 2 && o.y < y + bh + 2)
          return false;
      return true;
    };
    const place = (bw: number, bh: number, tries = 10): { x: number; y: number } | null => {
      for (let t = 0; t < tries; t++) {
        const x = 5 + ((rnd() * Math.max(1, w - bw - 9)) | 0);
        const y = 6 + ((rnd() * Math.max(1, d - bh - 9)) | 0);
        if (fits(x, y, bw, bh)) {
          occ.push({ x, y, w: bw, h: bh });
          return { x, y };
        }
      }
      return null;
    };
    const add = (
      p: { x: number; y: number },
      bh: number,
      fn: (x: number, y: number) => void,
    ): void => {
      draws.push({ key: p.y + bh, fn: () => fn(p.x, ry + p.y + drop(p.x)) });
    };
    // Nothing straddles the step between the main roof and a wing.
    if (wing) occ.push({ x: (wing.x0 === 0 ? wing.w : wing.x0) - 4, y: 0, w: 8, h: d });
    const minDim = Math.min(w, d);
    const area = w * d;

    // A sign somebody asked for comes first, toward the front of the roof.
    let hasFeature = false;
    if (request) {
      const size = neonSignSize(request.spec);
      const x = (w - size.w) >> 1;
      const y = Math.max(8, d - 8);
      occ.push({ x, y: y - 2, w: size.w, h: 4 });
      draws.push({
        key: y + 2,
        fn: () => {
          const at = standingSign(cv, x, ry + y, request.spec);
          request.placed = {
            x: lot.x + at.x,
            y: lot.y - r - ROOF_HEAD + at.y,
            w: size.w,
            h: size.h,
            spec: request.spec,
          };
        },
      });
      const nc = NEON[request.spec.color]!;
      out.pools.push({
        x: lot.x + w / 2,
        y: lot.y + d + 6,
        radii: [18, 30],
        tint: nc.tint,
        squashY: 1.4,
      });
      out.lights.push({
        x: Math.round(lot.x + w / 2),
        y: lot.y + d,
        radius: 64,
        color: nc.hex,
        intensity: 0.7,
      });
      hasFeature = true;
    }

    // Tall buildings get a set-back top storey.
    let tier = false;
    if (!request && !wing && lot.floors >= 3 && minDim >= 46 && rnd() < 0.7) {
      tier = true;
      const inset = 8;
      const tw = w - inset * 2;
      const td = d - inset * 2 - 2;
      const tr = 9;
      occ.push({ x: 0, y: 0, w, h: d });
      draws.push({
        key: inset + td,
        fn: () => {
          const tx = inset;
          const ty = ry + inset + 2;
          castOnRoof(cv, tx, ty, tw, td, 3);
          paintRoofSurface(cv, tx, ty - tr, tw, td, b, (lx, ly) =>
            roofTexture(lot, b, lx + 3, ly + 5),
          );
          cv.rect(tx, ty - tr + td, tw, tr, b.wallAlt);
          cv.hline(tx, ty - tr + td, tw, b.trim);
          cv.vline(tx + tw - 1, ty - tr + td, tr, b.line);
          for (let x = tx + 3; x + 4 < tx + tw - 2; x += 7) {
            const lit = rnd() < 0.4;
            cv.rect(x, ty - tr + td + 2, 4, 5, b.line);
            if (lit)
              emissive(cv, () => {
                cv.rect(x, ty - tr + td + 3, 4, 4, PAL.windowMid);
                cv.hline(x, ty - tr + td + 3, 4, PAL.windowWarm);
              });
            else cv.rect(x, ty - tr + td + 3, 4, 4, PAL.windowNight);
          }
          cv.hline(tx, ty + td - 1, tw, PAL.ink);
          antenna(cv, tx + (tw >> 1), ty - tr + (td >> 1), 12, true);
          if (tw >= 34) acUnit(cv, tx + 6, ty - tr + (td >> 1));
        },
      });
    }

    // Billboard Row: every roof that can carry a hoarding gets one, facing the straight.
    if (!tier && !wing && !hasFeature && w >= 44 && d >= 20 && wantsBillboard(lot)) {
      const bw = Math.min(w - 10, 38 + ((rnd() * 14) | 0));
      const x = 5 + ((rnd() * Math.max(1, w - bw - 9)) | 0);
      const y = d - 6;
      occ.push({ x, y: y - 3, w: bw, h: 5 });
      draws.push({ key: y + 2, fn: () => billboard(cv, x, ry + y + drop(x), bw, rnd) });
      hasFeature = true;
      out.lights.push({
        x: Math.round(lot.x + x + bw / 2),
        y: lot.y + d,
        radius: Math.round(bw * 0.62),
        color: '#FFC47A',
        intensity: 0.4,
      });
    }

    // One feature on roomy roofs.
    if (!tier && !hasFeature && minDim >= 56 && area >= 4200) {
      const roll = rnd();
      if (roll < 0.14 && minDim >= 60) {
        const p = place(42, 42, 6);
        if (p) add(p, 0, (x, y) => helipad(cv, x + 21, y + 21, 17));
      } else if (roll < 0.34) {
        const gw = 26 + ((rnd() * 20) | 0);
        const gh = 18 + ((rnd() * 12) | 0);
        const p = place(gw, gh, 6);
        if (p) add(p, 0, (x, y) => garden(cv, x, y, gw, gh, rnd));
      } else if (roll < 0.52) {
        const cols = 3 + ((rnd() * 3) | 0);
        const rows = 2 + ((rnd() * 3) | 0);
        const p = place(cols * 8, rows * 7, 6);
        if (p) add(p, rows * 7, (x, y) => solar(cv, x, y, cols, rows));
      } else if (roll < 0.62) {
        const pw = 24 + ((rnd() * 14) | 0);
        const p = place(pw + 4, 18, 6);
        if (p) add(p, 0, (x, y) => pool(cv, x + 2, y + 2, pw, 14));
      } else if (roll < 0.84) {
        const bw = 38 + ((rnd() * 12) | 0);
        const p = place(bw, 4, 6);
        if (p) {
          add(p, 4, (x, y) => billboard(cv, x, y + 2, bw, rnd));
          hasFeature = true;
        }
      }
    }

    // Rooftop neon: common beside the track, rare deeper in the city.
    const nearTrack = lot.roadDist < 70;
    if (!tier && !hasFeature && w >= 34 && d >= 18 && rnd() < (nearTrack ? 0.3 : 0.1)) {
      const useGlyph = rnd() < 0.42;
      const color = (rnd() * 4) | 0;
      const spec: NeonSignSpec = {
        text: rnd() < 0.82 || !useGlyph ? SHOP_NAMES[nameCursor++ % SHOP_NAMES.length]! : '',
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
      const p = size.w <= w - 12 ? place(size.w, 4, 8) : null;
      if (p) {
        add(p, 4, (x, y) => standingSign(cv, x, y + 2, spec));
        const nc = NEON[spec.color]!;
        out.lights.push({
          x: Math.round(lot.x + p.x + size.w / 2),
          y: lot.y + p.y - r,
          radius: 46,
          color: nc.hex,
          intensity: 0.5,
        });
      }
    }

    // Small mechanical clutter: each roof favors a couple of kinds so roofs differ.
    if (!tier) {
      const count = Math.max(1, Math.min(9, Math.round(area / 760)));
      const bias = (rnd() * 6) | 0;
      let huts = 0;
      let tanks = 0;
      for (let k = 0; k < count; k++) {
        let roll = rnd() * 20;
        if (rnd() < 0.45) roll = bias * 3 + rnd() * 3;
        if (roll < 2.6) {
          const p = place(9, 6);
          if (p) add(p, 6, (x, y) => acUnit(cv, x, y));
          if (p && rnd() < 0.4 && fits(p.x + 11, p.y, 9, 6)) {
            const q = { x: p.x + 11, y: p.y };
            occ.push({ x: q.x, y: q.y, w: 9, h: 6 });
            add(q, 6, (x, y) => acUnit(cv, x, y));
          }
        } else if (roll < 6) {
          const p = place(4, 3);
          if (p) add(p, 3, (x, y) => vent(cv, x, y));
        } else if (roll < 7.5) {
          const p = place(9, 8);
          if (p) add(p, 8, (x, y) => bigFan(cv, x, y));
        } else if (roll < 9.5) {
          if (huts++ === 0 && minDim >= 26) {
            const hw = 11 + ((rnd() * 4) | 0);
            const p = place(hw, 7);
            if (p) add(p, 7, (x, y) => hut(cv, x, y, hw, b));
          }
        } else if (roll < 12) {
          const sw = 9 + ((rnd() * 3) | 0) * 4;
          const sh2 = rnd() < 0.5 ? 6 : 8;
          const p = place(sw, sh2);
          const lit = rnd() < 0.55;
          if (p) add(p, sh2, (x, y) => skylight(cv, x, y, sw, sh2, lit));
        } else if (roll < 13.5) {
          if (tanks++ === 0 && minDim >= 28) {
            const p = place(11, 6);
            if (p) add(p, 6, (x, y) => tank(cv, x, y));
          }
        } else if (roll < 15) {
          const p = place(5, 3);
          const len = 9 + ((rnd() * 7) | 0);
          const beacon = rnd() < 0.35;
          if (p) add(p, 3, (x, y) => antenna(cv, x + 2, y + 1, len, beacon));
        } else if (roll < 16) {
          const p = place(7, 4);
          if (p) add(p, 4, (x, y) => dish(cv, x, y + 2));
        } else if (roll < 17) {
          const p = place(16, 14);
          if (p) add(p, 14, (x, y) => solar(cv, x, y, 2, 2));
        } else if (roll < 18.2) {
          const horizontal = rnd() < 0.5;
          const len = 10 + ((rnd() * 18) | 0);
          const p = horizontal ? place(len, 3) : place(3, len);
          if (p) add(p, 0, (x, y) => pipeRun(cv, x, y, len, horizontal));
        } else if (roll < 19.3) {
          const horizontal = rnd() < 0.5;
          const len = 12 + ((rnd() * 14) | 0);
          const p = horizontal ? place(len, 4) : place(5, len);
          if (p) add(p, horizontal ? 4 : len, (x, y) => duct(cv, x, y, len, horizontal));
        } else {
          const p = place(5, 4);
          if (p) add(p, 4, (x, y) => chimney(cv, x, y, b));
        }
      }
    }
    draws.sort((p, q) => p.key - q.key);
    for (const dr of draws) dr.fn();

    const footY = lot.y + d;
    for (const g of glows) {
      // Light spills onto whatever ground lies at the foot of the wall.
      out.pools.push({
        x: lot.x + g.x,
        y: footY + 2,
        radii: [g.reach * 0.6, g.reach],
        tint: g.tint,
        squashY: 1.5,
      });
      if (lot.front <= 30 && g.reach >= 12)
        out.lights.push({
          x: Math.round(lot.x + g.x),
          y: footY + 2,
          radius: Math.round(g.reach + 6),
          color: TINT_HEX[g.tint]!,
          intensity: 0.4,
        });
    }
    scene.add(standBox(cv, lot.x, lot.y, d, r, ROOF_HEAD));
    scene.footprint(lot.x, lot.y, w, d, Math.max(3, Math.min(11, Math.round(r * 0.28))));
  }
}

export { ROOF_MAROON, ROOF_PLUM };
