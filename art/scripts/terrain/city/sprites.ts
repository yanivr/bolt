import type { Canvas, Color } from '../canvas.js';
import { F_EMISSIVE } from '../canvas.js';
import { PAL, contactShade, darker, lighter } from './palette.js';

/**
 * Small hand-built sprites shared by the roof, street and landmark painters. Everything is lit
 * from the upper left and drops a short hard contact shadow to the lower right.
 */

/** Hard drop shadow for a rectangular footprint. */
export function dropShadow(cv: Canvas, x: number, y: number, w: number, h: number, len: number): void {
  for (let k = 1; k <= len; k++) {
    for (let i = 0; i < w; i++) cv.map(x + i + k, y + h - 1 + k, contactShade);
    for (let j = 0; j < h - 1; j++) cv.map(x + w - 1 + k, y + j + k, contactShade);
  }
}

export function discShadow(cv: Canvas, cx: number, cy: number, r: number, len: number): void {
  cv.mapDisc(cx + len, cy + len, r, contactShade);
}

/** Raised box: lit top and left rims, dark bottom and right rims. */
export function box(cv: Canvas, x: number, y: number, w: number, h: number, top: Color, hi: Color, dk: Color, shadow: number): void {
  if (shadow > 0) dropShadow(cv, x, y, w, h, shadow);
  cv.rect(x, y, w, h, top);
  cv.hline(x, y, w, hi);
  cv.vline(x, y, h, hi);
  cv.hline(x, y + h - 1, w, dk);
  cv.vline(x + w - 1, y, h, dk);
}

export function emissive(cv: Canvas, fn: () => void): void {
  const prev = cv.curFlags;
  cv.curFlags = F_EMISSIVE;
  fn();
  cv.curFlags = prev;
}

/** Round tree canopy with clustered leaves. `r` from 3 (sidewalk sapling) up to 11. */
export function tree(cv: Canvas, cx: number, cy: number, r: number, seed: number, warm = false): void {
  const shadowLen = Math.max(2, Math.round(r * 0.6));
  cv.mapDisc(cx + shadowLen, cy + shadowLen, r, contactShade);
  const deep = PAL.leafDeep;
  const dark = PAL.leafDark;
  const mid = warm ? PAL.leafLight : PAL.leaf;
  const light = warm ? PAL.leafHi : PAL.leafLight;
  cv.disc(cx, cy, r, deep);
  cv.disc(cx - 0.4, cy - 0.4, r - 1, dark);
  cv.disc(cx - r * 0.22, cy - r * 0.22, r * 0.68, mid);
  // Leaf clusters: a few small lit clumps toward the light, dark ones away from it.
  let s = seed >>> 0;
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const clumps = Math.max(2, Math.round(r * 0.9));
  for (let k = 0; k < clumps; k++) {
    const a = next() * Math.PI * 2;
    const d = next() * r * 0.62;
    const px = cx + Math.cos(a) * d - r * 0.18;
    const py = cy + Math.sin(a) * d - r * 0.18;
    const lit = px + py < cx + cy;
    cv.disc(Math.round(px), Math.round(py), r > 6 ? 1.2 : 0.6, lit ? light : dark);
  }
  if (r >= 4) cv.set(Math.round(cx - r * 0.4), Math.round(cy - r * 0.45), warm ? PAL.leafHi : light);
}

/**
 * A parked car seen from above. `len` runs along the car; `horizontal` lays it east-west and
 * `flip` reverses which end is the front.
 */
export function parkedCar(cv: Canvas, x: number, y: number, horizontal: boolean, flip: boolean, paint: Color, wid = 18, len = 32): void {
  const hi = lighter(paint, 0.3);
  const dk = darker(paint, 0.38);
  const put = (u: number, v: number, c: Color): void => {
    const uu = flip ? len - 1 - u : u;
    if (horizontal) cv.set(x + uu, y + v, c);
    else cv.set(x + v, y + uu, c);
  };
  // Contact shadow first.
  for (let u = 2; u < len + 2; u++) {
    for (let v = 2; v < wid + 2; v++) {
      if (horizontal) cv.map(x + u, y + v, contactShade);
      else cv.map(x + v, y + u, contactShade);
    }
  }
  for (let u = 0; u < len; u++) {
    for (let v = 0; v < wid; v++) {
      // Rounded corners: nose rounder than tail.
      const du = Math.min(u, len - 1 - u);
      const dv = Math.min(v, wid - 1 - v);
      const cut = u < len / 2 ? 3 : 2;
      if (du + dv < cut) continue;
      const rim = du === 0 || dv === 0 || du + dv === cut;
      let c: Color = paint;
      if (rim) c = PAL.ink;
      else if (dv === 1 || du === 1) c = v < wid / 2 && u < len - 2 ? hi : dk;
      // Glass: windshield, roof, rear window.
      const w0 = Math.round(len * 0.28);
      const w1 = Math.round(len * 0.4);
      const r1 = Math.round(len * 0.66);
      const b1 = Math.round(len * 0.76);
      if (!rim && dv >= 3) {
        if (u >= w0 && u < w1) c = dv === 3 || u === w0 ? PAL.steelDark : (u + v) % 5 === 0 ? PAL.glassLight : PAL.glass;
        else if (u >= w1 && u < r1) c = dv === 3 ? dk : u === w1 ? hi : paint;
        else if (u >= r1 && u < b1) c = dv === 3 ? PAL.steelDark : PAL.glass;
      }
      // Lamps.
      if (u === 1 && (dv === 2 || dv === 3)) c = PAL.ivory;
      if (u === len - 2 && (dv === 2 || dv === 3)) c = PAL.red;
      put(u, v, c);
    }
  }
}

/** Sodium street lamp head with a tiny hard glow cross. */
export function lampHead(cv: Canvas, x: number, y: number): void {
  emissive(cv, () => {
    cv.rect(x - 2, y - 1, 5, 3, PAL.lampGlow);
    cv.rect(x - 1, y - 2, 3, 5, PAL.lampGlow);
    cv.rect(x - 1, y - 1, 3, 3, PAL.lamp);
    cv.set(x, y, PAL.ivory);
  });
}
