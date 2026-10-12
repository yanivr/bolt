import { mulberry32 } from '@bolt/shared';
import { Canvas } from '../canvas.js';
import type { Color } from '../canvas.js';
import { drawText, textWidth } from '../font.js';
import { PAL, darker, lighter } from './palette.js';
import type { RockRamp } from './palette.js';

/**
 * Upright desert props, drawn as seen from the south with the light from the upper left: a
 * lit left side, a shaded right side, a dark foot. Every sprite returns its art and the pixel
 * that stands on the ground (`ax`, `ay`). Solid props (cacti, wrecks, tire stacks) stand on
 * obstacle discs; the rest stand on open legs (towers, poles, sign posts) and go to the
 * overlays, since a car can pass between their legs.
 */

export type Sprite = { art: Canvas; ax: number; ay: number };

const sprite = (w: number, h: number): Canvas => Canvas.sprite(w, h);

// --- Vegetation ------------------------------------------------------------------------------

/** Saguaro: a ribbed trunk with one or two arms, spines catching the light. */
export function saguaro(height: number, seed: number): Sprite {
  const rnd = mulberry32(seed >>> 0);
  const W = 25;
  const cv = sprite(W, height + 2);
  const cx = 12;
  const tw = 7;
  const tx = cx - 3;
  const column = (x0: number, y0: number, y1: number, width: number): void => {
    for (let y = y0; y <= y1; y++) {
      const fromTop = y - y0;
      const inset = width >= 5 ? (fromTop === 0 ? 2 : fromTop === 1 ? 1 : 0) : fromTop === 0 ? 1 : 0;
      for (let i = inset; i < width - inset; i++) {
        const u = i / (width - 1);
        let c: Color =
          u < 0.18 ? PAL.cactusLight : u < 0.38 ? PAL.cactusHi : u < 0.62 ? PAL.cactus : u < 0.82 ? PAL.cactusDark : PAL.cactusDeep;
        if (fromTop === inset && i === inset) c = PAL.cactusHi;
        // Ribs: a dark groove every other column on the shaded half.
        if (width >= 5 && i % 2 === 1 && u > 0.5 && fromTop > 1) c = PAL.cactusDeep;
        // Spines: pale dots on the lit ribs.
        if (u < 0.5 && (y + i * 2) % 4 === 0 && fromTop > 1) c = lighter(PAL.cactusHi, 0.45);
        cv.set(x0 + i, y, c);
      }
    }
  };
  const top = 2;
  const foot = height + 1;
  column(tx, top, foot, tw);
  // Arms: out, then up.
  const arms = rnd() < 0.35 ? 1 : 2;
  for (let a = 0; a < arms; a++) {
    const left = a === 0 ? rnd() < 0.5 : true;
    const side = left ? -1 : 1;
    const at = Math.round(height * (0.45 + rnd() * 0.2));
    const up = Math.round(height * (0.25 + rnd() * 0.2));
    const out = 4 + Math.floor(rnd() * 2);
    const y = foot - at;
    const ax0 = left ? tx - out : tx + tw;
    for (let i = 0; i < out; i++)
      for (let j = 0; j < 4; j++) {
        const c = j === 0 ? PAL.cactusLight : j === 3 ? PAL.cactusDeep : j === 2 ? PAL.cactusDark : PAL.cactus;
        cv.set(ax0 + i, y + j, c);
      }
    const ux = left ? tx - out : tx + tw + out - 5;
    column(Math.max(0, ux), y - up, y + 3, 5);
    void side;
  }
  // Foot: dark ink and a little mound of sand.
  for (let i = -1; i <= tw; i++) cv.set(tx + i, foot, i < 0 || i >= tw ? PAL.sageDeep : PAL.ink);
  return { art: cv, ax: cx, ay: foot };
}

/** Joshua-tree-like yucca: a shaggy trunk forking into spiky leaf clusters. */
export function joshua(seed: number): Sprite {
  const rnd = mulberry32(seed >>> 0);
  const W = 46;
  const H = 52;
  const cv = sprite(W, H);
  const fx = 22;
  const foot = H - 1;
  const trunkTop = foot - 18;
  for (let y = trunkTop; y <= foot; y++)
    for (let i = 0; i < 4; i++) {
      const shag = (y + i * 3) % 4 === 0;
      cv.set(fx - 1 + i, y, i === 0 ? PAL.bark : i === 3 ? PAL.barkDark : shag ? PAL.barkDark : PAL.bark);
    }
  const tips: Array<[number, number]> = [];
  const branch = (x: number, y: number, dx: number, len: number, depth: number): void => {
    let px = x;
    let py = y;
    for (let k = 0; k < len; k++) {
      px += dx * 0.7;
      py -= 1;
      const ix = Math.round(px);
      const iy = Math.round(py);
      cv.set(ix, iy, PAL.bark);
      cv.set(ix + 1, iy, PAL.barkDark);
      if (depth > 0) cv.set(ix + 2, iy, PAL.barkDark);
    }
    if (depth > 0 && rnd() < 0.85) {
      branch(px, py, dx - 0.7, 5 + Math.floor(rnd() * 4), depth - 1);
      branch(px, py, dx + 0.7, 5 + Math.floor(rnd() * 4), depth - 1);
    } else tips.push([Math.round(px), Math.round(py)]);
  };
  branch(fx, trunkTop, -1, 7, 1);
  branch(fx + 1, trunkTop, 1, 8, 1);
  for (const [tx, ty] of tips) {
    // A spiky rosette: rays of dark leaves, lit tips toward the north-west.
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + (rnd() - 0.5) * 0.3;
      const len = 4 + rnd() * 2.5;
      for (let s = 1; s <= len; s++) {
        const x = Math.round(tx + Math.cos(a) * s);
        const y = Math.round(ty + Math.sin(a) * s * 0.85);
        const lit = Math.cos(a) + Math.sin(a) < -0.3;
        cv.set(x, y, s >= len - 1 ? (lit ? PAL.sageHi : PAL.sage) : lit ? PAL.sage : PAL.sageDark);
      }
    }
    cv.rect(tx - 1, ty - 1, 3, 3, PAL.sageDeep);
    cv.set(tx - 1, ty - 1, PAL.sageDark);
  }
  cv.hline(fx - 2, foot, 7, PAL.ink);
  return { art: cv, ax: fx + 1, ay: foot };
}

// --- Wrecks and track dressing -------------------------------------------------------------

/** A rusted sedan abandoned in the desert, seen like the racers: top above, south flank below. */
export function wreck(seed: number, paint: Color = PAL.paintTeal): Sprite {
  const rnd = mulberry32(seed >>> 0);
  const len = 33;
  const wid = 16;
  const side = 6;
  const cv = sprite(len + 2, wid + side + 1);
  const rust = (c: Color, x: number, y: number): Color => {
    const r = mulberry32(((x * 73856093) ^ (y * 19349663) ^ seed) >>> 0)();
    return r < 0.22 ? PAL.rust : r < 0.3 ? PAL.rustDark : c;
  };
  for (let u = 0; u < len; u++)
    for (let v = 0; v < wid; v++) {
      const du = Math.min(u, len - 1 - u);
      const dv = Math.min(v, wid - 1 - v);
      if (du + dv < 3) continue;
      const rim = du === 0 || dv === 0 || du + dv === 3;
      let c: Color = paint;
      if (rim) c = darker(paint, 0.45);
      else if (dv === 1) c = lighter(paint, 0.25);
      // Windscreen and rear glass, broken; the bonnet gone, the engine bay a dark hole.
      if (!rim && dv >= 3) {
        if (u >= 9 && u < 13) c = u === 9 ? PAL.steelDark : (u + v) % 3 === 0 ? PAL.steel : PAL.inkSoft;
        else if (u >= 13 && u < 22) c = lighter(paint, 0.12);
        else if (u >= 22 && u < 25) c = PAL.inkSoft;
        else if (u >= 2 && u < 8) c = v % 3 === 0 ? PAL.rustDark : PAL.ink;
      }
      if (!rim) c = rust(c, u, v);
      cv.set(u + 1, v, c);
    }
  // South flank: door panels, a missing rear wheel, a flat front tire.
  for (let x = 2; x < len; x++) {
    cv.set(x, wid, darker(paint, 0.45));
    cv.set(x, wid + 1, rust(darker(paint, 0.2), x, 50));
    cv.set(x, wid + 2, rust(darker(paint, 0.25), x, 51));
    cv.set(x, wid + 3, darker(paint, 0.5));
    cv.set(x, wid + 4, PAL.ink);
  }
  cv.rect(6, wid + 2, 6, 4, PAL.rubber);
  cv.rect(7, wid + 3, 4, 2, PAL.rubberHi);
  cv.hline(6, wid + 5, 6, PAL.ink);
  cv.rect(len - 11, wid + 3, 6, 3, PAL.ink);
  void rnd;
  return { art: cv, ax: (len >> 1) + 1, ay: wid + side - 1 };
}

/** A stack of old tires, the top one painted white: a track marker on a rock disc. */
export function tireStack(count: number, painted: boolean): Sprite {
  const W = 13;
  const cv = sprite(W, 6 + count * 4);
  const foot = cv.h - 1;
  for (let k = 0; k < count; k++) {
    const y = foot - 5 - k * 4;
    const top = k === count - 1;
    // Side of the tire: a dark band with tread blocks.
    for (let x = 1; x < W - 1; x++)
      for (let j = 2; j < 5; j++) cv.set(x, y + j, j === 4 ? PAL.ink : (x + j) % 3 === 0 ? PAL.rubber : PAL.rubberHi);
    // Top: an ellipse ring.
    const ring = top && painted ? PAL.signWhite : PAL.rubberHi;
    for (let x = 0; x < W; x++)
      for (let j = 0; j < 3; j++) {
        const dx = (x - (W - 1) / 2) / (W / 2);
        const dy = (j - 1) / 1.6;
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        cv.set(x, y + j, d < 0.32 ? PAL.ink : x < W / 2 ? ring : darker(ring, 0.3));
      }
  }
  return { art: cv, ax: W >> 1, ay: foot };
}

// --- Posts, signs, flags --------------------------------------------------------------------

function post(cv: Canvas, x: number, y0: number, y1: number, metal = false): void {
  const a = metal ? PAL.steelLight : PAL.woodHi;
  const b = metal ? PAL.steelDark : PAL.woodDark;
  for (let y = y0; y <= y1; y++) {
    cv.set(x, y, a);
    cv.set(x + 1, y, b);
  }
}

/** Yellow warning board with black chevrons on two posts; `dir` the way they point on screen. */
export function chevronBoard(dir: number, count: number): Sprite {
  const cw = 12;
  const w = count * cw + 4;
  const bh = 15;
  const H = bh + 10;
  const cv = sprite(w, H);
  cv.rect(0, 0, w, bh, PAL.signBlack);
  cv.rect(1, 1, w - 2, bh - 2, PAL.signYellow);
  cv.hline(1, 1, w - 2, lighter(PAL.signYellow, 0.35));
  cv.hline(1, bh - 2, w - 2, PAL.signYellowDark);
  for (let k = 0; k < count; k++)
    for (let j = 0; j < bh - 4; j++) {
      const mid = (bh - 5) / 2;
      const lean = Math.round(mid - Math.abs(j - mid));
      for (let t = 0; t < 4; t++) {
        const u = dir > 0 ? 2 + lean + t : cw - 1 - lean - t;
        cv.set(1 + k * cw + u, 2 + j, PAL.signBlack);
      }
    }
  post(cv, 3, bh, H - 1, true);
  post(cv, w - 5, bh, H - 1, true);
  return { art: cv, ax: w >> 1, ay: H - 1 };
}

/** Text with the apostrophe the shared micro face lacks. */
function signText(cv: Canvas, x: number, y: number, text: string, color: Color, scale = 1): void {
  let cx = x;
  for (const ch of text) {
    if (ch === "'") {
      for (let s = 0; s < scale; s++) for (let t = 0; t < 2 * scale; t++) cv.set(cx + s, y + t, color);
      cx += 2 * scale;
      continue;
    }
    drawText(cv, cx, y, ch, color, 'micro', scale);
    cx += 4 * scale;
  }
}

function signTextWidth(text: string, scale = 1): number {
  let w = 0;
  for (const ch of text) w += ch === "'" ? 2 * scale : 4 * scale;
  return w - scale;
}

/** A painted wooden route board with an arrow: shortcut and landmark names. */
export function routeSign(text: string, arrow: -1 | 0 | 1): Sprite {
  const tw = signTextWidth(text);
  const w = tw + (arrow !== 0 ? 12 : 6);
  const H = 22;
  const cv = sprite(w, H);
  cv.rect(0, 0, w, 11, PAL.woodDeep);
  cv.rect(1, 1, w - 2, 9, PAL.wood);
  cv.hline(1, 1, w - 2, PAL.woodHi);
  cv.hline(1, 9, w - 2, PAL.woodDark);
  const tx = arrow < 0 ? 9 : 3;
  signText(cv, tx, 3, text, PAL.signWhite);
  if (arrow !== 0) {
    const ax = arrow > 0 ? w - 7 : 2;
    for (let j = 0; j < 5; j++) {
      const span = j < 3 ? j : 4 - j;
      for (let t = 0; t <= span; t++) cv.set(arrow > 0 ? ax + t : ax + 4 - t, 3 + j, PAL.signYellow);
    }
  }
  post(cv, 3, 11, H - 1);
  post(cv, w - 5, 11, H - 1);
  return { art: cv, ax: w >> 1, ay: H - 1 };
}

/** Yellow diamond warning with a falling-rock pictogram and a text plate. */
export function fallingRockSign(): Sprite {
  const w = 29;
  const H = 34;
  const cv = sprite(w, H);
  const cx = 14;
  for (let y = 0; y < 19; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.abs(x - cx) + Math.abs(y - 9);
      if (d > 9) continue;
      cv.set(x, y, d === 9 ? PAL.signBlack : d === 8 ? PAL.signYellowDark : PAL.signYellow);
    }
  // A slope and two falling rocks.
  for (let k = 0; k < 7; k++) cv.set(cx - 5 + k, 12 - Math.floor(k / 2), PAL.signBlack);
  cv.rect(cx + 1, 6, 3, 3, PAL.signBlack);
  cv.rect(cx - 1, 10, 2, 2, PAL.signBlack);
  const tw = signTextWidth('ROCKS');
  cv.rect(cx - (tw >> 1) - 2, 19, tw + 4, 8, PAL.signBlack);
  cv.rect(cx - (tw >> 1) - 1, 20, tw + 2, 6, PAL.signYellow);
  signText(cv, cx - (tw >> 1), 20, 'ROCKS', PAL.signBlack);
  post(cv, cx - 1, 27, H - 1, true);
  return { art: cv, ax: cx, ay: H - 1 };
}

/** Wind sock on a mast, one frame: the sock points along `dir` (screen) by `reach` of 1. */
export function windSock(dir: { x: number; y: number }, reach: number, phase: number): Canvas {
  const W = 56;
  const H = 54;
  const cv = sprite(W, H);
  const px = 27;
  const top = 10;
  for (let y = top; y < H; y++) {
    cv.set(px, y, PAL.steelLight);
    cv.set(px + 1, y, PAL.steelDark);
  }
  cv.rect(px - 2, H - 2, 6, 2, PAL.steelDeep);
  // The sock: five bands in orange and white, tapering, its tip sagging as the wind drops.
  const segs = 5;
  const len = 5;
  let x = px + 1.5;
  let y = top + 1;
  const sag = 1 - reach;
  for (let s = 0; s < segs; s++) {
    const wob = Math.sin(phase + s * 1.3) * (0.5 + s * 0.3) * (0.5 + reach * 0.5);
    const dx = dir.x * reach * len + sag * 0.25 * len * (Math.sign(dir.x) || 1);
    const dy = dir.y * reach * len * 0.62 + sag * len * 0.95;
    const r = 3.2 - s * 0.45;
    const c = s % 2 === 0 ? PAL.flagOrange : PAL.signWhite;
    const cd = s % 2 === 0 ? PAL.flagOrangeDark : PAL.signWhiteDark;
    for (let t = 0; t < len; t++) {
      const qx = x + (dx * t) / len;
      const qy = y + (dy * t) / len + wob * 0.5;
      // Thickness runs across the sock's own direction.
      const nx = -(dy || 0.01);
      const ny = dx || 0.01;
      const nl = Math.hypot(nx, ny);
      for (let o = -Math.ceil(r); o <= Math.ceil(r); o++) {
        if (Math.abs(o) > r) continue;
        cv.set(Math.round(qx + (nx / nl) * o), Math.round(qy + (ny / nl) * o), o * (ny / nl) > r * 0.3 ? cd : c);
      }
    }
    x += dx;
    y += dy + wob * 0.3;
  }
  // The ring at the mast head.
  cv.rect(px - 2, top - 2, 5, 4, PAL.steel);
  cv.set(px - 1, top - 2, PAL.steelHi);
  return cv;
}

/** A pennant on a pole, one frame of its flutter. */
export function flag(dir: { x: number; y: number }, reach: number, phase: number, color: Color): Canvas {
  const W = 34;
  const H = 40;
  const cv = sprite(W, H);
  const px = 16;
  const top = 6;
  for (let y = top; y < H; y++) {
    cv.set(px, y, PAL.steelLight);
    cv.set(px + 1, y, PAL.steelDark);
  }
  cv.set(px, top - 1, PAL.steelHi);
  const L = 13;
  const sx = Math.sign(dir.x) || 1;
  for (let u = 0; u < L; u++) {
    const t = u / (L - 1);
    const hgt = Math.round(7 * (1 - t * 0.7));
    const wave = Math.sin(phase - u * 0.7) * (0.6 + t * 1.6) * (0.4 + reach * 0.6);
    const droop = (1 - reach) * u * 0.8;
    const fx = Math.round(px + 1 + sx * (u * (0.3 + 0.7 * reach)) + (sx > 0 ? 1 : -1));
    const fy = Math.round(top + droop + wave + dir.y * u * reach * 0.4);
    for (let j = 0; j < hgt; j++) {
      const shade = wave > 0.5 ? darker(color, 0.25) : j === 0 ? lighter(color, 0.25) : color;
      cv.set(fx, fy + j, j === hgt - 1 ? darker(color, 0.4) : shade);
    }
  }
  return cv;
}

// --- Landmarks ------------------------------------------------------------------------------

/** Two posts and a catwalk carrying a sun-bleached diner billboard. */
export function billboard(): Sprite {
  const W = 84;
  const BH = 30;
  const legs = 20;
  const H = BH + legs + 4;
  const cv = sprite(W, H);
  const foot = H - 1;
  for (const lx of [12, W - 14]) {
    post(cv, lx, BH, foot);
    // Diagonal brace.
    for (let k = 0; k < 12; k++) cv.set(lx + 2 + Math.floor(k / 2), BH + 4 + k, PAL.woodDark);
  }
  // Board: a faded sky, a sun, the name, peeling where the wood shows through.
  const bx = 2;
  const by = 0;
  const bw = W - 4;
  cv.rect(bx, by, bw, BH, PAL.woodDeep);
  for (let y = 1; y < BH - 1; y++)
    for (let x = 1; x < bw - 1; x++) {
      const t = y / BH;
      let c: Color = t < 0.45 ? lighter(PAL.sky, 0.25 + t * 0.6) : t < 0.7 ? PAL.paintCream : PAL.paintCoral;
      const sx = x - (bw - 16);
      const sy = y - 9;
      if (sx * sx + sy * sy < 30) c = PAL.signYellow;
      const peel = mulberry32(((x >> 1) * 92821 + (y >> 1) * 68917) >>> 0)();
      if (peel < 0.07) c = PAL.wood;
      cv.set(bx + x, by + y, c);
    }
  signText(cv, bx + 5, by + 4, "DUSTY'S", PAL.paintBlueDark, 2);
  signText(cv, bx + 6, by + 17, 'DINER  GAS  12 MI', PAL.ink);
  cv.hline(bx, by + BH - 1, bw, PAL.woodDark);
  // Catwalk under the board.
  cv.rect(bx + 2, by + BH, bw - 4, 2, PAL.steelDark);
  cv.hline(bx + 2, by + BH, bw - 4, PAL.steel);
  for (let x = bx + 4; x < bx + bw - 4; x += 6) cv.vline(x, by + BH - 4, 4, PAL.steelDark);
  return { art: cv, ax: W >> 1, ay: foot };
}

/** A water-pumping windmill on a lattice tower, without its wheel (the wheel is a loop). */
export function windPumpTower(): { sprite: Sprite; hub: { x: number; y: number } } {
  const W = 44;
  const H = 70;
  const cv = sprite(W, H);
  const foot = H - 1;
  const cx = 20;
  const top = 18;
  const leg = (x0: number, x1: number, lit: boolean): void => {
    for (let y = top; y <= foot; y++) {
      const t = (y - top) / (foot - top);
      const x = Math.round(x1 + (x0 - x1) * t);
      cv.set(x, y, lit ? PAL.steelLight : PAL.steelDark);
    }
  };
  leg(cx - 9, cx - 2, true);
  leg(cx + 9, cx + 2, false);
  leg(cx - 4, cx - 1, true);
  leg(cx + 4, cx + 1, false);
  // Cross bracing every 10 px.
  for (let y = top + 6; y < foot; y += 10) {
    const t0 = (y - top) / (foot - top);
    const t1 = (y + 10 - top) / (foot - top);
    const a0 = Math.round(cx - 2 + (cx - 9 - (cx - 2)) * t0);
    const b1 = Math.round(cx + 2 + (cx + 9 - (cx + 2)) * Math.min(1, t1));
    cv.line(a0, y, b1, Math.min(foot, y + 10), PAL.steel);
    cv.line(2 * cx - a0, y, 2 * cx - b1, Math.min(foot, y + 10), PAL.steelDark);
  }
  // Platform, gearbox and the tail vane pointing downwind (east by default).
  cv.rect(cx - 4, top - 2, 9, 3, PAL.steelDark);
  cv.hline(cx - 4, top - 2, 9, PAL.steelLight);
  cv.rect(cx - 1, top - 5, 4, 4, PAL.rustDark);
  cv.hline(cx + 2, top - 4, 14, PAL.steel);
  for (let j = 0; j < 7; j++) cv.hline(cx + 12, top - 8 + j, 5 - Math.abs(j - 3), j < 3 ? PAL.signRed : PAL.signRedDark);
  // Pump rod and the stock tank pipe.
  cv.vline(cx, top, foot - top, PAL.steelDeep);
  return { sprite: { art: cv, ax: cx, ay: foot }, hub: { x: cx, y: top - 4 } };
}

/** The windmill's wheel at a rotation step (0 to 3): twelve blades on a ring. */
export function windWheel(step: number): Canvas {
  const R = 10;
  const cv = sprite(R * 2 + 3, R * 2 + 3);
  const c = R + 1;
  for (let k = 0; k < 12; k++) {
    const a = ((k + step / 4) / 12) * Math.PI * 2;
    for (let r = 3; r <= R; r++) {
      const x = Math.round(c + Math.cos(a) * r);
      const y = Math.round(c + Math.sin(a) * r * 0.92);
      cv.set(x, y, Math.cos(a) + Math.sin(a) < 0 ? PAL.steelHi : PAL.steelLight);
    }
  }
  cv.ring(c, c, R, PAL.steelDark);
  cv.ring(c, c, 3, PAL.steel);
  cv.rect(c - 1, c - 1, 3, 3, PAL.rustDark);
  return cv;
}

/** A riveted water tank on four legs. */
export function waterTank(): Sprite {
  const W = 26;
  const H = 36;
  const cv = sprite(W, H);
  const foot = H - 1;
  for (const lx of [3, 9, 15, 21]) post(cv, lx, 16, foot, true);
  cv.line(4, 20, 22, 32, PAL.steelDark);
  cv.line(22, 20, 4, 32, PAL.steelDark);
  // Tank: lit top ellipse, banded body.
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < W; x++) {
      if (y < 5) {
        const dx = (x - 12.5) / 12.5;
        const dy = (y - 2.5) / 2.6;
        if (dx * dx + dy * dy > 1) continue;
        cv.set(x, y, x < 12 ? PAL.steelHi : PAL.steelLight);
      } else {
        if (x === 0 || x === W - 1) continue;
        const u = x / W;
        let c: Color = u < 0.25 ? PAL.steelLight : u < 0.7 ? PAL.steel : PAL.steelDark;
        if (y === 9 || y === 13) c = darker(c, 0.25);
        if (mulberry32((x * 31 + y * 17) >>> 0)() < 0.12) c = PAL.rust;
        cv.set(x, y, c);
      }
    }
  return { art: cv, ax: W >> 1, ay: foot };
}

/** A tall guyed lattice mast in red and white bands, with its guy wires; lamps are loops. */
export function radioMast(height: number): { sprite: Sprite; lamps: Array<{ x: number; y: number }> } {
  const W = 124;
  const cv = sprite(W, height + 30);
  const foot = height + 4;
  const cx = 62;
  const top = 4;
  // Guy wires first, so the mast is drawn over them: east, west and one to the north behind.
  const anchors: Array<[number, number]> = [
    [cx + 56, foot + 18],
    [cx - 58, foot + 12],
    [cx + 8, foot - 44],
  ];
  for (const [axp, ayp] of anchors) {
    for (const hgt of [top + 8, Math.round(foot - height * 0.5)]) cv.line(cx, hgt, axp, ayp, PAL.steelDark);
    cv.rect(axp - 2, ayp - 1, 5, 3, PAL.stoneShade);
    cv.hline(axp - 2, ayp - 1, 5, PAL.stone);
  }
  for (let y = top; y <= foot; y++) {
    const band = Math.floor((y - top) / 14) % 2 === 0;
    const a = band ? PAL.signRed : PAL.signWhite;
    const b = band ? PAL.signRedDark : PAL.signWhiteDark;
    cv.set(cx - 3, y, a);
    cv.set(cx + 3, y, b);
    // Lacing zigzags between the chords; battens every six rows.
    const z = (y + 600) % 10;
    const lx = z < 5 ? cx - 2 + z : cx + 7 - z;
    cv.set(lx, y, z % 5 === 0 ? b : a);
    if ((y - top) % 6 === 0) cv.hline(cx - 3, y, 7, b);
  }
  cv.rect(cx - 5, foot - 1, 11, 3, PAL.steelDeep);
  cv.hline(cx - 5, foot - 1, 11, PAL.steel);
  cv.rect(cx - 1, 0, 3, 4, PAL.steelDark);
  return {
    sprite: { art: cv, ax: cx, ay: foot },
    lamps: [
      { x: cx, y: 1 },
      { x: cx, y: Math.round(foot - height * 0.5) },
    ],
  };
}

/** A fire lookout cabin on timber stilts with a ladder and a tin roof. */
export function watchtower(): Sprite {
  const W = 34;
  const H = 62;
  const cv = sprite(W, H);
  const foot = H - 1;
  const deck = 26;
  const legs: Array<[number, number, boolean]> = [
    [4, 8, true],
    [28, 24, false],
    [11, 12, true],
    [22, 21, false],
  ];
  for (const [b, t, lit] of legs)
    for (let y = deck; y <= foot; y++) {
      const x = Math.round(t + ((b - t) * (y - deck)) / (foot - deck));
      cv.set(x, y, lit ? PAL.woodHi : PAL.woodDark);
      cv.set(x + 1, y, PAL.woodDark);
    }
  for (let y = deck + 8; y < foot; y += 11) {
    cv.line(7, y, 26, y + 10, PAL.woodDark);
    cv.line(26, y, 7, y + 10, PAL.wood);
  }
  // Ladder.
  for (let y = deck; y < foot; y++) {
    cv.set(15, y, PAL.woodDark);
    cv.set(18, y, PAL.woodDark);
    if (y % 3 === 0) cv.hline(15, y, 4, PAL.wood);
  }
  // Deck and cabin.
  cv.rect(3, deck - 2, 28, 3, PAL.woodDark);
  cv.hline(3, deck - 2, 28, PAL.woodHi);
  cv.rect(6, 10, 22, 14, PAL.wood);
  for (let x = 6; x < 28; x += 3) cv.vline(x, 10, 14, PAL.woodDark);
  cv.rect(8, 13, 18, 5, PAL.paintBlueDark);
  for (let x = 9; x < 26; x += 4) cv.rect(x, 14, 3, 3, PAL.skyLight);
  cv.vline(27, 10, 14, PAL.woodDeep);
  // Tin roof, lit from the upper left.
  for (let j = 0; j < 9; j++) {
    const inset = 8 - j;
    cv.hline(2 + inset - 6 > 0 ? inset - 4 : 0, 1 + j, W - 2 * Math.max(0, inset - 4), j === 0 ? PAL.steelHi : j < 4 ? PAL.steelLight : PAL.steel);
  }
  cv.hline(0, 10, W, PAL.steelDeep);
  return { art: cv, ax: W >> 1, ay: foot };
}

/** A rusted ore hopper on a timber trestle, with its chute. */
export function oreHopper(): Sprite {
  const W = 52;
  const H = 54;
  const cv = sprite(W, H);
  const foot = H - 1;
  const deck = 24;
  for (const lx of [4, 16, 32, 44]) {
    post(cv, lx, deck, foot);
    post(cv, lx + 2, deck + 4, foot);
  }
  for (let y = deck + 6; y < foot - 2; y += 10) {
    cv.hline(4, y, 44, PAL.woodDark);
    cv.line(6, y, 16, y + 10, PAL.wood);
    cv.line(34, y, 44, y + 10, PAL.wood);
  }
  // The hopper: a lit top rim, a funnel of rusted plate.
  for (let y = 0; y < deck; y++) {
    const inset = Math.max(0, Math.floor((y - 8) * 0.9));
    for (let x = 2 + inset; x < W - 2 - inset; x++) {
      const u = (x - 2 - inset) / Math.max(1, W - 4 - 2 * inset);
      let c: Color = y < 3 ? (y === 0 ? PAL.rustHi : PAL.rust) : u < 0.3 ? PAL.rust : u < 0.75 ? PAL.rustDark : PAL.rustDeep;
      if (y >= 3 && (x - inset) % 8 === 0) c = PAL.rustDeep;
      if (y < 3 && x > 6 && x < W - 7 && y > 0) c = PAL.ore;
      cv.set(x, y, c);
    }
  }
  // Chute.
  for (let k = 0; k < 10; k++) cv.rect(24 + k, deck + k, 5, 2, k % 3 === 0 ? PAL.rustDark : PAL.rust);
  return { art: cv, ax: W >> 1, ay: foot };
}

/** A banner gantry over the start: two lattice legs and a checkered banner with the name. */
export function startBanner(span: number, name: string): { art: Canvas; legX: [number, number] } {
  const H = 44;
  const W = span;
  const cv = sprite(W, H);
  const legs: [number, number] = [2, W - 5];
  for (const lx of legs) {
    for (let y = 8; y < H; y++) {
      cv.set(lx, y, PAL.steelLight);
      cv.set(lx + 2, y, PAL.steelDark);
      if (y % 4 === 0) cv.set(lx + 1, y, PAL.steel);
    }
  }
  cv.rect(0, 2, W, 12, PAL.signBlack);
  for (let x = 1; x < W - 1; x++)
    for (let y = 3; y < 13; y++) {
      const chk = ((Math.floor(x / 4) + Math.floor((y - 3) / 5)) & 1) === 0;
      cv.set(x, y, chk ? PAL.signWhite : PAL.signBlack);
    }
  const tw = textWidth(name, 'micro', 1);
  const tx = (W - tw) >> 1;
  cv.rect(tx - 3, 3, tw + 6, 10, PAL.flagOrange);
  cv.hline(tx - 3, 3, tw + 6, lighter(PAL.flagOrange, 0.3));
  drawText(cv, tx, 5, name, PAL.signWhite, 'micro', 1);
  return { art: cv, legX: legs };
}

export type RampPair = { rock: RockRamp };

/** A wooden utility pole with a crossarm and two insulators; returns where the wires hang. */
export function utilityPole(): { sprite: Sprite; arms: Array<{ x: number; y: number }> } {
  const W = 17;
  const H = 52;
  const cv = sprite(W, H);
  const cx = 8;
  for (let y = 3; y < H; y++) {
    cv.set(cx, y, PAL.woodHi);
    cv.set(cx + 1, y, PAL.woodDark);
  }
  cv.hline(1, 6, 15, PAL.wood);
  cv.hline(1, 7, 15, PAL.woodDeep);
  for (const ix of [2, 14]) {
    cv.set(ix, 4, PAL.signWhite);
    cv.set(ix, 5, PAL.signWhiteDark);
  }
  cv.set(cx, 2, PAL.woodHi);
  cv.hline(cx - 1, H - 1, 4, PAL.ink);
  return { sprite: { art: cv, ax: cx, ay: H - 1 }, arms: [{ x: 2, y: 4 }, { x: 14, y: 4 }] };
}
