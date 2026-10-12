import { mulberry32, sampleBranch } from '@bolt/shared';
import type { AnimatedArt, BakeContext } from '../../biome.js';
import { Canvas, col } from '../../canvas.js';
import type { Color } from '../../canvas.js';
import { drawText, textWidth } from '../../font.js';
import type { Scene } from '../../oblique.js';
import { drawSignal } from '../anim.js';
import { billboard } from '../buildings.js';
import type { CityLayout, Lot } from '../layout.js';
import { PAL, TINT_HEX, TINT_WARM, darker, lighter } from '../palette.js';
import type { LightOut } from '../props.js';
import { BARRIER_REACH } from '../road.js';
import { chevronBoard, emissive, lampTwin } from '../sprites.js';

/**
 * Street dressing that comes from the track data: chevron boards at the runtime's corner
 * signs, name boards at the shortcut mouths, the boulevard's lamps at their anchors, laundry
 * strung across Laundry Lane, the cafe's awning, the start banner, the market's hoarding and
 * its traffic light.
 */

const anchor = (ctx: BakeContext, id: string): Array<{ x: number; y: number }> =>
  (ctx.def.anchors.find((a) => a.id === id)?.points ?? []).map((p) => ({ x: p.x, y: p.y }));

/** Walks from a point along a direction to the first ground pixel a sprite can stand on. */
function standPoint(
  scene: Scene,
  x: number,
  y: number,
  nx: number,
  ny: number,
  art: Canvas,
  ax: number,
  ay: number,
  from = 0,
): { x: number; y: number } | null {
  for (let k = from; k < 60; k++) {
    const gx = Math.round(x + nx * k);
    const gy = Math.round(y + ny * k);
    if (gx < 2 || gy < 2 || gx >= scene.w - 2 || gy >= scene.h - 2) return null;
    if (scene.drive[gy * scene.w + gx]) continue;
    if (scene.artFits(art, gx - ax, gy - ay)) return { x: gx, y: gy };
  }
  return null;
}

/** Chevron boards on the outside of every bend the runtime signs, pointing the way it turns. */
export function placeCornerSigns(ctx: BakeContext, scene: Scene, layout: CityLayout): number {
  let placed = 0;
  for (const sign of ctx.track.cornerSigns) {
    const br = ctx.track.branches[sign.branch]!;
    const p = sampleBranch(br, sign.signS);
    // The way the road goes after the bend, as seen on screen.
    const after = sampleBranch(br, sign.bendS + 160);
    const left = sign.turn === 'left';
    const nx = left ? p.ty : -p.ty;
    const dir = Math.abs(nx) > 0.3 ? Math.sign(nx) : Math.sign(after.tx) || 1;
    const board = chevronBoard(dir, Math.min(3, sign.severity));
    // Outward normal on the outside of the bend: right of travel for a left turn.
    const sx = left ? -p.ty : p.ty;
    const sy = left ? p.tx : -p.tx;
    const reach = p.halfWidth + p.shoulder + BARRIER_REACH + 2;
    const extra = sy > 0.4 ? board.art.h * sy : 0;
    const at = standPoint(
      scene,
      p.x + sx * (reach + extra),
      p.y + sy * (reach + extra),
      sx,
      sy,
      board.art,
      board.ax,
      board.ay,
    );
    if (!at) continue;
    if (layout.roofId[at.y * layout.w + at.x] !== 0) continue;
    scene.place(board, at.x, at.y);
    scene.footprint(at.x - 2, at.y - 1, 4, 2, 4);
    placed++;
  }
  return placed;
}

/** A street name board on two posts at each shortcut's mouth. */
export function placeShortcutBoards(ctx: BakeContext, scene: Scene, out: LightOut): number {
  let placed = 0;
  ctx.def.shortcuts.forEach((sc, k) => {
    const br = ctx.track.branches[k + 1];
    if (!br) return;
    const name = sc.signName.toUpperCase();
    const tw = textWidth(name, 'micro', 1);
    const w = tw + 8;
    const cv = Canvas.sprite(w, 18);
    cv.rect(0, 0, w, 9, PAL.ink);
    cv.rect(1, 1, w - 2, 7, col('#2F5A46'));
    cv.hline(1, 1, w - 2, col('#4E8A6A'));
    drawText(cv, 4, 2, name, PAL.ivory, 'micro', 1);
    for (const px of [2, w - 4]) {
      cv.vline(px, 9, 9, PAL.steelLight);
      cv.vline(px + 1, 9, 9, PAL.steelDark);
    }
    const p = sampleBranch(br, 34);
    for (const side of [-1, 1]) {
      const nx = -p.ty * side;
      const ny = p.tx * side;
      const reach = p.halfWidth + p.shoulder + 3;
      const extra = ny > 0.4 ? cv.h * ny : 0;
      const at = standPoint(
        scene,
        p.x + nx * (reach + extra),
        p.y + ny * (reach + extra),
        nx,
        ny,
        cv,
        w >> 1,
        17,
      );
      if (!at) continue;
      scene.add({ art: cv, x: at.x - (w >> 1), y: at.y - 17, baseY: at.y });
      scene.footprint(at.x - (w >> 1) + 2, at.y - 1, w - 4, 2, 3);
      out.pools.push({ x: at.x, y: at.y + 4, radii: [10, 16], tint: TINT_WARM });
      placed++;
      break;
    }
  });
  return placed;
}

/** Twin lamps at the boulevard's lamp anchors, behind the north barrier. */
export function boulevardLamps(ctx: BakeContext, scene: Scene, out: LightOut): void {
  for (const a of anchor(ctx, 'boulevard_lamps')) {
    const sp = lampTwin();
    let y = Math.round(a.y);
    const x = Math.round(a.x);
    while (y > a.y - 10 && !scene.spriteFits(sp, x, y)) y--;
    if (!scene.spriteFits(sp, x, y)) continue;
    scene.add({ art: sp.art, x: x - sp.ax, y: y - sp.ay, baseY: y + 4 });
    scene.footprint(x - 1, y - 1, 3, 2, 5);
    out.pools.push({ x, y: y + 38, radii: [36, 66], tint: TINT_WARM });
    out.lights.push({ x, y: y - sp.ay + 4, radius: 66, color: TINT_HEX[TINT_WARM]!, intensity: 1 });
  }
}

const CLOTH: readonly Color[] = [
  col('#F2EADA'),
  col('#D8443C'),
  col('#5A86C4'),
  col('#E8B23A'),
  col('#7CB06A'),
  col('#E58FA8'),
  col('#C9C2B6'),
];

type Garment = { w: number; h: number; c: Color; shirt: boolean };

function garments(len: number, seed: number): Array<Garment & { at: number }> {
  const rnd = mulberry32(seed);
  const out: Array<Garment & { at: number }> = [];
  let at = 4;
  while (at < len - 8) {
    const shirt = rnd() < 0.45;
    const g = {
      w: shirt ? 7 : 4 + ((rnd() * 5) | 0),
      h: shirt ? 6 : 4 + ((rnd() * 4) | 0),
      c: CLOTH[(rnd() * CLOTH.length) | 0]!,
      shirt,
      at,
    };
    out.push(g);
    at += g.w + 2 + ((rnd() * 5) | 0);
  }
  return out;
}

/** One garment hanging from a line, its top at (x, y). */
function hang(cv: Canvas, x: number, y: number, g: Garment, swing: number): void {
  for (let yy = 0; yy < g.h; yy++)
    for (let xx = 0; xx < g.w; xx++) {
      if (g.shirt && yy >= 2 && (xx === 0 || xx === g.w - 1)) continue;
      const dx = yy >= g.h - 2 ? swing : 0;
      const c =
        yy === 0 ? lighter(g.c, 0.2) : xx === g.w - 1 || yy === g.h - 1 ? darker(g.c, 0.25) : g.c;
      cv.set(x + xx + dx, y + yy, c);
    }
  cv.set(x + 1, y, PAL.steelHi);
  cv.set(x + g.w - 2, y, PAL.steelHi);
}

/**
 * A washing line strung east-west across a north-south street, clothes hanging below it, or
 * north-south across an east-west one (the garments then hang along it). It is at height over
 * the street, so it is a fading overlay; `swing` moves the hems for the animated frames.
 */
function laundryArt(len: number, seed: number, swing: number, across: boolean): Canvas {
  const items = garments(len, seed);
  if (across) {
    const cv = Canvas.sprite(len + 2, 12);
    for (let x = 0; x <= len; x++)
      cv.set(x, 1 + (Math.abs(x - len / 2) < len / 3 ? 1 : 0), PAL.inkSoft);
    for (const g of items) hang(cv, g.at, 2, g, ((g.at >> 3) + swing) % 2);
    return cv;
  }
  const cv = Canvas.sprite(14, len + 10);
  for (let y = 0; y <= len; y++) cv.set(3, y, PAL.inkSoft);
  for (const g of items) {
    const t = { ...g, w: g.h, h: g.w };
    hang(cv, 3, g.at, { ...t, shirt: false }, swing % 2);
  }
  return cv;
}

export const LAUNDRY_RISE = 32;

/**
 * Laundry: the anchor's line across Laundry Lane, animated, and more lines strung east-west
 * across the lane's north leg and across Bakers Row between its barricades (never over a
 * barricade or its stripes).
 */
export function laundryLines(ctx: BakeContext, scene: Scene): AnimatedArt[] {
  const out: AnimatedArt[] = [];
  const pts = anchor(ctx, 'laundry_lines');
  const rise = Math.round(LAUNDRY_RISE * 0.62);
  const avoid = [
    ...ctx.track.obstacles.map((o) => ({ x: o.x, y: o.y })),
    ...ctx.def.walls.flatMap((wl) => wl.points),
    ...ctx.def.anchors.filter((a) => a.kind === 'warning').flatMap((a) => a.points),
  ];
  if (pts.length >= 2) {
    const x = Math.round(pts[0]!.x);
    const y0 = Math.round(Math.min(pts[0]!.y, pts[1]!.y));
    const len = Math.round(Math.abs(pts[1]!.y - pts[0]!.y));
    out.push({
      id: 'laundry_sway',
      kind: 'laundry',
      frames: [0, 1, 2, 1].map((f) => laundryArt(len, 991, f, false)),
      x: x - 3,
      y: y0 - rise,
      fps: 3,
      above: true,
      blend: 'normal',
    });
  }
  let k = 1;
  for (const b of ctx.track.branches.slice(1)) {
    for (let s = 50; s < b.length - 50; s += 64) {
      const p = sampleBranch(b, s);
      if (Math.abs(p.ty) < 0.95) continue;
      if (avoid.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 46)) continue;
      // From wall to wall across the street.
      let x0 = Math.round(p.x);
      let x1 = x0;
      const y = Math.round(p.y);
      while (x0 > 0 && ctx.field.edge[y * scene.w + x0]! <= 0) x0--;
      while (x1 < scene.w - 1 && ctx.field.edge[y * scene.w + x1]! <= 0) x1++;
      x0 -= 6;
      x1 += 6;
      const art = laundryArt(x1 - x0, 1200 + k * 53, 0, true);
      scene.add({
        art,
        x: x0,
        y: y - rise,
        baseY: y + 2,
        overlay: { id: `laundry_line_${k}`, kind: 'laundry', fade: true },
      });
      scene.shadeRect(x0 + 4, y + 2, x1 - x0, 4);
      k++;
    }
  }
  return out;
}

/** The cafe awning at its anchor: striped canvas over the sidewalk, an overlay that fades. */
export function cafeAwning(ctx: BakeContext, scene: Scene, out: LightOut): void {
  const a = anchor(ctx, 'cafe_awning')[0];
  if (!a) return;
  const x = Math.round(a.x);
  let y = Math.round(a.y);
  // Down to the collision edge: the awning hangs off the wall standing there.
  while (y < scene.h - 1 && ctx.field.edge[(y + 1) * scene.w + x]! > 0) y++;
  const w = 44;
  const cv = Canvas.sprite(w, 12);
  for (let xx = 0; xx < w; xx++) {
    const c = (Math.floor(xx / 4) & 1) === 0 ? PAL.kerbCoral : PAL.kerbIvory;
    for (let yy = 0; yy < 7; yy++)
      cv.set(xx, yy, yy < 2 ? lighter(c, 0.2) : yy > 5 ? darker(c, 0.3) : c);
    if (xx % 4 !== 3) cv.set(xx, 7, darker(c, 0.4));
  }
  emissive(cv, () =>
    drawText(cv, (w - textWidth('CAFE', 'micro', 1)) >> 1, 1, 'CAFE', PAL.ink, 'micro', 1),
  );
  scene.add({
    art: cv,
    x: x - (w >> 1),
    y: y - 6,
    baseY: y + 8,
    overlay: { id: 'cafe_awning', kind: 'awning', fade: true },
  });
  scene.shadeRect(x - (w >> 1) + 2, y + 2, w, 6);
  out.pools.push({ x, y: y + 6, radii: [14, 24], tint: TINT_WARM, squashY: 1.6 });
}

/** The start banner: a cloth across the boulevard between two poles, an overlay. */
export function startBanner(ctx: BakeContext, scene: Scene, out: LightOut): void {
  const p = sampleBranch(ctx.track.main, ctx.track.startS);
  const x = Math.round(p.x);
  const edge = ctx.field.edge;
  let yN = Math.round(p.y);
  while (yN > 0 && edge[yN * scene.w + x]! <= 0) yN--;
  let yS = Math.round(p.y);
  while (yS < scene.h - 1 && edge[yS * scene.w + x]! <= 0) yS++;
  const RISE = 40;
  const rise = Math.round(RISE * 0.62);
  const top = yN - rise - 10;
  const H = yS + 6 - top;
  const cv = Canvas.sprite(28, H);
  // Poles.
  for (const gy of [yN - 2, yS + 4]) {
    for (let v = 0; v <= rise + 4; v++) {
      cv.set(4, gy - top - v, PAL.steelLight);
      cv.set(5, gy - top - v, PAL.steelDark);
    }
    cv.rect(2, gy - top - 1, 6, 3, PAL.steelDark);
  }
  // The cloth hangs between them, the length of the road, upright text along it.
  const c0 = yN - rise + 2 - top;
  const c1 = yS - rise + 2 - top;
  for (let y = c0; y < c1; y++)
    for (let xx = 6; xx < 22; xx++) {
      const edge = xx === 6 || xx === 21;
      const check = ((Math.floor((y - c0) / 4) + Math.floor(xx / 4)) & 1) === 0;
      const c: Color = edge
        ? PAL.ink
        : y - c0 < 8 || c1 - y <= 8
          ? check
            ? PAL.paintBright
            : PAL.ink
          : col('#B8343A');
      cv.set(xx, y, c);
    }
  drawText(cv, 11, c1 - 12, 'START', PAL.ivory, 'chunky', 1, 1);
  scene.addSplit(
    { art: cv, x: x - 14, y: top, baseY: yS + 5 },
    { id: 'start_banner', kind: 'banner', fade: true },
  );
  out.pools.push({ x: x - 30, y: p.y, radii: [30, 54], tint: TINT_WARM });
}

/** A hand-painted hoarding at the billboard anchor, standing behind the barrier. */
export function marketHoarding(ctx: BakeContext, scene: Scene): void {
  const a = anchor(ctx, 'billboard_market')[0];
  if (!a) return;
  const w = 42;
  const cv = Canvas.sprite(w + 4, 34);
  billboard(cv, 1, 31, w, mulberry32(42));
  const at = standPoint(scene, a.x + 8, a.y, 1, 0, cv, 1, 31, 0);
  if (!at) return;
  scene.add({ art: cv, x: at.x - 1, y: at.y - 31, baseY: at.y });
  scene.footprint(at.x, at.y - 2, w, 3, 4);
}

/** The traffic light at its anchor: a pole behind the barrier and a three-light head. */
export function trafficLight(ctx: BakeContext, scene: Scene): { x: number; y: number } | null {
  const a = anchor(ctx, 'traffic_light_signal')[0];
  if (!a) return null;
  const cv = Canvas.sprite(7, 24);
  cv.vline(3, 16, 8, PAL.steelLight);
  cv.vline(4, 16, 8, PAL.steelDark);
  drawSignal(cv, 0, 0, 4);
  const at = standPoint(scene, a.x, a.y, 1, 0, cv, 3, 23, 0);
  if (!at) return null;
  scene.add({ art: cv, x: at.x - 3, y: at.y - 23, baseY: at.y });
  scene.footprint(at.x - 1, at.y - 1, 3, 2, 4);
  return { x: at.x - 3, y: at.y - 23 };
}

export function trafficLoop(site: { x: number; y: number }): AnimatedArt {
  const cycle = [4, 4, 4, 4, 2, 1, 1, 1, 3];
  return {
    id: 'traffic_light_market',
    kind: 'traffic_light',
    frames: cycle.map((lit) => {
      const cv = new Canvas(7, 16);
      drawSignal(cv, 0, 0, lit);
      return cv;
    }),
    x: site.x,
    y: site.y,
    fps: 1,
    above: false,
    blend: 'normal',
  };
}

/** The lot nearest a point that can carry a rooftop sign of `width`. */
export function lotNear(layout: CityLayout, x: number, y: number, width: number): Lot | null {
  let best: Lot | null = null;
  let bestD = Infinity;
  for (const lot of layout.lots) {
    if (!lot || lot.tag || lot.w < width + 12 || lot.h < 16 || lot.tower > 0) continue;
    const d = Math.hypot(lot.x + lot.w / 2 - x, lot.y + lot.h / 2 - y);
    if (d < bestD) {
      bestD = d;
      best = lot;
    }
  }
  return best;
}
