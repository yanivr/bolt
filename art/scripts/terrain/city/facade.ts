import type { Canvas, Color } from '../canvas.js';
import { mixc } from '../canvas.js';
import { drawText, textWidth } from '../font.js';
import { FLOOR_0, FLOOR_N } from './layout.js';
import { NEON } from './neon.js';
import type { BuildingRamp } from './palette.js';
import {
  PAL,
  ROOF_CONCRETE,
  ROOF_MAROON,
  ROOF_OLIVE,
  ROOF_SLATE,
  ROOF_TEAL,
  TINT_WARM,
  darker,
  lighter,
} from './palette.js';
import { emissive } from './sprites.js';

/**
 * South facades. A facade is painted in its own rectangle, top row first: a cornice, upper
 * storeys of windows, and a ground floor that carries the street's character (shopfronts with
 * awnings and neon, lobbies, roller doors, stoops). Walls stay in shadow tones; lit glass and
 * tubes are the only bright things on them.
 */

export type FacadeKind = 'shop' | 'flats' | 'works' | 'office';

/** Light a facade throws onto the pavement at its foot, in facade coordinates. */
export type FacadeGlow = { x: number; reach: number; tint: number };

export type FacadeSpec = {
  kind: FacadeKind;
  family: number;
  floors: number;
  seed: number;
  /** Shop name for the fascia, or an empty string. */
  name: string;
  /** How busy the ground floor should be: 1 beside the track, lower in the back streets. */
  street: number;
};

/** Number of window bays across a facade, and the left edge of bay `k` from the wall's corner. */
export function facadeBays(
  w: number,
  kind: FacadeKind,
): { bays: number; x: (k: number) => number } {
  const bays = Math.max(1, Math.floor((w - 4) / (kind === 'office' ? 9 : 11)));
  return { bays, x: (k) => 2 + Math.floor((k * (w - 4)) / bays) };
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function wallTone(family: number, b: BuildingRamp, lx: number, ly: number, w: number): Color {
  switch (family) {
    case ROOF_MAROON: {
      // Brick: quiet courses, a joint here and there.
      if (ly % 3 === 2) return b.wallAlt;
      const row = Math.floor(ly / 3);
      return (lx + row * 4) % 8 === 0 ? b.wallAlt : b.wall;
    }
    case ROOF_TEAL:
      // Corrugated sheet.
      return lx % 3 === 2 ? b.wallAlt : b.wall;
    case ROOF_SLATE:
    case ROOF_CONCRETE:
      // Cast panels.
      return lx % 14 === 13 && lx < w - 3 ? b.wallAlt : b.wall;
    case ROOF_OLIVE:
      return ly % 5 === 4 ? b.wallAlt : b.wall;
    default:
      return b.wall;
  }
}

function litWindow(cv: Canvas, x: number, y: number, w: number, h: number, mode: number): void {
  emissive(cv, () => {
    if (mode === 2) {
      cv.rect(x, y, w, h, PAL.cyanDim);
      cv.set(x + 1, y + 1, PAL.cyan);
      cv.hline(x, y + h - 1, w, darker(PAL.cyanDim, 0.3));
      return;
    }
    cv.rect(x, y, w, h, PAL.windowMid);
    cv.hline(x, y, w, PAL.windowWarm);
    cv.vline(x, y, h - 1, PAL.windowWarm);
    if (mode === 1) cv.rect(x, y + h - 2, w, 2, PAL.windowDim);
    else if (w >= 4) cv.vline(x + (w >> 1), y + 1, h - 1, PAL.windowDim);
  });
}

function darkWindow(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, PAL.windowNight);
  cv.set(x + 1, y + 1, PAL.windowGlint);
  if (w >= 4 && h >= 4) cv.set(x + 2, y + 2, PAL.windowGlint);
}

function awning(cv: Canvas, x: number, y: number, w: number, a: Color, bcol: Color): void {
  for (let i = 0; i < w; i++) {
    const c = (Math.floor(i / 3) & 1) === 0 ? a : bcol;
    cv.set(x + i, y, lighter(c, 0.18));
    cv.set(x + i, y + 1, c);
    cv.set(x + i, y + 2, darker(c, 0.2));
    if (i % 3 !== 2) cv.set(x + i, y + 3, darker(c, 0.42));
  }
}

const AWNINGS: ReadonlyArray<readonly [Color, Color]> = [
  [PAL.kerbCoral, PAL.kerbIvory],
  [PAL.cyanDim, PAL.kerbIvory],
  [PAL.mintDim, PAL.kerbIvory],
  [PAL.purpleDim, PAL.kerbIvoryDark],
  [PAL.goldDim, PAL.ink],
];

/**
 * Paints a facade `w` wide and `r` tall with its top-left corner at (fx, fy). Returns the
 * pools of light it throws onto the ground at its foot.
 */
export function paintFacade(
  cv: Canvas,
  fx: number,
  fy: number,
  w: number,
  r: number,
  b: BuildingRamp,
  spec: FacadeSpec,
): FacadeGlow[] {
  const rnd = rng(spec.seed ^ 0x5f3a);
  const glows: FacadeGlow[] = [];
  const { family } = spec;
  // Wall, cornice, corners, plinth.
  for (let ly = 0; ly < r; ly++)
    for (let lx = 0; lx < w; lx++) cv.set(fx + lx, fy + ly, wallTone(family, b, lx, ly, w));
  cv.hline(fx, fy, w, b.trim);
  cv.hline(fx, fy + 1, w, b.line);
  cv.vline(fx, fy + 1, r - 1, mixc(b.wall, b.trim, 0.45));
  cv.vline(fx + w - 1, fy + 1, r - 1, b.line);
  cv.hline(fx, fy + r - 1, w, PAL.ink);
  cv.hline(fx + 1, fy + r - 2, w - 2, b.wallLow);

  const groundTop = fy + r - FLOOR_0;
  const upper = Math.max(0, Math.round((r - FLOOR_0 - 1) / FLOOR_N));
  const grid = facadeBays(w, spec.kind);
  const bays = grid.bays;
  const bayX = (k: number): number => fx + grid.x(k);
  const bayEnd = (k: number): number => fx + grid.x(k + 1);

  // --- Upper storeys --------------------------------------------------------------------
  for (let f = 0; f < upper; f++) {
    const y0 = fy + 2 + f * FLOOR_N;
    if (y0 + FLOOR_N > groundTop + 1) break;
    cv.hline(fx + 1, y0 + FLOOR_N - 1, w - 2, b.wallAlt);
    if (spec.kind === 'office') {
      // Ribbon glazing, lit in runs.
      const x0 = fx + 3;
      const span = w - 6;
      cv.rect(x0 - 1, y0 + 1, span + 2, 7, b.line);
      let lit = rnd() < 0.5;
      let run = 0;
      for (let i = 0; i < span; i++) {
        if (run-- <= 0) {
          lit = rnd() < 0.42;
          run = 4 + ((rnd() * 4) | 0) * 4;
        }
        const mull = i % 4 === 3;
        for (let j = 0; j < 5; j++) {
          if (mull) continue;
          if (lit) {
            emissive(cv, () =>
              cv.set(
                x0 + i,
                y0 + 2 + j,
                j === 0 ? PAL.windowWarm : j === 4 ? PAL.windowDim : PAL.windowMid,
              ),
            );
          } else
            cv.set(x0 + i, y0 + 2 + j, j === 1 && i % 4 === 1 ? PAL.windowGlint : PAL.windowNight);
        }
      }
      continue;
    }
    for (let k = 0; k < bays; k++) {
      const bw = bayEnd(k) - bayX(k);
      const ww = spec.kind === 'works' ? 4 : Math.min(6, bw - 4);
      if (ww < 3) continue;
      const wx = bayX(k) + ((bw - ww) >> 1);
      const wy = y0 + (spec.kind === 'works' ? 2 : 1);
      const wh = spec.kind === 'works' ? 4 : 6;
      cv.rect(wx - 1, wy - 1, ww + 2, wh + 2, b.line);
      const roll = rnd();
      if (roll < 0.36) litWindow(cv, wx, wy, ww, wh, roll < 0.1 ? 1 : 0);
      else if (roll < 0.41) litWindow(cv, wx, wy, ww, wh, 2);
      else darkWindow(cv, wx, wy, ww, wh);
      cv.hline(wx - 1, wy + wh + 1, ww + 2, b.trim);
      if (spec.kind === 'flats' && rnd() < 0.22 && bw >= 10) {
        // Balcony rail.
        cv.hline(wx - 2, wy + wh, ww + 4, PAL.steel);
        cv.hline(wx - 2, wy + wh + 1, ww + 4, PAL.steelDark);
      } else if (rnd() < 0.12) {
        // Window air conditioner.
        cv.rect(wx + 1, wy + wh, 4, 3, PAL.steel);
        cv.hline(wx + 1, wy + wh, 4, PAL.steelLight);
        cv.hline(wx + 1, wy + wh + 2, 4, PAL.steelDark);
      }
    }
  }
  // Drain pipe down one corner of taller buildings.
  if (upper >= 1 && spec.kind !== 'office' && rnd() < 0.6) {
    const px = rnd() < 0.5 ? fx + 1 : fx + w - 3;
    cv.vline(px, fy + 2, r - 3, b.line);
    cv.vline(px + 1, fy + 2, r - 3, mixc(b.wall, PAL.steel, 0.4));
  }

  // --- Ground floor ---------------------------------------------------------------------
  const gy = groundTop;
  const base = fy + r - 2;
  if (spec.kind === 'works') {
    const doorW = Math.min(18, w - 12);
    let x = fx + 4;
    while (x + doorW + 3 <= fx + w - 2) {
      const lit = rnd() < 0.25;
      cv.rect(x - 1, gy + 5, doorW + 2, base - gy - 4, b.line);
      for (let yy = gy + 6; yy <= base; yy++) {
        const c = lit
          ? yy < gy + 10
            ? PAL.steelDark
            : PAL.windowMid
          : (yy - gy) % 2 === 0
            ? PAL.steel
            : PAL.steelDark;
        if (lit && yy >= gy + 10)
          emissive(cv, () => cv.hline(x, yy, doorW, yy === gy + 10 ? PAL.windowWarm : c));
        else cv.hline(x, yy, doorW, c);
      }
      if (lit) glows.push({ x: x - fx + doorW / 2, reach: doorW * 0.6 + 6, tint: TINT_WARM });
      // Bay number and a bulkhead lamp.
      cv.rect(x + doorW - 5, gy + 1, 5, 3, PAL.paintGoldWorn);
      emissive(cv, () => cv.set(x + (doorW >> 1), gy + 3, PAL.lamp));
      x += doorW + 6 + ((rnd() * 3) | 0) * 4;
    }
    // A personnel door if there is room at the end.
    if (fx + w - x >= 8) {
      cv.rect(x, base - 9, 6, 10, b.line);
      cv.rect(x + 1, base - 8, 4, 9, PAL.steelDark);
      cv.set(x + 4, base - 4, PAL.steelLight);
    }
    return glows;
  }

  if (spec.kind === 'office') {
    // Glazed lobby under a slab canopy.
    const x0 = fx + 3;
    const span = w - 6;
    const lit = rnd() < 0.75;
    cv.rect(x0 - 1, gy + 6, span + 2, base - gy - 5, b.line);
    for (let i = 0; i < span; i++) {
      const mull = i % 6 === 5;
      for (let yy = gy + 7; yy <= base; yy++) {
        if (mull) continue;
        if (lit)
          emissive(cv, () =>
            cv.set(
              x0 + i,
              yy,
              yy === gy + 7 ? PAL.windowWarm : yy > base - 2 ? PAL.windowDim : PAL.windowMid,
            ),
          );
        else cv.set(x0 + i, yy, (i + yy) % 7 === 0 ? PAL.windowGlint : PAL.windowNight);
      }
    }
    const dx = fx + (w >> 1) - 4;
    cv.rect(dx, gy + 4, 9, 2, b.trim);
    cv.hline(dx, gy + 6, 9, b.line);
    cv.vline(dx + 4, gy + 8, base - gy - 7, b.line);
    if (lit) glows.push({ x: w / 2, reach: Math.min(40, span * 0.5 + 6), tint: TINT_WARM });
    return glows;
  }

  // Shops and flats share a doorway; shops glaze every other bay and hang a sign.
  const doorBay = (rnd() * bays) | 0;
  const shop = spec.kind === 'shop';
  const neon = NEON[(rnd() * NEON.length) | 0]!;
  const [stripeA, stripeB] = AWNINGS[(rnd() * AWNINGS.length) | 0]!;
  const warm = rnd() < 0.8;
  for (let k = 0; k < bays; k++) {
    const x0 = bayX(k);
    const bw = bayEnd(k) - x0;
    if (k === doorBay) {
      const dw = Math.min(7, bw - 2);
      const dx = x0 + ((bw - dw) >> 1);
      cv.rect(dx - 1, base - 10, dw + 2, 11, b.line);
      if (shop) {
        emissive(cv, () => {
          cv.rect(dx, base - 9, dw, 10, PAL.windowMid);
          cv.hline(dx, base - 9, dw, PAL.windowWarm);
          cv.vline(dx + (dw >> 1), base - 7, 8, PAL.windowDim);
        });
        glows.push({ x: dx - fx + dw / 2, reach: 12, tint: TINT_WARM });
      } else {
        cv.rect(dx, base - 9, dw, 10, family === ROOF_MAROON ? PAL.leafDark : PAL.woodDark);
        cv.vline(dx, base - 9, 10, family === ROOF_MAROON ? PAL.leaf : PAL.wood);
        cv.set(dx + dw - 2, base - 4, PAL.gold);
        emissive(cv, () => cv.hline(dx, base - 9, dw, PAL.windowMid));
        // Porch lamp.
        emissive(cv, () => cv.set(dx + dw + 1, base - 9, PAL.lamp));
        glows.push({ x: dx - fx + dw / 2, reach: 8, tint: TINT_WARM });
      }
      cv.hline(dx - 1, base + 1, dw + 2, PAL.kerb);
      continue;
    }
    if (shop) {
      const ww = bw - 2;
      if (ww < 5) continue;
      const wx = x0 + 1;
      cv.rect(wx - 1, gy + 10, ww + 2, base - gy - 9, b.line);
      emissive(cv, () => {
        const top = warm ? PAL.windowWarm : neon.hi;
        const mid = warm ? PAL.windowMid : neon.c;
        const low = warm ? PAL.windowDim : neon.dim;
        cv.rect(wx, gy + 11, ww, base - gy - 11, mid);
        cv.hline(wx, gy + 11, ww, top);
        cv.hline(wx, base - 1, ww, low);
        // Goods in the window, as silhouettes.
        for (let i = 1; i < ww - 1; i += 2)
          if (rnd() < 0.55) cv.vline(wx + i, base - 2 - ((rnd() * 2) | 0), 2, low);
      });
      cv.hline(wx, base, ww, b.wallLow);
      glows.push({ x: wx - fx + ww / 2, reach: ww * 0.5 + 7, tint: warm ? TINT_WARM : neon.tint });
    } else {
      const ww = Math.min(6, bw - 4);
      if (ww < 3) continue;
      const wx = x0 + ((bw - ww) >> 1);
      cv.rect(wx - 1, gy + 6, ww + 2, 8, b.line);
      if (rnd() < 0.34) litWindow(cv, wx, gy + 7, ww, 6, rnd() < 0.4 ? 1 : 0);
      else darkWindow(cv, wx, gy + 7, ww, 6);
      cv.hline(wx - 1, gy + 14, ww + 2, b.trim);
    }
  }
  if (shop) {
    // One awning across the glazed bays, and the name above it.
    if (rnd() < 0.8) {
      for (let k = 0; k < bays; k++) {
        if (k === doorBay && bays > 1) continue;
        awning(cv, bayX(k), gy + 7, bayEnd(k) - bayX(k), stripeA, stripeB);
      }
    }
    if (spec.name) {
      const tw = textWidth(spec.name, 'micro', 1);
      if (tw + 6 <= w - 4) {
        const sx = fx + ((w - tw - 6) >> 1);
        const top = Math.max(fy + 1, gy - 1);
        cv.rect(sx, top, tw + 6, 7, PAL.ink);
        cv.hline(sx, top, tw + 6, PAL.steelDark);
        emissive(cv, () => {
          drawText(cv, sx + 3, top + 1, spec.name, neon.c, 'micro', 1);
          cv.set(sx + 1, top + 3, neon.dim);
          cv.set(sx + tw + 4, top + 3, neon.dim);
        });
        glows.push({ x: sx - fx + (tw + 6) / 2, reach: tw * 0.5 + 12, tint: neon.tint });
      }
    }
    // A blade sign on the upper wall.
    if (upper >= 1 && w >= 30 && rnd() < 0.5) {
      const other = NEON[(NEON.indexOf(neon) + 1 + ((rnd() * 3) | 0)) % NEON.length]!;
      const bx = rnd() < 0.5 ? fx + 3 : fx + w - 6;
      const by = fy + 3;
      const bh = Math.min(11, groundTop - by - 4);
      if (bh >= 6) {
        cv.rect(bx, by, 3, bh, PAL.ink);
        emissive(cv, () => {
          for (let j = 1; j < bh - 1; j += 2) cv.set(bx + 1, by + j, other.c);
          cv.set(bx + 1, by + 1, other.hi);
        });
      }
    }
  } else if (spec.street > 0.5 && w >= 26 && rnd() < 0.3) {
    // A scrap of graffiti on a quiet wall.
    const gx = bayX((doorBay + 1) % bays) + 1;
    const c = NEON[(rnd() * NEON.length) | 0]!.dim;
    if (bays > 1) {
      cv.hline(gx, base - 1, 5, c);
      cv.set(gx + 1, base - 2, c);
      cv.set(gx + 3, base - 3, c);
      cv.set(gx + 4, base - 2, c);
    }
  }
  return glows;
}
