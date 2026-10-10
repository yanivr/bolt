import { hash2, mulberry32 } from '@bolt/shared';
import type { TerrainLight } from '@bolt/shared';
import type { BakeContext } from '../biome.js';
import type { Canvas, Color } from '../canvas.js';
import { col, mixc } from '../canvas.js';
import { drawText } from '../font.js';
import type { LightPool } from '../lighting.js';
import type { CityLayout, Lot, Rect } from './layout.js';
import { GLYPHS, NEON, SHOP_NAMES, drawNeonSign, neonSignSize } from './neon.js';
import type { NeonSignSpec } from './neon.js';
import {
  PAL,
  ROOFS,
  ROOF_CONCRETE,
  ROOF_MAROON,
  ROOF_OLIVE,
  ROOF_PLUM,
  ROOF_SLATE,
  ROOF_TEAL,
  TINT_CYAN,
  TINT_WARM,
  contactShade,
} from './palette.js';
import type { RoofRamp } from './palette.js';
import { box, discShadow, dropShadow, emissive } from './sprites.js';

/**
 * Rooftops: base material, parapets lit from the upper left, and dressing from a library of
 * mechanical and lived-in details. Height is told only by parapets, shadows and light.
 */

const SEED = 9203;
const LINE: readonly Color[] = ROOFS.map((r) => mixc(r.base, r.dark, 0.6));
const SOLAR_DARK = col('#1B2A50');
const SOLAR = col('#24396B');
const SOLAR_HI = col('#4F7CC0');

function roofTexture(lot: Lot, x: number, y: number): Color {
  const r = ROOFS[lot.family]!;
  const lx = x - lot.x;
  const ly = y - lot.y;
  const flip = (lot.seed & 1) === 1;
  switch (lot.family) {
    case ROOF_SLATE: {
      // Standing-seam metal sheets.
      const q = flip ? lx : ly;
      const p = flip ? ly : lx;
      if (q % 7 === 6) return LINE[lot.family]!;
      if (q % 7 === 0) return r.alt;
      const band = Math.floor(q / 7);
      if ((p + band * 9) % 22 === 0) return LINE[lot.family]!;
      return r.base;
    }
    case ROOF_TEAL: {
      // Ribbed copper-green sheet.
      const q = flip ? lx : ly;
      if (q % 4 === 0) return r.alt;
      if (q % 4 === 3 && hash2(x >> 3, y >> 3, SEED) < 0.5) return LINE[lot.family]!;
      return r.base;
    }
    case ROOF_MAROON: {
      // Clay tiles in staggered courses.
      const row = ly >> 2;
      const xo = lx + (row & 1) * 3;
      if ((ly & 3) === 3) return LINE[lot.family]!;
      if (xo % 6 === 5) return LINE[lot.family]!;
      return hash2(Math.floor(xo / 6) + lot.id, row, SEED + 1) < 0.3 ? r.alt : r.base;
    }
    case ROOF_PLUM: {
      // Tar and gravel.
      const hsh = hash2((x + (y & 2)) >> 1, y >> 1, SEED + 2);
      if (hsh < 0.05) return LINE[lot.family]!;
      if (hsh > 0.8) return r.alt;
      return r.base;
    }
    case ROOF_OLIVE: {
      // Membrane sheets with patch repairs.
      const q = flip ? lx : ly;
      if (q % 13 === 12) return LINE[lot.family]!;
      if (hash2(lx >> 3, ly >> 2, SEED + 3 + lot.id) < 0.16) return r.alt;
      return r.base;
    }
    case ROOF_CONCRETE:
    default: {
      // Cast slabs with stains.
      if (lx % 16 === 15 || ly % 16 === 15) return LINE[lot.family]!;
      const hsh = hash2((x + (y >> 1)) >> 2, y >> 1, SEED + 4);
      if (hsh < 0.09) return r.alt;
      if (hsh > 0.97) return LINE[lot.family]!;
      return r.base;
    }
  }
}

export function paintRoofBase(ctx: BakeContext, layout: CityLayout): void {
  const { world } = ctx;
  const { w, h, roofId, lots } = layout;
  const data = world.data;
  const heightPlane = world.height!;
  const same = (x: number, y: number, id: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && roofId[y * w + x] === id;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const id = roofId[i]!;
      if (!id) continue;
      const lot = lots[id]!;
      const r = ROOFS[lot.family]!;
      let c: Color;
      if (!same(x, y - 1, id) || !same(x - 1, y, id)) c = r.hi;
      else if (!same(x, y + 1, id) || !same(x + 1, y, id)) c = r.deep;
      else if (!same(x, y - 2, id) || !same(x - 2, y, id) || !same(x - 1, y - 1, id)) c = r.par;
      else if (!same(x, y + 2, id) || !same(x + 2, y, id) || !same(x + 1, y + 1, id)) c = r.dark;
      else if (!same(x, y - 3, id) || !same(x - 3, y, id) || !same(x - 2, y - 2, id)) c = r.deep;
      else if (!same(x, y - 4, id) || !same(x - 4, y, id)) c = r.dark;
      else c = roofTexture(lot, x, y);
      const o = i * 4;
      data[o] = (c >> 16) & 255;
      data[o + 1] = (c >> 8) & 255;
      data[o + 2] = c & 255;
      data[o + 3] = 255;
      heightPlane[i] = lot.height;
    }
  }
}

// --- Dressing library ---------------------------------------------------------------------------

function acUnit(cv: Canvas, x: number, y: number): void {
  box(cv, x, y, 9, 7, PAL.steel, PAL.steelLight, PAL.steelDark, 2);
  cv.ring(x + 3, y + 3, 2, PAL.steelDark);
  cv.set(x + 3, y + 3, PAL.steelLight);
  cv.vline(x + 6, y + 2, 3, PAL.steelDark);
}

function vent(cv: Canvas, x: number, y: number): void {
  discShadow(cv, x + 2, y + 2, 2, 1);
  cv.disc(x + 2, y + 2, 2, PAL.steel);
  cv.set(x + 2, y + 2, PAL.ink);
  cv.set(x + 1, y + 1, PAL.steelHi);
  cv.set(x + 3, y + 3, PAL.steelDark);
}

function bigFan(cv: Canvas, x: number, y: number): void {
  discShadow(cv, x + 4, y + 4, 4, 2);
  cv.disc(x + 4, y + 4, 4, PAL.steel);
  cv.disc(x + 4, y + 4, 3, PAL.steelDark);
  cv.hline(x + 2, y + 4, 5, PAL.steelLight);
  cv.vline(x + 4, y + 2, 5, PAL.steelLight);
  cv.set(x + 4, y + 4, PAL.ink);
  cv.set(x + 2, y + 1, PAL.steelHi);
  cv.set(x + 1, y + 2, PAL.steelHi);
}

function tank(cv: Canvas, x: number, y: number, r: number): void {
  const cx = x + r;
  const cy = y + r;
  discShadow(cv, cx, cy, r, 3);
  cv.disc(cx, cy, r, PAL.woodDark);
  cv.disc(cx, cy, r - 1, PAL.wood);
  cv.disc(cx - 1, cy - 1, r - 2.4, PAL.woodLight);
  cv.line(cx, cy, cx + r - 1, cy + r - 2, PAL.woodDark);
  cv.line(cx, cy, cx - r + 1, cy + 1, PAL.wood);
  cv.line(cx, cy, cx + 1, cy - r + 1, PAL.wood);
  cv.ring(cx, cy, r, PAL.woodDark);
  cv.rect(cx - 1, cy - 1, 3, 3, PAL.steelLight);
  cv.set(cx - 1, cy - 1, PAL.steelHi);
  cv.set(cx + 1, cy + 1, PAL.steel);
}

function skylight(cv: Canvas, x: number, y: number, w: number, h: number, lit: boolean): void {
  cv.rect(x, y, w, h, PAL.steelDark);
  cv.hline(x, y, w, PAL.steel);
  if (lit) {
    emissive(cv, () => {
      for (let yy = 1; yy < h - 1; yy++) {
        for (let xx = 1; xx < w - 1; xx++) {
          const mullion = xx % 4 === 0 || (h > 7 && yy === h >> 1);
          cv.set(
            x + xx,
            y + yy,
            mullion ? PAL.windowDim : yy === 1 ? PAL.windowWarm : PAL.windowMid,
          );
        }
      }
    });
  } else {
    for (let yy = 1; yy < h - 1; yy++) {
      for (let xx = 1; xx < w - 1; xx++) {
        const mullion = xx % 4 === 0;
        cv.set(
          x + xx,
          y + yy,
          mullion ? PAL.steelDark : (xx + yy) % 6 === 0 ? PAL.glassLight : PAL.glass,
        );
      }
    }
  }
}

function hut(cv: Canvas, x: number, y: number, w: number, h: number, r: RoofRamp): void {
  box(cv, x, y, w, h, r.par, r.hi, r.deep, 3);
  cv.rect(x + 2, y + 2, w - 4, h - 4, mixc(r.par, r.base, 0.5));
  cv.rect(x + (w >> 1) - 1, y + h - 1, 3, 1, PAL.ink);
  emissive(cv, () => cv.set(x + (w >> 1) + 2, y + h - 1, PAL.lamp));
}

function antenna(cv: Canvas, x: number, y: number, len: number, beacon: boolean): void {
  for (let k = 1; k <= len; k++) cv.map(x + k, y + k, contactShade);
  cv.hline(x - 2, y, 5, PAL.steel);
  cv.vline(x, y - 2, 5, PAL.steel);
  cv.set(x, y, PAL.steelHi);
  if (beacon) emissive(cv, () => cv.set(x, y, PAL.red));
}

function dish(cv: Canvas, x: number, y: number): void {
  discShadow(cv, x + 3, y + 3, 3, 2);
  cv.disc(x + 3, y + 3, 3, PAL.steelLight);
  cv.disc(x + 3.6, y + 3.6, 2, PAL.steel);
  cv.set(x + 2, y + 1, PAL.steelHi);
  cv.set(x + 1, y + 2, PAL.steelHi);
  cv.line(x + 3, y + 3, x + 5, y + 5, PAL.steelDark);
  cv.set(x + 3, y + 3, PAL.ink);
}

function solar(cv: Canvas, x: number, y: number, cols: number, rows: number): void {
  dropShadow(cv, x, y, cols * 8 - 1, rows * 6 - 1, 1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = x + c * 8;
      const py = y + r * 6;
      cv.rect(px, py, 7, 5, SOLAR);
      cv.hline(px, py, 7, SOLAR_HI);
      cv.hline(px, py + 4, 7, SOLAR_DARK);
      cv.vline(px + 3, py + 1, 3, SOLAR_DARK);
      cv.set(px + 1, py + 1, PAL.cyanHi);
      cv.set(px + 2, py + 2, SOLAR_HI);
    }
  }
}

function pipeRun(cv: Canvas, x: number, y: number, len: number, horizontal: boolean): void {
  for (let k = 0; k < len; k++) {
    const flange = k % 7 === 3;
    if (horizontal) {
      cv.set(x + k, y, flange ? PAL.steelHi : PAL.steelLight);
      cv.set(x + k, y + 1, flange ? PAL.steel : PAL.steelDark);
      cv.map(x + k, y + 2, contactShade);
    } else {
      cv.set(x, y + k, flange ? PAL.steelHi : PAL.steelLight);
      cv.set(x + 1, y + k, flange ? PAL.steel : PAL.steelDark);
      cv.map(x + 2, y + k, contactShade);
    }
  }
}

function duct(cv: Canvas, x: number, y: number, len: number, horizontal: boolean): void {
  if (horizontal) {
    box(cv, x, y, len, 5, PAL.steel, PAL.steelLight, PAL.steelDark, 2);
    for (let k = 6; k < len - 2; k += 6) cv.vline(x + k, y + 1, 3, PAL.steelDark);
  } else {
    box(cv, x, y, 5, len, PAL.steel, PAL.steelLight, PAL.steelDark, 2);
    for (let k = 6; k < len - 2; k += 6) cv.hline(x + 1, y + k, 3, PAL.steelDark);
  }
}

function chimney(cv: Canvas, x: number, y: number): void {
  box(cv, x, y, 5, 5, PAL.kerbShade, PAL.kerb, PAL.steelDark, 2);
  cv.rect(x + 1, y + 1, 3, 3, PAL.ink);
  cv.set(x + 1, y + 1, PAL.steelDark);
}

function hatch(cv: Canvas, x: number, y: number): void {
  cv.rect(x, y, 6, 6, PAL.steelDark);
  cv.hline(x, y, 6, PAL.steel);
  cv.vline(x, y, 6, PAL.steel);
  cv.set(x + 4, y + 3, PAL.steelLight);
  cv.map(x + 6, y + 6, contactShade);
}

function garden(cv: Canvas, x: number, y: number, w: number, h: number, rnd: () => number): void {
  // Timber deck.
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const seam = yy % 3 === 2 || (xx + (Math.floor(yy / 3) % 2) * 5) % 11 === 0;
      cv.set(
        x + xx,
        y + yy,
        seam
          ? PAL.woodDark
          : hash2(x + xx, Math.floor((y + yy) / 3), 31) < 0.3
            ? PAL.woodLight
            : PAL.wood,
      );
    }
  }
  // Planter beds along two sides.
  cv.rect(x, y, w, 4, PAL.soil);
  cv.rect(x, y, 4, h, PAL.soil);
  for (let k = 2; k < w - 2; k += 5) {
    cv.disc(x + k, y + 2, 2, PAL.leafDark);
    cv.disc(x + k - 0.5, y + 1.5, 1, rnd() < 0.5 ? PAL.leaf : PAL.leafLight);
  }
  for (let k = 6; k < h - 2; k += 5) {
    cv.disc(x + 2, y + k, 2, PAL.leafDark);
    cv.disc(x + 1.5, y + k - 0.5, 1, rnd() < 0.5 ? PAL.leaf : PAL.leafLight);
  }
  // Table with stools, and a string of bulbs.
  if (w >= 22 && h >= 18) {
    const tx = x + w - 9;
    const ty = y + h - 8;
    cv.map(tx + 1, ty + 3, contactShade);
    cv.map(tx + 2, ty + 3, contactShade);
    cv.disc(tx, ty, 2, PAL.kerbIvoryDark);
    cv.set(tx - 1, ty - 1, PAL.ivory);
    cv.set(tx - 4, ty, PAL.coralDim);
    cv.set(tx + 4, ty, PAL.coralDim);
    cv.set(tx, ty - 4, PAL.coralDim);
  }
  emissive(cv, () => {
    for (let k = 6; k < w - 3; k += 5) cv.set(x + k, y + 6 + ((k / 5) & 1), PAL.gold);
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
    cv.hline(x, y, w, PAL.glass);
    cv.vline(x, y, h, PAL.glass);
    for (let yy = 2; yy < h - 1; yy += 3) {
      for (let xx = 2 + ((yy / 3) & 1) * 3; xx < w - 3; xx += 7)
        cv.hline(x + xx, y + yy, 3, PAL.cyan);
    }
    cv.set(x + 2, y + 2, PAL.cyanHi);
    cv.set(x + 3, y + 2, PAL.cyanHi);
  });
}

function billboard(
  cv: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  rnd: () => number,
): void {
  dropShadow(cv, x, y, w, h, 3);
  cv.rect(x, y, w, h, PAL.steelDark);
  cv.hline(x, y, w, PAL.steelLight);
  cv.vline(x, y, h, PAL.steel);
  const a = NEON[(rnd() * 4) | 0]!;
  let b = NEON[(rnd() * 4) | 0]!;
  if (b === a) b = NEON[(NEON.indexOf(a) + 1) % 4]!;
  const style = (rnd() * 3) | 0;
  emissive(cv, () => {
    for (let yy = 2; yy < h - 2; yy++) {
      for (let xx = 2; xx < w - 2; xx++) {
        let c: Color = PAL.inkSoft;
        if (style === 0) c = xx + yy * 2 < w * 0.7 ? a.dim : PAL.inkSoft;
        else if (style === 1) c = yy > h * 0.55 ? a.dim : PAL.inkSoft;
        else c = Math.hypot(xx - w * 0.3, yy - h * 0.5) < h * 0.34 ? a.dim : PAL.inkSoft;
        cv.set(x + xx, y + yy, c);
      }
    }
    const g = GLYPHS[(rnd() * GLYPHS.length) | 0]!;
    if (g.h + 4 <= h && g.w + 8 <= w)
      cv.stamp(x + w - g.w - 4, y + ((h - g.h) >> 1), g, { a: b.c, b: b.hi });
    // Wordmark bars: abstract, no real brand.
    for (let k = 0; k < 3; k++)
      cv.hline(
        x + 4,
        y + 4 + k * 3,
        Math.max(4, Math.round((w * 0.4 - k * 3) * (0.6 + rnd() * 0.4))),
        k === 0 ? PAL.ivory : b.c,
      );
    // Footlights.
    for (let k = 4; k < w - 3; k += 8) cv.set(x + k, y + h - 1, PAL.lamp);
  });
}

export type RoofDressOutput = { pools: LightPool[]; lights: TerrainLight[] };

type Occupied = Rect[];

/** Roof ids that other painters have claimed; they get no random dressing. */
export function dressRoofs(
  ctx: BakeContext,
  layout: CityLayout,
  claimed: ReadonlySet<number>,
  taken: ReadonlyMap<number, Rect>,
  wantsBillboard: (lot: Lot) => boolean,
  out: RoofDressOutput,
): void {
  const { world } = ctx;
  const { w, roofId } = layout;
  world.clipMap = roofId;
  let nameCursor = 0;
  for (const lot of layout.lots) {
    if (!lot || lot.visible === 0 || claimed.has(lot.id) || lot.tag) continue;
    world.clipId = lot.id;
    world.curHeight = -1;
    world.curFlags = 0;
    const rnd = mulberry32(lot.seed);
    const r = ROOFS[lot.family]!;
    const occ: Occupied = [];
    if (lot.cut) occ.push(lot.cut);
    const pre = taken.get(lot.id);
    if (pre) occ.push(pre);
    const inside = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < layout.w && y < layout.h && roofId[y * w + x] === lot.id;
    const fits = (x: number, y: number, bw: number, bh: number): boolean => {
      // The whole footprint plus a margin must be on this roof, clear of the parapet.
      for (const [px, py] of [
        [x - 4, y - 4],
        [x + bw + 3, y - 4],
        [x - 4, y + bh + 3],
        [x + bw + 3, y + bh + 3],
        [x + (bw >> 1), y - 4],
        [x + (bw >> 1), y + bh + 3],
        [x - 4, y + (bh >> 1)],
        [x + bw + 3, y + (bh >> 1)],
      ] as const) {
        if (!inside(px, py)) return false;
      }
      for (const o of occ)
        if (x < o.x + o.w + 2 && o.x < x + bw + 2 && y < o.y + o.h + 2 && o.y < y + bh + 2)
          return false;
      return true;
    };
    const place = (bw: number, bh: number, tries = 10): { x: number; y: number } | null => {
      for (let t = 0; t < tries; t++) {
        const x = lot.x + 5 + ((rnd() * Math.max(1, lot.w - bw - 9)) | 0);
        const y = lot.y + 5 + ((rnd() * Math.max(1, lot.h - bh - 9)) | 0);
        if (fits(x, y, bw, bh)) {
          occ.push({ x, y, w: bw, h: bh });
          return { x, y };
        }
      }
      return null;
    };
    const center = (bw: number, bh: number): { x: number; y: number } | null => {
      const x = lot.x + ((lot.w - bw) >> 1);
      const y = lot.y + ((lot.h - bh) >> 1);
      if (!fits(x, y, bw, bh)) return null;
      occ.push({ x, y, w: bw, h: bh });
      return { x, y };
    };
    const minDim = Math.min(lot.w, lot.h);
    const area = lot.visible;
    const intact = lot.visible >= lot.w * lot.h - (lot.cut ? lot.cut.w * lot.cut.h : 0);

    // Tall buildings get a set-back upper tier.
    if (lot.height >= 15 && minDim >= 44 && intact && !lot.cut && !pre) {
      const inset = 8;
      const tw = lot.w - inset * 2;
      const th = lot.h - inset * 2;
      box(world, lot.x + inset, lot.y + inset, tw, th, r.alt, r.hi, r.deep, 4);
      world.frame(lot.x + inset + 1, lot.y + inset + 1, tw - 2, th - 2, r.par);
      world.hline(lot.x + inset + 2, lot.y + inset + th - 2, tw - 3, r.dark);
      world.vline(lot.x + inset + tw - 2, lot.y + inset + 2, th - 3, r.dark);
      occ.push(
        { x: lot.x, y: lot.y, w: lot.w, h: inset + 2 },
        { x: lot.x, y: lot.y + lot.h - inset - 2, w: lot.w, h: inset + 2 },
      );
      occ.push(
        { x: lot.x, y: lot.y, w: inset + 2, h: lot.h },
        { x: lot.x + lot.w - inset - 2, y: lot.y, w: inset + 2, h: lot.h },
      );
      const c = center(5, 5);
      if (c) antenna(world, c.x + 2, c.y + 2, 9, true);
    }

    // Billboard Row: every roof that can carry a hoarding gets one, facing the straight.
    let hasBillboard = false;
    if (!pre && lot.w >= 50 && lot.h >= 32 && wantsBillboard(lot)) {
      const bw = Math.min(lot.w - 12, 40 + ((rnd() * 16) | 0));
      const p = place(bw, 22, 14);
      if (p) {
        hasBillboard = true;
        billboard(world, p.x, p.y, bw, 22, rnd);
        out.pools.push({
          x: p.x + bw / 2,
          y: p.y + 24,
          radii: [bw * 0.4, bw * 0.62],
          tint: TINT_WARM,
          level: lot.id,
          squashY: 1.6,
        });
        out.lights.push({
          x: Math.round(p.x + bw / 2),
          y: p.y + 11,
          radius: Math.round(bw * 0.62),
          color: '#FFC47A',
          intensity: 0.4,
        });
      }
    }

    // One feature on roomy roofs.
    if (!hasBillboard && minDim >= 60 && area >= 4600) {
      const roll = rnd();
      if (roll < 0.16 && minDim >= 66) {
        const p = place(44, 44, 6);
        if (p) helipad(world, p.x + 22, p.y + 22, 18);
      } else if (roll < 0.36) {
        const gw = 26 + ((rnd() * 20) | 0);
        const gh = 20 + ((rnd() * 14) | 0);
        const p = place(gw, gh, 6);
        if (p) garden(world, p.x, p.y, gw, gh, rnd);
      } else if (roll < 0.56) {
        const cols = 3 + ((rnd() * 3) | 0);
        const rows = 3 + ((rnd() * 3) | 0);
        const p = place(cols * 8, rows * 6, 6);
        if (p) solar(world, p.x, p.y, cols, rows);
      } else if (roll < 0.66) {
        const pw = 24 + ((rnd() * 14) | 0);
        const p = place(pw + 4, 18, 6);
        if (p) {
          pool(world, p.x + 2, p.y + 2, pw, 14);
          out.pools.push({
            x: p.x + 2 + pw / 2,
            y: p.y + 9,
            radii: [pw * 0.55, pw * 0.8],
            tint: TINT_CYAN,
            level: lot.id,
            squashY: 1.5,
          });
        }
      } else if (roll < 0.86) {
        const bw = 40 + ((rnd() * 12) | 0);
        const p = place(bw, 22, 6);
        if (p) {
          billboard(world, p.x, p.y, bw, 22, rnd);
          out.pools.push({
            x: p.x + bw / 2,
            y: p.y + 24,
            radii: [bw * 0.4, bw * 0.62],
            tint: TINT_WARM,
            level: lot.id,
            squashY: 1.6,
          });
        }
      }
    }

    // Neon: common beside the track, rare deeper in the city.
    const nearTrack = lot.roadDist < 60;
    if (!pre && !hasBillboard && lot.w >= 34 && lot.h >= 22 && rnd() < (nearTrack ? 0.42 : 0.12)) {
      const useGlyph = rnd() < 0.42;
      const color = (rnd() * 4) | 0;
      const spec: NeonSignSpec = {
        text: rnd() < 0.82 || !useGlyph ? SHOP_NAMES[nameCursor++ % SHOP_NAMES.length]! : '',
        color,
        accent: (color + 1 + ((rnd() * 3) | 0)) % 4,
        scale: lot.w >= 70 && rnd() < 0.55 ? 2 : 1,
        glyph: useGlyph ? (rnd() * GLYPHS.length) | 0 : -1,
      };
      let size = neonSignSize(spec);
      if (size.w > lot.w - 12) {
        spec.scale = 1;
        size = neonSignSize(spec);
      }
      const p = size.w <= lot.w - 12 ? place(size.w, size.h, 8) : null;
      if (p) {
        drawNeonSign(world, p.x, p.y, spec);
        const nc = NEON[spec.color]!;
        const cx = p.x + size.w / 2;
        const cy = p.y + size.h / 2;
        out.pools.push({
          x: cx,
          y: cy,
          radii: [size.w * 0.5 + 3, size.w * 0.5 + 10],
          tint: nc.tint,
          level: lot.id,
          squashY: 1.5,
        });
        if (lot.roadDist < 40)
          out.pools.push({ x: cx, y: cy, radii: [30, 46], tint: nc.tint, level: 0 });
        out.lights.push({
          x: Math.round(cx),
          y: Math.round(cy),
          radius: 46,
          color: nc.hex,
          intensity: 0.5,
        });
      }
    }

    // Small mechanical clutter.
    const count = Math.max(1, Math.min(13, Math.round(area / 520)));
    let huts = 0;
    let tanks = 0;
    for (let k = 0; k < count; k++) {
      const roll = rnd() * 23.6;
      if (roll < 4) {
        const p = place(9, 7);
        if (p) acUnit(world, p.x, p.y);
        if (p && rnd() < 0.4 && fits(p.x + 11, p.y, 9, 7)) {
          occ.push({ x: p.x + 11, y: p.y, w: 9, h: 7 });
          acUnit(world, p.x + 11, p.y);
        }
      } else if (roll < 7.5) {
        const p = place(5, 5);
        if (p) vent(world, p.x, p.y);
      } else if (roll < 9.5) {
        const p = place(9, 9);
        if (p) bigFan(world, p.x, p.y);
      } else if (roll < 11.5) {
        if (huts++ === 0 && minDim >= 30) {
          const hw = 10 + ((rnd() * 4) | 0);
          const p = place(hw, 9);
          if (p) {
            hut(world, p.x, p.y, hw, 9, r);
            out.pools.push({
              x: p.x + hw / 2 + 1,
              y: p.y + 10,
              radii: [4, 8],
              tint: TINT_WARM,
              level: lot.id,
            });
          }
        }
      } else if (roll < 14.5) {
        const sw = 9 + ((rnd() * 3) | 0) * 4;
        const sh2 = rnd() < 0.5 ? 6 : 9;
        const p = place(sw, sh2);
        if (p) {
          const lit = rnd() < 0.62;
          skylight(world, p.x, p.y, sw, sh2, lit);
          if (lit)
            out.pools.push({
              x: p.x + sw / 2,
              y: p.y + sh2 / 2,
              radii: [sw * 0.5 + 2, sw * 0.5 + 6],
              tint: TINT_WARM,
              level: lot.id,
              squashY: 1.3,
            });
        }
      } else if (roll < 16) {
        if (tanks++ === 0 && minDim >= 34) {
          const tr = 5 + ((rnd() * 3) | 0);
          const p = place(tr * 2 + 1, tr * 2 + 1);
          if (p) tank(world, p.x, p.y, tr);
        }
      } else if (roll < 17.5) {
        const p = place(5, 5);
        if (p) antenna(world, p.x + 2, p.y + 2, 5 + ((rnd() * 5) | 0), rnd() < 0.35);
      } else if (roll < 18.7) {
        const p = place(7, 7);
        if (p) dish(world, p.x, p.y);
      } else if (roll < 19.9) {
        const p = place(16, 12);
        if (p) solar(world, p.x, p.y, 2, 2);
      } else if (roll < 21.4) {
        const horizontal = rnd() < 0.5;
        const len = 10 + ((rnd() * 18) | 0);
        const p = horizontal ? place(len, 3) : place(3, len);
        if (p) pipeRun(world, p.x, p.y, len, horizontal);
      } else if (roll < 22.6) {
        const horizontal = rnd() < 0.5;
        const len = 12 + ((rnd() * 14) | 0);
        const p = horizontal ? place(len, 5) : place(5, len);
        if (p) duct(world, p.x, p.y, len, horizontal);
      } else if (roll < 23.1) {
        const p = place(5, 5);
        if (p) chimney(world, p.x, p.y);
      } else {
        const p = place(6, 6);
        if (p) hatch(world, p.x, p.y);
      }
    }
  }
  world.clipMap = null;
  world.curFlags = 0;
}

export { ROOF_CONCRETE, ROOF_MAROON, ROOF_OLIVE, ROOF_PLUM, ROOF_SLATE, ROOF_TEAL };
