import { hash2 } from '@bolt/shared';
import { Canvas, mixc } from '../canvas.js';
import type { Color } from '../canvas.js';
import { drawText, textWidth } from '../font.js';
import { CORNICE, FLOOR_0, FLOOR_N } from './layout.js';
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
 * Walls. A south wall is painted upright in its own rectangle, top row first: a cornice with
 * some thickness, storeys of windows between piers, and where the wall stands on the ground a
 * street floor that carries the street's character (shopfronts under awnings, lobbies, roller
 * doors, stoops). The wall itself stays in shade tones; lit glass and tubes are the only bright
 * things on it. Things that stick out of the wall (awnings, balconies, air conditioners, fire
 * escapes) carry a hard shadow below them. West walls are painted by a texture function, since
 * they show as a narrow slanted strip.
 */

export type FacadeKind = 'shop' | 'flats' | 'works' | 'office';

/** Light a facade throws onto the pavement at its foot, in facade coordinates. */
export type FacadeGlow = { x: number; reach: number; tint: number };

/** An upright board to hang on the finished wall. (x, y) is its top-left corner on the wall. */
export type FacadeDecal = { x: number; y: number; art: Canvas };

export type FacadeSpec = {
  kind: FacadeKind;
  family: number;
  seed: number;
  /** True when the wall stands on the ground and has a street floor. */
  ground: boolean;
  /** Shop name for the fascia, or an empty string. */
  name: string;
  /** How busy the ground floor should be: 1 beside the track, lower in the back streets. */
  street: number;
};

export type FacadeResult = { glows: FacadeGlow[]; decals: FacadeDecal[] };

/** Number of window bays across a facade, and the left edge of bay `k` from the wall's corner. */
export function facadeBays(
  w: number,
  kind: FacadeKind,
): { bays: number; x: (k: number) => number } {
  const bays = Math.max(1, Math.floor((w - 4) / (kind === 'office' ? 10 : 12)));
  return { bays, x: (k) => 2 + Math.floor((k * (w - 4)) / bays) };
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function wallTone(family: number, b: BuildingRamp, lx: number, ly: number): Color {
  switch (family) {
    case ROOF_MAROON: {
      // Brick: quiet courses, a joint here and there.
      if (ly % 4 === 3) return b.wallAlt;
      const row = Math.floor(ly / 4);
      return (lx + row * 5) % 10 === 0 ? b.wallAlt : b.wall;
    }
    case ROOF_TEAL:
      // Corrugated sheet.
      return lx % 3 === 2 ? b.wallAlt : b.wall;
    case ROOF_SLATE:
    case ROOF_CONCRETE:
      // Cast panels.
      return ly % FLOOR_N === CORNICE - 1 ? b.wallAlt : b.wall;
    case ROOF_OLIVE:
      return ly % 6 === 5 ? b.wallAlt : b.wall;
    default:
      return b.wall;
  }
}

function litWindow(cv: Canvas, x: number, y: number, w: number, h: number, mode: number): void {
  emissive(cv, () => {
    if (mode === 2) {
      cv.rect(x, y, w, h, PAL.cyanDim);
      cv.rect(x + 1, y + 1, 2, 2, PAL.cyan);
      cv.hline(x, y + h - 1, w, darker(PAL.cyanDim, 0.3));
      return;
    }
    cv.rect(x, y, w, h, PAL.windowMid);
    cv.hline(x, y, w, PAL.windowWarm);
    cv.vline(x, y, h - 1, PAL.windowWarm);
    if (mode === 1) cv.rect(x, y + h - 3, w, 3, PAL.windowDim);
    else if (mode === 3) cv.rect(x + (w >> 1), y + 1, w - (w >> 1), h - 1, PAL.windowDim);
    else if (w >= 4) cv.vline(x + (w >> 1), y + 1, h - 1, PAL.windowDim);
    if (h >= 6) cv.hline(x, y + (h >> 1), w, PAL.windowDim);
  });
}

function darkWindow(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, PAL.windowNight);
  cv.set(x + 1, y + 1, PAL.windowGlint);
  if (w >= 4 && h >= 4) cv.set(x + 2, y + 2, PAL.windowGlint);
  if (w >= 5 && h >= 6) cv.set(x + 1, y + 2, PAL.windowGlint);
}

/** Canvas awning that sticks out over the pavement, with the shade it throws on the glass. */
function awning(cv: Canvas, x: number, y: number, w: number, a: Color, bcol: Color): void {
  for (let i = 0; i < w; i++) {
    const c = (Math.floor(i / 3) & 1) === 0 ? a : bcol;
    cv.set(x + i, y, lighter(c, 0.22));
    cv.set(x + i, y + 1, c);
    cv.set(x + i, y + 2, c);
    cv.set(x + i, y + 3, darker(c, 0.22));
    if (i % 3 !== 2) cv.set(x + i, y + 4, darker(c, 0.45));
  }
  cv.mapRect(x + 1, y + 5, w, 2, (c) => darker(c, 0.42));
}

const AWNINGS: ReadonlyArray<readonly [Color, Color]> = [
  [PAL.kerbCoral, PAL.kerbIvory],
  [PAL.cyanDim, PAL.kerbIvory],
  [PAL.mintDim, PAL.kerbIvory],
  [PAL.purpleDim, PAL.kerbIvoryDark],
  [PAL.goldDim, PAL.ink],
];

/** Steel fire escape: a landing at every storey, stairs zigzagging between them. */
function fireEscape(cv: Canvas, x: number, y0: number, floors: number, drop: boolean): void {
  const wide = 13;
  for (let f = 0; f < floors; f++) {
    const ly = y0 + f * FLOOR_N + FLOOR_N - 2;
    // The shade under the landing first, so the steel sits on top of it.
    cv.mapRect(x + 1, ly + 2, wide, 2, (c) => darker(c, 0.4));
    cv.hline(x, ly, wide, PAL.steelLight);
    cv.hline(x, ly + 1, wide, PAL.steelDark);
    // Railing.
    cv.hline(x, ly - 4, wide, PAL.steel);
    for (let k = 0; k < wide; k += 3) cv.vline(x + k, ly - 4, 4, PAL.steelDark);
    cv.vline(x, ly - 4, 5, PAL.steelLight);
    if (f + 1 < floors || drop) {
      // Stair down to the next landing.
      const dir = f % 2 === 0 ? 1 : -1;
      const sx = dir > 0 ? x + 2 : x + wide - 3;
      for (let k = 0; k < FLOOR_N - 2; k++) {
        const px = sx + dir * Math.round((k * (wide - 5)) / (FLOOR_N - 3));
        cv.set(px, ly + 2 + k, PAL.steel);
        cv.set(px + dir, ly + 2 + k, PAL.steelDark);
      }
    }
  }
}

/**
 * Paints a wall `w` wide and `rows` tall into `cv` at (0, 0). Returns the pools of light it
 * throws onto the ground at its foot and the upright boards to hang on it.
 */
export function paintFacade(
  cv: Canvas,
  w: number,
  rows: number,
  b: BuildingRamp,
  spec: FacadeSpec,
): FacadeResult {
  const rnd = rng(spec.seed ^ 0x5f3a);
  const glows: FacadeGlow[] = [];
  const decals: FacadeDecal[] = [];
  const { family } = spec;
  const fx = 0;
  const fy = 0;
  const r = rows;
  // Wall, cornice, corners, plinth.
  for (let ly = 0; ly < r; ly++)
    for (let lx = 0; lx < w; lx++) cv.set(lx, ly, wallTone(family, b, lx, ly));
  // The corner toward the light is a crisp bright edge; the far one falls into the dark.
  cv.vline(0, 0, r, b.edge);
  cv.vline(1, CORNICE, r - CORNICE, b.pier);
  cv.vline(w - 1, 0, r, b.line);
  cv.vline(w - 2, CORNICE, r - CORNICE, b.wallAlt);
  // Cornice: a lit lip, its face, and the hard shadow it throws down the wall.
  cv.hline(0, 0, w, b.rimLow);
  cv.hline(0, 1, w, b.trim);
  cv.hline(1, 2, w - 1, b.deep);
  cv.hline(2, 3, w - 3, b.wallLow);
  cv.set(0, 0, b.rim);

  const groundRows = spec.ground ? FLOOR_0 : 0;
  const groundTop = r - groundRows;
  // A wall that starts on a lower roof may show the top of one more storey.
  const upper = Math.max(0, Math.floor((groundTop - CORNICE + (spec.ground ? 0 : 3)) / FLOOR_N));
  const grid = facadeBays(w, spec.kind);
  const bays = grid.bays;
  const bayX = (k: number): number => fx + grid.x(k);
  const bayEnd = (k: number): number => fx + grid.x(k + 1);

  // Piers between groups of bays give the wall depth and a rhythm.
  const pierEvery =
    spec.kind === 'office' ? 0 : bays >= 5 ? 2 : bays >= 3 ? (rnd() < 0.5 ? 1 : 0) : 0;
  if (pierEvery > 0 && upper >= 1) {
    for (let k = pierEvery; k < bays; k += pierEvery) {
      const px = bayX(k) - 1;
      cv.vline(px, CORNICE, groundTop - CORNICE, b.pier);
      cv.vline(px + 1, CORNICE, groundTop - CORNICE, b.line);
    }
  }

  // --- Upper storeys --------------------------------------------------------------------
  const escape =
    spec.kind === 'flats' && upper >= 2 && bays >= 3 && rnd() < 0.45
      ? 1 + ((rnd() * (bays - 2)) | 0)
      : -1;
  for (let f = 0; f < upper; f++) {
    const y0 = fy + CORNICE + f * FLOOR_N;
    // String course at the foot of the storey.
    cv.hline(fx + 2, y0 + FLOOR_N - 1, w - 4, b.wallAlt);
    if (spec.kind === 'office') {
      // Ribbon glazing, lit in runs, with a spandrel band below.
      const x0 = fx + 3;
      const span = w - 6;
      cv.rect(x0 - 1, y0 + 1, span + 2, 9, b.line);
      cv.hline(x0 - 1, y0 + 10, span + 2, b.pier);
      let lit = rnd() < 0.5;
      let run = 0;
      for (let i = 0; i < span; i++) {
        if (run-- <= 0) {
          lit = rnd() < 0.4;
          run = 4 + ((rnd() * 4) | 0) * 5;
        }
        const mull = i % 5 === 4;
        for (let j = 0; j < 7; j++) {
          if (mull) continue;
          if (lit) {
            emissive(cv, () =>
              cv.set(
                x0 + i,
                y0 + 2 + j,
                j === 0 ? PAL.windowWarm : j >= 5 ? PAL.windowDim : PAL.windowMid,
              ),
            );
          } else
            cv.set(x0 + i, y0 + 2 + j, j === 1 && i % 5 === 1 ? PAL.windowGlint : PAL.windowNight);
        }
      }
      continue;
    }
    for (let k = 0; k < bays; k++) {
      const bw = bayEnd(k) - bayX(k);
      const works = spec.kind === 'works';
      const ww = works ? Math.min(8, bw - 4) : Math.min(6, bw - 5);
      if (ww < 3) continue;
      const wx = bayX(k) + ((bw - ww) >> 1);
      const wy = y0 + (works ? 3 : 2);
      const wh = works ? 4 : 7;
      cv.rect(wx - 1, wy - 1, ww + 2, wh + 2, b.line);
      const roll = rnd();
      if (roll < 0.34) litWindow(cv, wx, wy, ww, wh, roll < 0.08 ? 1 : roll < 0.14 ? 3 : 0);
      else if (roll < 0.39) litWindow(cv, wx, wy, ww, wh, 2);
      else darkWindow(cv, wx, wy, ww, wh);
      // Lintel in shade above, a lit sill below.
      cv.hline(wx - 1, wy - 1, ww + 2, b.deep);
      cv.hline(wx - 1, wy + wh, ww + 2, b.trim);
      if (k === escape) continue;
      const extra = rnd();
      if (spec.kind === 'flats' && extra < 0.2 && bw >= 11) {
        // Balcony: a slab and rail that stand proud of the wall and shade what is under them.
        cv.mapRect(wx - 2, wy + wh + 2, ww + 5, 2, (c) => darker(c, 0.42));
        cv.hline(wx - 3, wy + wh, ww + 6, PAL.steelLight);
        cv.hline(wx - 3, wy + wh + 1, ww + 6, PAL.steelDark);
        cv.hline(wx - 3, wy + wh - 3, ww + 6, PAL.steel);
        for (let i = -3; i < ww + 3; i += 2) cv.vline(wx + i, wy + wh - 3, 3, PAL.steelDark);
        cv.vline(wx - 3, wy + wh - 3, 4, PAL.steelLight);
      } else if (extra > 0.86 && !works) {
        // Window air conditioner, with its own small shadow.
        cv.mapRect(wx + 2, wy + wh + 2, 5, 2, (c) => darker(c, 0.42));
        cv.rect(wx + 1, wy + wh - 1, 5, 3, PAL.steel);
        cv.hline(wx + 1, wy + wh - 1, 5, PAL.steelLight);
        cv.hline(wx + 1, wy + wh + 1, 5, PAL.steelDark);
        cv.set(wx + 1, wy + wh, PAL.steelHi);
      }
    }
  }
  if (escape >= 0) fireEscape(cv, bayX(escape) - 1, fy + CORNICE, upper, spec.ground);
  // Drain pipe down one corner of taller buildings.
  if (upper >= 1 && spec.kind !== 'office' && rnd() < 0.6) {
    const px = rnd() < 0.5 ? fx + 3 : fx + w - 5;
    cv.vline(px, fy + 3, r - 4, mixc(b.wall, PAL.steel, 0.5));
    cv.vline(px + 1, fy + 3, r - 4, b.deep);
    for (let y = fy + 9; y < r - 4; y += FLOOR_N) cv.set(px, y, PAL.steelLight);
  }
  if (!spec.ground) {
    cv.hline(0, r - 1, w, b.wallLow);
    return { glows, decals };
  }
  // Plinth and the contact line with the ground.
  cv.hline(fx, fy + r - 1, w, PAL.ink);
  cv.hline(fx + 1, fy + r - 2, w - 2, b.wallLow);

  // --- Ground floor ---------------------------------------------------------------------
  const gy = groundTop;
  const base = fy + r - 2;
  // A band course separates the street floor from the storeys above.
  if (upper >= 1) {
    cv.hline(fx + 1, gy, w - 2, b.trim);
    cv.hline(fx + 1, gy + 1, w - 2, b.deep);
  }
  if (spec.kind === 'works') {
    const doorW = Math.min(20, w - 12);
    let x = fx + 5;
    while (x + doorW + 3 <= fx + w - 2) {
      const lit = rnd() < 0.3;
      cv.rect(x - 1, gy + 4, doorW + 2, base - gy - 3, b.deep);
      for (let yy = gy + 5; yy <= base; yy++) {
        const c = lit
          ? yy < gy + 9
            ? PAL.steelDark
            : PAL.windowMid
          : (yy - gy) % 2 === 0
            ? PAL.steel
            : PAL.steelDark;
        if (lit && yy >= gy + 9)
          emissive(cv, () => cv.hline(x, yy, doorW, yy === gy + 9 ? PAL.windowWarm : c));
        else cv.hline(x, yy, doorW, c);
      }
      if (lit) glows.push({ x: x - fx + doorW / 2, reach: doorW * 0.6 + 6, tint: TINT_WARM });
      // Bay number and a bulkhead lamp.
      cv.rect(x + doorW - 5, gy + 1, 5, 2, PAL.paintGoldWorn);
      emissive(cv, () => cv.set(x + (doorW >> 1), gy + 3, PAL.lamp));
      x += doorW + 6 + ((rnd() * 3) | 0) * 4;
    }
    // A personnel door if there is room at the end.
    if (fx + w - x >= 9) {
      cv.rect(x, base - 10, 6, 11, b.deep);
      cv.rect(x + 1, base - 9, 4, 10, PAL.steelDark);
      cv.set(x + 4, base - 4, PAL.steelLight);
    }
    return { glows, decals };
  }

  if (spec.kind === 'office') {
    // Glazed lobby under a slab canopy.
    const x0 = fx + 4;
    const span = w - 8;
    const lit = rnd() < 0.75;
    cv.rect(x0 - 1, gy + 6, span + 2, base - gy - 5, b.deep);
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
    // Canopy slab over the doors, and the doors themselves.
    const dx = fx + (w >> 1) - 7;
    cv.mapRect(dx + 1, gy + 7, 15, 2, (c) => darker(c, 0.4));
    cv.rect(dx, gy + 4, 15, 3, b.trim);
    cv.hline(dx, gy + 4, 15, b.rimLow);
    cv.hline(dx, gy + 6, 15, b.deep);
    cv.vline(dx + 7, gy + 9, base - gy - 8, b.deep);
    if (lit) glows.push({ x: w / 2, reach: Math.min(40, span * 0.5 + 6), tint: TINT_WARM });
    return { glows, decals };
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
      cv.rect(dx - 1, base - 11, dw + 2, 12, b.deep);
      if (shop) {
        emissive(cv, () => {
          cv.rect(dx, base - 10, dw, 11, PAL.windowMid);
          cv.hline(dx, base - 10, dw, PAL.windowWarm);
          cv.vline(dx + (dw >> 1), base - 8, 9, PAL.windowDim);
        });
        glows.push({ x: dx - fx + dw / 2, reach: 12, tint: TINT_WARM });
      } else {
        cv.rect(dx, base - 10, dw, 11, family === ROOF_MAROON ? PAL.leafDark : PAL.woodDark);
        cv.vline(dx, base - 10, 11, family === ROOF_MAROON ? PAL.leaf : PAL.wood);
        cv.set(dx + dw - 2, base - 4, PAL.gold);
        emissive(cv, () => cv.hline(dx, base - 10, dw, PAL.windowMid));
        // Porch lamp, and a step.
        emissive(cv, () => cv.set(dx + dw + 1, base - 10, PAL.lamp));
        glows.push({ x: dx - fx + dw / 2, reach: 8, tint: TINT_WARM });
      }
      cv.hline(dx - 1, base + 1, dw + 2, PAL.kerb);
      continue;
    }
    if (shop) {
      const ww = bw - 2;
      if (ww < 5) continue;
      const wx = x0 + 1;
      cv.rect(wx - 1, gy + 9, ww + 2, base - gy - 8, b.deep);
      emissive(cv, () => {
        const top = warm ? PAL.windowWarm : neon.hi;
        const mid = warm ? PAL.windowMid : neon.c;
        const low = warm ? PAL.windowDim : neon.dim;
        cv.rect(wx, gy + 10, ww, base - gy - 10, mid);
        cv.hline(wx, gy + 10, ww, top);
        cv.hline(wx, base - 1, ww, low);
        // Goods in the window, as silhouettes.
        for (let i = 1; i < ww - 1; i += 2)
          if (rnd() < 0.55) cv.vline(wx + i, base - 3 - ((rnd() * 2) | 0), 3, low);
      });
      cv.hline(wx, base, ww, b.wallLow);
      glows.push({ x: wx - fx + ww / 2, reach: ww * 0.5 + 7, tint: warm ? TINT_WARM : neon.tint });
    } else {
      const ww = Math.min(6, bw - 5);
      if (ww < 3) continue;
      const wx = x0 + ((bw - ww) >> 1);
      cv.rect(wx - 1, gy + 4, ww + 2, 9, b.line);
      if (rnd() < 0.34) litWindow(cv, wx, gy + 5, ww, 7, rnd() < 0.4 ? 1 : 0);
      else darkWindow(cv, wx, gy + 5, ww, 7);
      cv.hline(wx - 1, gy + 4, ww + 2, b.deep);
      cv.hline(wx - 1, gy + 12, ww + 2, b.trim);
    }
  }
  if (shop) {
    // One awning across the glazed bays, and the name above it.
    if (rnd() < 0.82) {
      for (let k = 0; k < bays; k++) {
        if (k === doorBay && bays > 1) continue;
        awning(cv, bayX(k), gy + 7, bayEnd(k) - bayX(k), stripeA, stripeB);
      }
    }
    if (spec.name) {
      const tw = textWidth(spec.name, 'micro', 1);
      if (tw + 6 <= w - 4) {
        const board = Canvas.sprite(tw + 6, 7);
        board.rect(0, 0, tw + 6, 7, PAL.ink);
        board.hline(0, 0, tw + 6, PAL.steelDark);
        emissive(board, () => {
          drawText(board, 3, 1, spec.name, neon.c, 'micro', 1);
          board.set(1, 3, neon.dim);
          board.set(tw + 4, 3, neon.dim);
        });
        const sx = (w - tw - 6) >> 1;
        decals.push({ x: sx, y: Math.max(1, gy - 1), art: board });
        glows.push({ x: sx + (tw + 6) / 2, reach: tw * 0.5 + 12, tint: neon.tint });
      }
    }
    // A blade sign on the upper wall.
    if (upper >= 1 && w >= 30 && rnd() < 0.5) {
      const other = NEON[(NEON.indexOf(neon) + 1 + ((rnd() * 3) | 0)) % NEON.length]!;
      const bh = Math.min(13, groundTop - CORNICE - 6);
      if (bh >= 6) {
        const blade = Canvas.sprite(4, bh);
        blade.rect(0, 0, 3, bh, PAL.ink);
        blade.vline(3, 1, bh - 1, PAL.inkSoft);
        emissive(blade, () => {
          for (let j = 1; j < bh - 1; j += 2) blade.set(1, j, other.c);
          blade.set(1, 1, other.hi);
        });
        decals.push({ x: rnd() < 0.5 ? 4 : w - 8, y: CORNICE + 3, art: blade });
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
  return { glows, decals };
}

/**
 * Texture of a west wall `rise` rows tall: the color `v` rows above the ground, `u` pixels
 * south of the wall's north corner. The wall faces the light, so it is a clear step brighter
 * than the south wall; its windows show as short slanted slots. A negative result is self-lit.
 */
export function westWall(
  b: BuildingRamp,
  rise: number,
  ground: boolean,
  seed: number,
  windows: boolean,
): (u: number, v: number) => number {
  const top = rise - CORNICE - 1;
  return (u, v) => {
    if (v <= 1) return b.westLine;
    const fromTop = top - v;
    if (fromTop < 0) return b.rimLow;
    if (ground && v < FLOOR_0) {
      // Street floor: a service door now and then, otherwise plain wall over a plinth.
      const bay = Math.floor(u / 22);
      const within = u - bay * 22;
      if (within >= 8 && within < 14 && v < 13 && hash2(bay, 7, seed) < 0.3) return b.wallLow;
      return v >= FLOOR_0 - 2 ? b.westLine : b.westAlt;
    }
    const within = fromTop % FLOOR_N;
    const floor = Math.floor(fromTop / FLOOR_N);
    if (!windows) return within === FLOOR_N - 1 ? b.westAlt : b.west;
    const bay = Math.floor(u / 11);
    const wu = u - bay * 11;
    if (within >= 3 && within <= 8 && wu >= 3 && wu < 8) {
      const roll = hash2(bay, floor, seed);
      if (roll < 0.26) return -(wu === 3 ? PAL.windowWarm : PAL.windowMid);
      if (roll < 0.3) return -PAL.cyanDim;
      return wu === 3 ? PAL.windowGlint : PAL.windowNight;
    }
    if (within >= 3 && within <= 8 && (wu === 2 || wu === 8)) return b.westLine;
    return b.west;
  };
}
