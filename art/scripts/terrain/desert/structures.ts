import { Canvas } from '../canvas.js';
import type { Color } from '../canvas.js';
import { drawText, textWidth } from '../font.js';
import type { Env } from './dress.js';
import { PAL, darker, lighter } from './palette.js';
import type { HitInfo, Stage } from './stage.js';

/**
 * Built structures that span the road or follow it, raised into the stage's height field so
 * they hide and are hidden like the rock: the start banner (a deck on two thin lattice legs,
 * high enough for cars to pass under) and, on Canyon Switch, the guard rail.
 */

export const M_BANNER = 6;
export const M_RAIL = 7;

const DECK_TOP = 36;
const DECK_FLOOR = 29;

export type BannerInfo = { s: number; reach: number; text: Canvas; tw: number; cx: number; cy: number };

let banner: BannerInfo | null = null;

/** Raises the start banner over the main line just past the start line. */
export function raiseBanner(env: Env, name: string): void {
  const { ctx, track, stage } = env;
  const field = ctx.field;
  const s0 = track.startS + 18;
  const L = track.main.length;
  const p = track.main;
  const i0 = Math.round(s0 / (L / p.count)) % p.count;
  const reach = p.halfWidth[i0]! + p.shoulder[i0]! + 10;
  const tw = textWidth(name, 'micro', 1);
  const text = new Canvas(tw, 5);
  drawText(text, 0, 0, name, 0xffffff, 'micro', 1);
  const cx = p.x[i0]!;
  const cy = p.y[i0]!;
  banner = { s: s0, reach, text, tw, cx, cy };
  const R = Math.ceil(reach + 12);
  for (let y = Math.floor(cy - R); y <= cy + R; y++)
    for (let x = Math.floor(cx - R); x <= cx + R; x++) {
      if (x < 0 || y < 0 || x >= stage.w || y >= stage.h) continue;
      const q = y * stage.w + x;
      if (field.branch[q] !== 0 || field.edge[q]! > 60) continue;
      let u = field.s[q]! - s0;
      u = ((((u + L / 2) % L) + L) % L) - L / 2;
      const v = field.lateral[q]!;
      const av = Math.abs(v);
      if (Math.abs(u) <= 7 && av <= reach + 2) stage.raiseSlab(x, y, DECK_FLOOR, DECK_TOP, M_BANNER);
      else if (Math.abs(u) <= 1.5 && av >= reach - 1 && av <= reach + 2) stage.raiseSlab(x, y, 0, DECK_TOP, M_BANNER);
    }
}

/** Colors the banner's hits: a checkered deck with the track's name, steel legs. */
export function bannerPaint(env: Env, hit: HitInfo, stage: Stage): Color {
  const b = banner;
  const field = env.ctx.field;
  const q = hit.gy * stage.w + hit.gx;
  const L = env.track.main.length;
  let u = field.s[q]! - (b?.s ?? 0);
  u = ((((u + L / 2) % L) + L) % L) - L / 2;
  const v = field.lateral[q]!;
  if (!b) return PAL.steel;
  if (hit.r < DECK_FLOOR || Math.abs(v) > b.reach - 3) {
    // Legs and the deck's ends: lattice steel.
    if (hit.face === 2) return PAL.steelHi;
    return (hit.r & 2) === 0 ? PAL.steelLight : PAL.steelDark;
  }
  if (hit.face !== 0) return hit.face === 2 ? lighter(PAL.flagOrange, 0.1) : PAL.flagOrangeDark;
  if (Math.abs(u) > 5.6) return PAL.signBlack;
  const half = b.tw / 2 + 4;
  if (Math.abs(v) < half) {
    // The name reads up the screen with the tops of its letters to the west, whatever way
    // the road runs under the banner.
    const north = b.cy - hit.gy;
    const west = b.cx - hit.gx;
    const tx = Math.floor(north + b.tw / 2);
    const ty = Math.floor(2.5 - west);
    const on = tx >= 0 && ty >= 0 && tx < b.tw && ty < 5 && b.text.alpha(tx, ty) > 0;
    return on ? PAL.signWhite : PAL.flagOrange;
  }
  const chk = (Math.floor((u + 60) / 3) + Math.floor((v + 600) / 4)) & 1;
  return chk ? PAL.signWhite : PAL.signBlack;
}

/** Guard rail rise in screen pixels: the W-beam's top, and the beam's depth. */
export const RAIL_RISE = 7;

/**
 * Colors the guard rail: a galvanized beam with a lit top and a dark lower edge, posts every
 * 12 px below it. The rail stands on its own wall capsule.
 */
export function railPaint(hit: HitInfo, stage: Stage): Color {
  const post = (hit.gx + hit.gy) % 12 < 2;
  if (hit.face === 0) return hit.r >= RAIL_RISE ? PAL.steelHi : PAL.steelLight;
  if (hit.r >= RAIL_RISE - 3) {
    if (hit.r === RAIL_RISE - 1) return PAL.steelLight;
    if (hit.r === RAIL_RISE - 3) return PAL.steelDark;
    if ((hit.gx * 7 + hit.gy * 3) % 31 === 0) return PAL.signRed;
    return PAL.steel;
  }
  void stage;
  return post ? (hit.face === 2 ? PAL.woodHi : PAL.woodDark) : darker(PAL.steelDeep, 0.1);
}

/**
 * A power line on wooden poles beside the road: the poles are upright sprites, the two wires
 * sag between them and throw thin shadows on the sand. Poles stand on open sand, like sign
 * posts; the wires are far above any car.
 */
export function powerLine(
  env: Env,
  feet: ReadonlyArray<{ x: number; y: number }>,
  pole: { sprite: { art: Canvas; ax: number; ay: number }; arms: ReadonlyArray<{ x: number; y: number }> },
  drop: number,
): () => void {
  const { stage } = env;
  const art = pole.sprite.art;
  feet.forEach((f) => {
    const x = Math.round(f.x) - pole.sprite.ax;
    const y = Math.round(f.y) - pole.sprite.ay;
    stage.spriteShadow(art, x, y, Math.round(f.y), drop);
  });
  return () => {
    feet.forEach((f) => {
      const x = Math.round(f.x) - pole.sprite.ax;
      const y = Math.round(f.y) - pole.sprite.ay;
      stage.sprite(art, x, y, Math.round(f.y), 4);
    });
    for (let k = 0; k + 1 < feet.length; k++) {
      const a = feet[k]!;
      const b = feet[k + 1]!;
      const key = Math.round(Math.max(a.y, b.y));
      for (const arm of pole.arms) {
        const ax = Math.round(a.x) - pole.sprite.ax + arm.x;
        const ay = Math.round(a.y) - pole.sprite.ay + arm.y;
        const bx = Math.round(b.x) - pole.sprite.ax + arm.x;
        const by = Math.round(b.y) - pole.sprite.ay + arm.y;
        const len = Math.hypot(bx - ax, by - ay);
        const steps = Math.ceil(len);
        let px = -999;
        let py = -999;
        for (let t = 0; t <= steps; t++) {
          const u = t / steps;
          const sag = Math.sin(Math.PI * u) * Math.min(10, len * 0.06);
          const x = Math.round(ax + (bx - ax) * u);
          const y = Math.round(ay + (by - ay) * u + sag);
          if (x === px && y === py) continue;
          px = x;
          py = y;
          stage.put(x, y, PAL.steelDeep, key, 4);
        }
      }
    }
  };
}
