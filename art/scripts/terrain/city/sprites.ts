import { Canvas, F_EMISSIVE } from '../canvas.js';
import type { Color } from '../canvas.js';
import type { Sprite } from '../oblique.js';
import { PAL, darker, lighter } from './palette.js';

/**
 * Standing sprites shared by the street, ground and landmark painters. Everything is drawn
 * upright as seen from the south: a lit top, a south face in shadow tones, light from the upper
 * left. The anchor is the pixel that stands on the ground.
 */

export function emissive(cv: Canvas, fn: () => void): void {
  const prev = cv.curFlags;
  cv.curFlags = F_EMISSIVE;
  fn();
  cv.curFlags = prev;
}

/** A plain box: lit top with a bright north-west rim, darker south face, dark foot. */
export function drawBox(
  cv: Canvas,
  x: number,
  y: number,
  w: number,
  d: number,
  r: number,
  top: Color,
  face: Color,
): void {
  cv.rect(x, y, w, d, top);
  cv.hline(x, y, w, lighter(top, 0.25));
  cv.vline(x, y, d, lighter(top, 0.18));
  cv.vline(x + w - 1, y, d, darker(top, 0.18));
  cv.rect(x, y + d, w, r, face);
  cv.vline(x + w - 1, y + d, r, darker(face, 0.25));
  cv.hline(x, y + d + r - 1, w, darker(face, 0.4));
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Street or park tree: a short trunk under a round canopy of clustered leaves. */
export function treeSprite(r: number, seed: number, warm = false): Sprite {
  const trunk = Math.max(3, Math.round(r * 0.6));
  const w = 2 * r + 3;
  const h = 2 * r + 2 + trunk;
  const cv = Canvas.sprite(w, h);
  const cx = r + 1;
  const cy = r + 1;
  cv.rect(cx - 1, cy + r - 2, 2, trunk + 3, PAL.woodDark);
  cv.vline(cx - 1, cy + r - 2, trunk + 2, PAL.wood);
  const mid = warm ? PAL.leafLight : PAL.leaf;
  const light = warm ? PAL.leafHi : PAL.leafLight;
  cv.disc(cx, cy, r, PAL.leafDeep);
  cv.disc(cx - 0.3, cy - 0.5, r - 1, PAL.leafDark);
  cv.disc(cx - r * 0.22, cy - r * 0.3, r * 0.64, mid);
  const next = lcg(seed);
  const clumps = Math.max(3, Math.round(r * 1.1));
  for (let k = 0; k < clumps; k++) {
    const a = next() * Math.PI * 2;
    const dist = next() * r * 0.7;
    const px = cx + Math.cos(a) * dist - r * 0.12;
    const py = cy + Math.sin(a) * dist - r * 0.15;
    const lit = px - cx + (py - cy) * 1.4 < 0;
    cv.disc(Math.round(px), Math.round(py), r > 6 ? 1.3 : 0.6, lit ? light : PAL.leafDark);
  }
  // The underside of the canopy falls into shadow.
  for (let yy = Math.round(cy + r * 0.45); yy <= cy + r; yy++) {
    for (let xx = 0; xx < w; xx++) {
      if (cv.alpha(xx, yy) === 0) continue;
      const c = cv.get(xx, yy);
      if (c === mid || c === light) cv.set(xx, yy, PAL.leafDark);
      else if (c === PAL.leafDark && yy > cy + r * 0.7) cv.set(xx, yy, PAL.leafDeep);
    }
  }
  if (r >= 4)
    cv.set(Math.round(cx - r * 0.4), Math.round(cy - r * 0.55), warm ? PAL.leafHi : light);
  return { art: cv, ax: cx, ay: h - 1 };
}

/** Low clipped shrub for planters and hedges. */
export function shrubSprite(w: number, seed: number): Sprite {
  const cv = Canvas.sprite(w, 6);
  const next = lcg(seed);
  for (let x = 0; x < w; x++) {
    const top = x === 0 || x === w - 1 ? 1 : next() < 0.3 ? 1 : 0;
    for (let y = top; y < 6; y++) {
      const c =
        y <= top + 1
          ? next() < 0.35
            ? PAL.leafLight
            : PAL.leaf
          : y < 5
            ? PAL.leafDark
            : PAL.leafDeep;
      cv.set(x, y, c);
    }
  }
  return { art: cv, ax: w >> 1, ay: 5 };
}

function glow(cv: Canvas, x: number, y: number, w: number, h: number, c: Color): void {
  for (let yy = -2; yy < h + 2; yy++) {
    for (let xx = -2; xx < w + 2; xx++) {
      const ox = xx < 0 ? -xx : xx >= w ? xx - w + 1 : 0;
      const oy = yy < 0 ? -yy : yy >= h ? yy - h + 1 : 0;
      if (ox + oy === 0 || ox + oy > 2) continue;
      cv.halo(x + xx, y + yy, c, ox + oy === 1 ? 120 : 60);
    }
  }
}

function lampHeadOn(cv: Canvas, x: number, y: number): void {
  glow(cv, x, y, 4, 2, PAL.lampGlow);
  emissive(cv, () => {
    cv.rect(x, y, 4, 2, PAL.lampGlow);
    cv.rect(x + 1, y, 2, 2, PAL.lamp);
    cv.set(x + 1, y, PAL.ivory);
  });
}

export const LAMP_RISE = 18;

/** Twin-headed street lamp for east-west roads: a pole with a head on either side. */
export function lampTwin(): Sprite {
  const cv = Canvas.sprite(17, LAMP_RISE + 4);
  const px = 8;
  cv.vline(px, 4, LAMP_RISE - 1, PAL.steelLight);
  cv.vline(px + 1, 4, LAMP_RISE - 1, PAL.steelDark);
  cv.rect(px - 1, LAMP_RISE + 1, 4, 3, PAL.steelDark);
  cv.hline(px - 1, LAMP_RISE + 1, 4, PAL.steel);
  cv.hline(3, 3, 12, PAL.steelDark);
  cv.hline(3, 2, 12, PAL.steel);
  cv.rect(px - 1, 1, 4, 3, PAL.steelDark);
  cv.set(px, 1, PAL.steelHi);
  lampHeadOn(cv, 1, 4);
  lampHeadOn(cv, 12, 4);
  return { art: cv, ax: px, ay: LAMP_RISE + 3 };
}

/** Pole of a single-arm lamp, and the arm with its head reaching `dir` (-1 west, 1 east). */
export function lampPole(): Sprite {
  const cv = Canvas.sprite(4, LAMP_RISE + 2);
  cv.vline(1, 0, LAMP_RISE, PAL.steelLight);
  cv.vline(2, 0, LAMP_RISE, PAL.steelDark);
  cv.rect(0, LAMP_RISE - 1, 4, 3, PAL.steelDark);
  cv.hline(0, LAMP_RISE - 1, 4, PAL.steel);
  return { art: cv, ax: 1, ay: LAMP_RISE + 1 };
}

export const LAMP_ARM = 9;

export function lampArm(dir: number): Sprite {
  const cv = Canvas.sprite(LAMP_ARM + 6, 8);
  const x0 = dir > 0 ? 2 : LAMP_ARM + 3;
  for (let k = 0; k <= LAMP_ARM; k++) {
    cv.set(x0 + dir * k, 2, PAL.steel);
    cv.set(x0 + dir * k, 3, PAL.steelDark);
  }
  cv.rect(x0 - 1, 1, 3, 3, PAL.steelDark);
  cv.set(x0, 1, PAL.steelHi);
  lampHeadOn(cv, dir > 0 ? x0 + LAMP_ARM - 3 : x0 - LAMP_ARM, 4);
  return { art: cv, ax: x0, ay: 3 };
}

/** Small post-top lantern for parks, plazas and quays. */
export function lantern(tint: Color = PAL.lamp, glowC: Color = PAL.lampGlow): Sprite {
  const cv = Canvas.sprite(7, 13);
  cv.vline(3, 5, 7, PAL.steel);
  cv.set(3, 12, PAL.steelDark);
  cv.set(2, 12, PAL.steelDark);
  cv.set(4, 12, PAL.steelDark);
  glow(cv, 2, 2, 3, 3, glowC);
  cv.hline(2, 1, 3, PAL.steelDark);
  emissive(cv, () => {
    cv.rect(2, 2, 3, 3, glowC);
    cv.set(3, 2, tint);
    cv.set(3, 3, PAL.ivory);
  });
  return { art: cv, ax: 3, ay: 12 };
}

function fromRows(rows: readonly string[], pal: Readonly<Record<string, Color>>): Canvas {
  let w = 0;
  for (const r of rows) w = Math.max(w, r.length);
  const cv = Canvas.sprite(w, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = pal[row[x]!];
      if (c !== undefined) cv.set(x, y, c);
    }
  });
  return cv;
}

export function bollardSprite(gold = false): Sprite {
  const pal = gold
    ? { h: PAL.goldHi, g: PAL.gold, d: PAL.goldDim, c: PAL.coral, o: PAL.ink }
    : { h: PAL.steelHi, g: PAL.steel, d: PAL.steelDark, c: PAL.paintGold, o: PAL.ink };
  const rows = gold
    ? ['.hgg.', 'hgggd', 'ogddo', 'oggdo', 'occdo', 'oggdo', 'oggdo', 'oggdo', '.ooo.']
    : ['.hg.', 'hggd', 'ogdo', 'occo', 'ogdo', 'ogdo', '.oo.'];
  const art = fromRows(rows, pal);
  return { art, ax: art.w >> 1, ay: art.h - 1 };
}

export function hydrantSprite(): Sprite {
  const art = fromRows(['.hr.', 'hrrd', '.rd.', 'rrrd', '.rd.', '.rd.', 'oddo'], {
    h: PAL.coralHi,
    r: PAL.coral,
    d: PAL.coralDim,
    o: PAL.ink,
  });
  return { art, ax: 1, ay: 6 };
}

export function binSprite(): Sprite {
  const art = fromRows(['slls.', 'smmmd', '.gggd', '.gGgd', '.gggd', '.gggd', '.oooo'], {
    s: PAL.steel,
    l: PAL.steelLight,
    m: PAL.steelDark,
    g: PAL.mintDim,
    G: PAL.mint,
    d: PAL.leafDeep,
    o: PAL.ink,
  });
  return { art, ax: 2, ay: 6 };
}

export function benchSprite(): Sprite {
  const art = fromRows(
    ['LLLLLLLLLLL', 'wwwwwwwwwww', 'd.........d', 'LLLLLLLLLLL', 'wwwwwwwwwww', 'o.o.....o.o'],
    { L: PAL.woodLight, w: PAL.wood, d: PAL.woodDark, o: PAL.ink },
  );
  return { art, ax: 5, ay: 5 };
}

export function newsBoxes(): Sprite {
  const cv = Canvas.sprite(14, 7);
  const colors: ReadonlyArray<readonly [Color, Color]> = [
    [PAL.cyan, PAL.cyanDim],
    [PAL.coralHi, PAL.coral],
    [PAL.gold, PAL.goldDim],
  ];
  colors.forEach(([hi, c], k) => {
    const x = k * 5;
    cv.rect(x, 0, 4, 2, hi);
    cv.rect(x, 2, 4, 4, c);
    cv.set(x + 1, 3, PAL.ivory);
    cv.set(x + 2, 3, PAL.ivory);
    cv.hline(x, 6, 4, PAL.ink);
    cv.vline(x + 3, 2, 4, darker(c, 0.3));
  });
  return { art: cv, ax: 7, ay: 6 };
}

export function planterSprite(seed: number, wide = 11): Sprite {
  const cv = Canvas.sprite(wide, 10);
  const shrub = shrubSprite(wide - 2, seed).art;
  cv.blit(shrub, 1, 0);
  cv.rect(0, 4, wide, 2, PAL.kerb);
  cv.hline(0, 4, wide, PAL.kerbHi);
  cv.rect(0, 6, wide, 4, PAL.kerbShade);
  cv.hline(0, 9, wide, PAL.ink);
  cv.vline(wide - 1, 5, 4, darker(PAL.kerbShade, 0.3));
  return { art: cv, ax: wide >> 1, ay: 9 };
}

export function dumpsterSprite(c: Color): Sprite {
  const cv = Canvas.sprite(15, 11);
  cv.rect(0, 0, 15, 4, lighter(c, 0.12));
  cv.hline(0, 0, 15, lighter(c, 0.35));
  cv.hline(0, 3, 15, darker(c, 0.5));
  cv.vline(7, 0, 3, darker(c, 0.3));
  cv.rect(0, 4, 15, 6, darker(c, 0.25));
  cv.hline(1, 6, 13, darker(c, 0.45));
  cv.vline(14, 4, 6, darker(c, 0.5));
  cv.hline(0, 10, 15, PAL.ink);
  cv.set(1, 10, PAL.steelDark);
  cv.set(13, 10, PAL.steelDark);
  return { art: cv, ax: 7, ay: 10 };
}

export function crateStack(seed: number): Sprite {
  const cv = Canvas.sprite(17, 14);
  const next = lcg(seed);
  const crate = (x: number, y: number, s: number): void => {
    cv.rect(x, y, s, 3, PAL.woodLight);
    cv.hline(x, y, s, lighter(PAL.woodLight, 0.25));
    cv.rect(x, y + 3, s, s - 2, PAL.wood);
    cv.frame(x, y + 3, s, s - 2, PAL.woodDark);
    cv.line(x + 1, y + 4, x + s - 2, y + s - 1, PAL.woodDark);
  };
  crate(0, 5, 8);
  crate(9, 5, 8);
  if (next() < 0.7) crate(4, 0, 8);
  cv.hline(0, 13, 17, PAL.ink);
  return { art: cv, ax: 8, ay: 13 };
}

export function coneSprite(): Sprite {
  const art = fromRows(['.h.', '.c.', 'www', 'ccd', 'ooo'], {
    h: PAL.coralHi,
    c: PAL.coral,
    w: PAL.ivory,
    d: PAL.coralDim,
    o: PAL.ink,
  });
  return { art, ax: 1, ay: 4 };
}

/** Bus shelter: glass roof, glazed back wall, a bench and a lit advertising panel. */
export function busShelter(): Sprite {
  const cv = Canvas.sprite(30, 17);
  // Roof seen from above.
  cv.rect(0, 0, 30, 5, PAL.glass);
  for (let x = 0; x < 30; x++) if (x % 6 === 0) cv.vline(x, 0, 5, PAL.steel);
  cv.hline(0, 0, 30, PAL.steelHi);
  cv.hline(0, 4, 30, PAL.steelDark);
  for (let x = 2; x < 28; x += 6) cv.set(x, 1, PAL.glassLight);
  // Back wall and posts.
  cv.rect(1, 5, 28, 9, darker(PAL.glass, 0.35));
  for (let x = 1; x < 29; x += 9) cv.vline(x, 5, 12, PAL.steelDark);
  cv.vline(28, 5, 12, PAL.steelDark);
  cv.hline(3, 11, 15, PAL.woodLight);
  cv.hline(3, 12, 15, PAL.wood);
  cv.set(4, 13, PAL.ink);
  cv.set(16, 13, PAL.ink);
  emissive(cv, () => {
    cv.rect(21, 6, 6, 8, PAL.cyan);
    cv.rect(22, 7, 4, 2, PAL.cyanHi);
    cv.hline(22, 11, 4, PAL.cyanDim);
  });
  cv.hline(1, 16, 28, PAL.ink);
  for (let x = 2; x < 28; x++) if (cv.alpha(x, 15) === 0) cv.setA(x, 15, PAL.ink, 0);
  return { art: cv, ax: 15, ay: 16 };
}

/**
 * Red and white chevron board on two posts. `dir` is the way the arrows point: -1 west, 1 east.
 */
export function chevronBoard(dir: number, count = 2): Sprite {
  const cw = 9;
  const w = count * cw + 2;
  const cv = Canvas.sprite(w, 16);
  cv.rect(0, 0, w, 11, PAL.ink);
  cv.rect(1, 1, w - 2, 9, PAL.red);
  for (let k = 0; k < count; k++) {
    for (let j = 0; j < 9; j++) {
      const lean = j < 5 ? j : 8 - j;
      for (let t = 0; t < 3; t++) {
        const u = dir > 0 ? 1 + lean + t : cw - 2 - lean - t;
        cv.set(1 + k * cw + u, 1 + j, PAL.ivory);
      }
    }
  }
  cv.hline(1, 1, w - 2, lighter(PAL.red, 0.25));
  for (let x = 1; x < w - 1; x++) if (cv.get(x, 1) === PAL.ivory) cv.set(x, 1, PAL.paintBright);
  cv.frame(0, 0, w, 11, PAL.ink);
  for (const px of [2, w - 4]) {
    cv.vline(px, 11, 5, PAL.steelLight);
    cv.vline(px + 1, 11, 5, PAL.steelDark);
  }
  return { art: cv, ax: w >> 1, ay: 15 };
}

/**
 * A parked car in the same view as the racers: the top seen from above, the south side below
 * it. `horizontal` lays it east-west; `flip` reverses which end is the front.
 */
export function carSprite(horizontal: boolean, flip: boolean, paint: Color): Sprite {
  const len = 32;
  const wid = 17;
  const side = 6;
  const hi = lighter(paint, 0.3);
  const dk = darker(paint, 0.4);
  const cv = horizontal ? Canvas.sprite(len, wid + side) : Canvas.sprite(wid, len + side);
  const put = (u: number, v: number, c: Color): void => {
    const uu = flip ? len - 1 - u : u;
    if (horizontal) cv.set(uu, v, c);
    else cv.set(v, uu, c);
  };
  for (let u = 0; u < len; u++) {
    for (let v = 0; v < wid; v++) {
      const du = Math.min(u, len - 1 - u);
      const dv = Math.min(v, wid - 1 - v);
      const cut = u < len / 2 ? 3 : 2;
      if (du + dv < cut) continue;
      const rim = du === 0 || dv === 0 || du + dv === cut;
      let c: Color = paint;
      if (rim) c = dk;
      else if (dv === 1 || du === 1) c = hi;
      const w0 = Math.round(len * 0.28);
      const w1 = Math.round(len * 0.4);
      const r1 = Math.round(len * 0.66);
      const b1 = Math.round(len * 0.76);
      if (!rim && dv >= 3) {
        if (u >= w0 && u < w1)
          c = dv === 3 || u === w0 ? PAL.steelDark : (u + v) % 5 === 0 ? PAL.glassLight : PAL.glass;
        else if (u >= w1 && u < r1) c = dv === 3 ? dk : u === w1 ? hi : lighter(paint, 0.12);
        else if (u >= r1 && u < b1) c = dv === 3 ? PAL.steelDark : PAL.glass;
      }
      if (u === 1 && (dv === 2 || dv === 3)) c = PAL.ivory;
      if (u === len - 2 && (dv === 2 || dv === 3)) c = PAL.red;
      put(u, v, c);
    }
  }
  if (horizontal) {
    // South flank: sill, door panel, wheels.
    for (let x = 1; x < len - 1; x++) {
      cv.set(x, wid, dk);
      cv.set(x, wid + 1, darker(paint, 0.25));
      cv.set(x, wid + 2, darker(paint, 0.25));
      cv.set(x, wid + 3, dk);
      if (x > 1 && x < len - 2) cv.set(x, wid + 4, PAL.ink);
    }
    for (const wx of [5, len - 11]) {
      cv.rect(wx, wid + 2, 6, 4, PAL.ink);
      cv.rect(wx + 1, wid + 3, 4, 2, PAL.steelDark);
      cv.set(wx + 2, wid + 3, PAL.steel);
    }
    const front = flip ? len - 2 : 1;
    const back = flip ? 1 : len - 2;
    cv.set(front, wid + 1, PAL.ivory);
    cv.set(back, wid + 1, PAL.red);
    return { art: cv, ax: len >> 1, ay: wid + side - 1 };
  }
  // South end: boot or bonnet, lamps, bumper.
  const tail = !flip;
  for (let x = 1; x < wid - 1; x++) {
    cv.set(x, len, dk);
    cv.set(x, len + 1, darker(paint, 0.25));
    cv.set(x, len + 2, darker(paint, 0.25));
    cv.set(x, len + 3, PAL.steelDark);
    cv.set(x, len + 4, PAL.ink);
  }
  for (const lx of [2, wid - 4]) {
    cv.set(lx, len + 1, tail ? PAL.red : PAL.ivory);
    cv.set(lx + 1, len + 1, tail ? PAL.red : PAL.ivory);
  }
  cv.rect(6, len + 2, 5, 1, PAL.kerbIvoryDark);
  cv.rect(1, len + 4, 3, 2, PAL.ink);
  cv.rect(wid - 4, len + 4, 3, 2, PAL.ink);
  return { art: cv, ax: wid >> 1, ay: len + side - 1 };
}

export const CONTAINER_RISE = 9;

/** Shipping container, single or stacked two high. */
export function containerSprite(horizontal: boolean, paint: Color, stacked: boolean): Sprite {
  const w = horizontal ? 30 : 13;
  const d = horizontal ? 13 : 30;
  const r = CONTAINER_RISE * (stacked ? 2 : 1);
  const cv = Canvas.sprite(w, d + r);
  const top = lighter(paint, 0.16);
  cv.rect(0, 0, w, d, top);
  for (let k = 2; k < (horizontal ? w : d) - 1; k += 3) {
    if (horizontal) cv.vline(k, 1, d - 2, darker(top, 0.16));
    else cv.hline(1, k, w - 2, darker(top, 0.16));
  }
  cv.frame(0, 0, w, d, darker(top, 0.35));
  cv.hline(0, 0, w, lighter(top, 0.35));
  cv.vline(0, 0, d, lighter(top, 0.2));
  const face = darker(paint, 0.28);
  cv.rect(0, d, w, r, face);
  for (let x = 1; x < w - 1; x += 2) cv.vline(x, d + 1, r - 2, darker(paint, 0.42));
  if (stacked) {
    cv.hline(0, d + CONTAINER_RISE - 1, w, darker(paint, 0.6));
    cv.hline(0, d + CONTAINER_RISE, w, darker(paint, 0.12));
  }
  cv.hline(0, d, w, darker(paint, 0.1));
  cv.vline(0, d, r, darker(paint, 0.5));
  cv.vline(w - 1, d, r, darker(paint, 0.6));
  cv.hline(0, d + r - 1, w, PAL.ink);
  if (!horizontal) {
    // Door end faces the camera: lock rods and a placard.
    for (let k = 0; k < (stacked ? 2 : 1); k++) {
      const y0 = d + k * CONTAINER_RISE;
      cv.rect(1, y0 + 1, w - 2, CONTAINER_RISE - 2, darker(paint, 0.2));
      cv.vline(6, y0 + 1, CONTAINER_RISE - 2, darker(paint, 0.55));
      cv.vline(3, y0 + 2, CONTAINER_RISE - 4, PAL.steelLight);
      cv.vline(9, y0 + 2, CONTAINER_RISE - 4, PAL.steelLight);
      cv.set(10, y0 + 2, PAL.kerbIvory);
    }
  } else {
    cv.rect(3, d + 2, 5, 3, darker(paint, 0.05));
    cv.set(4, d + 3, PAL.kerbIvory);
    cv.set(6, d + 3, PAL.kerbIvory);
  }
  return { art: cv, ax: w >> 1, ay: d + r - 1 };
}
