import { hash2, mulberry32 } from '@bolt/shared';
import type { BakeContext } from '../biome.js';
import { Canvas, col, mixc } from '../canvas.js';
import type { Color } from '../canvas.js';
import { drawText, textWidth } from '../font.js';
import { leanOf } from '../oblique.js';
import type { Scene } from '../oblique.js';
import type { Rect } from '../city/layout.js';
import { BUILDINGS, LIVERIES, PAL, darker, lighter } from '../city/palette.js';
import type { LightOut } from '../city/props.js';
import { BARRIER_REACH } from '../city/road.js';
import { containerSprite, emissive } from '../city/sprites.js';
import { IND, TINT_AMBER, TINT_MOLTEN, TINT_SODIUM } from './style.js';

/**
 * Steel Circuit's landmarks, each placed from its anchor: the water tower by the west road,
 * the smelter stacks south of Smelter Hall, the gantry crane over the container yard, the
 * conveyor bridge over Conveyor Gap (its pillars are the track's own obstacles), the dock with
 * its quay crane and a ship alongside, and the furnace whose mouth glows into Smelter Hall.
 */

export const anchorPt = (ctx: BakeContext, id: string, k = 0): { x: number; y: number } => {
  const p = ctx.def.anchors.find((a) => a.id === id)?.points[k];
  if (!p) throw new Error(`industrial painter: no anchor ${id}`);
  return { x: Math.round(p.x), y: Math.round(p.y) };
};

/** Free ground: walk from a point in a direction until the road and its barrier are clear. */
export function clearOf(
  ctx: BakeContext,
  x: number,
  y: number,
  dx: number,
  dy: number,
  margin: number,
): { x: number; y: number } {
  let px = x;
  let py = y;
  const { field } = ctx;
  for (let k = 0; k < 400; k++) {
    const i = Math.round(py) * field.w + Math.round(px);
    if (field.edge[i]! > margin) return { x: Math.round(px), y: Math.round(py) };
    px += dx;
    py += dy;
  }
  return { x: Math.round(px), y: Math.round(py) };
}

// --- Water tower ---------------------------------------------------------------------------

export function paintWaterTower(scene: Scene, x: number, y: number, out: LightOut): void {
  const R = 18;
  const legs = 48;
  const tankH = 22;
  const total = legs + tankH + 8;
  const lean = leanOf(total);
  const cv = Canvas.sprite(2 * R + lean + 10, 2 * R + total + 8);
  const ox = x - R - 4;
  const oy = y - R - total - 4;
  const b = BUILDINGS[5]!;
  // Four lattice legs from the corners of the footprint up to the tank.
  const feet: Array<[number, number]> = [
    [-R + 4, -R + 6],
    [R - 4, -R + 6],
    [-R + 4, R - 4],
    [R - 4, R - 4],
  ];
  for (const [fx, fy] of feet) {
    for (let v = 0; v < legs; v++) {
      const px = x + fx * (1 - v / (legs * 3)) + leanOf(v) - ox;
      const py = y + fy - v - oy;
      cv.set(Math.round(px), py, fx < 0 ? PAL.steelLight : PAL.steelDark);
      cv.set(Math.round(px) + 1, py, PAL.steelDark);
    }
  }
  // Cross bracing.
  for (const v of [14, 30]) {
    const yl = y + R - 4 - v - oy;
    cv.line(x - R + 4 + leanOf(v) - ox, yl, x + R - 4 + leanOf(v + 12) - ox, yl - 12, PAL.steel);
    cv.line(x - R + 4 + leanOf(v + 12) - ox, yl - 12, x + R - 4 + leanOf(v) - ox, yl, PAL.steel);
  }
  // The tank: a drum from `legs` up, a conical cap.
  for (let v = legs; v <= legs + tankH; v++)
    for (let dx = -R; dx <= R; dx++) {
      const dy = Math.round(Math.sqrt(Math.max(0, R * R - dx * dx)));
      const t = dx / R;
      let c: Color = t < -0.55 ? b.edge : t < -0.1 ? b.west : t < 0.45 ? b.wall : b.wallLow;
      if (v === legs) c = PAL.ink;
      if ((v - legs) % 7 === 3) c = darker(c, 0.18);
      cv.set(x + dx + leanOf(v) - ox, y + dy - v - oy, c);
    }
  drawText(
    cv,
    x - 8 + leanOf(legs + 8) - ox,
    y + R - legs - 15 - oy,
    'NO 2',
    IND.hazardYellowDim,
    'micro',
    1,
  );
  for (let k = 0; k <= 8; k++) {
    const rr = R * (1 - k / 8);
    const v = legs + tankH + k;
    for (let dy = -rr; dy <= rr; dy++)
      for (let dx = -rr; dx <= rr; dx++) {
        if (dx * dx + dy * dy > rr * rr) continue;
        cv.set(
          Math.round(x + dx + leanOf(v) - ox),
          Math.round(y + dy - v - oy),
          dx + dy < 0 ? b.rim : b.roofLine,
        );
      }
  }
  emissive(cv, () => cv.set(x + leanOf(total) - ox, y - total - oy, PAL.red));
  scene.add({ art: cv, x: ox, y: oy, baseY: y + R });
  scene.solid(x - R, y - R, 2 * R, 2 * R, legs + tankH);
  scene.footprint(x - R, y - R, 2 * R, 2 * R, 6);
  out.lights.push({ x: x + lean, y: y - total, radius: 30, color: '#D83F49', intensity: 0.3 });
}

// --- Chimney stacks ------------------------------------------------------------------------

export function paintStack(
  scene: Scene,
  cx: number,
  cy: number,
  R: number,
  rise: number,
): { x: number; y: number } {
  scene.solid(cx - R, cy - R, 2 * R, 2 * R, rise);
  const lean = leanOf(rise);
  const brick = BUILDINGS[4]!;
  scene.later(() => {
    const cv = Canvas.solid(2 * R + lean + 6, 2 * R + rise + 6);
    const ox = cx - R - 2;
    const oy = cy - R - rise - 3;
    cv.curKey = cy + R;
    for (let v = 0; v <= rise; v++) {
      const rr = R - Math.floor((v / rise) * 3);
      for (let dx = -rr; dx <= rr; dx++) {
        const dy = Math.round(Math.sqrt(Math.max(0, rr * rr - dx * dx)));
        const t = dx / rr;
        let c: Color =
          t < -0.55 ? brick.edge : t < -0.1 ? brick.west : t < 0.45 ? brick.wall : brick.wallLow;
        if (v % 4 === 3) c = darker(c, 0.12);
        if (v > rise - 14 && v < rise - 4)
          c = (Math.floor((dx + v) / 3) & 1) === 0 ? IND.hazardYellow : IND.hazardBlack;
        if (scene.shaded(cx + dx, cy + dy, v)) c = mixc(c, brick.deep, 0.4);
        cv.set(cx + dx + leanOf(v) - ox, cy + dy - v - oy, v === 0 ? PAL.ink : c);
      }
    }
    // Open top: a dark flue inside a lit rim.
    const tx = cx + lean - ox;
    const ty = cy - rise - oy;
    const rr = R - 3;
    for (let dy = -rr; dy <= rr; dy++)
      for (let dx = -rr; dx <= rr; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > rr + 0.35) continue;
        cv.set(
          tx + dx,
          ty + dy,
          d > rr - 1.5
            ? dx + dy < 0
              ? brick.rim
              : brick.trim
            : d > rr - 3
              ? brick.inner
              : PAL.ink,
        );
      }
    scene.add({ art: cv, x: ox, y: oy, baseY: cy + R });
  });
  return { x: cx + lean, y: cy - rise - 4 };
}

// --- Gantry crane over the container yard -----------------------------------------------------

/** Rows of stacked containers in a yard, back to front. */
export function containerRows(scene: Scene, r: Rect, seed: number): void {
  const rnd = mulberry32(seed);
  for (let y = r.y + 30; y < r.y + r.h - 4; y += 22)
    for (let x = r.x + 4; x + 30 < r.x + r.w - 4; x += 33) {
      if (rnd() < 0.18) continue;
      const sp = containerSprite(true, LIVERIES[(rnd() * LIVERIES.length) | 0]!, rnd() < 0.5);
      if (!scene.spriteFits(sp, x + sp.ax, y)) continue;
      scene.place(sp, x + sp.ax, y);
      scene.footprint(x, y - 13, 30, 13, 6);
    }
}

export const GANTRY_RISE = 56;

/**
 * A rail-mounted gantry crane spanning the yard north to south: two portal legs on rails, a
 * box girder at height with a trolley and a hanging load. Where its height leans it over the
 * yard road on screen it is split into a fading overlay.
 */
export function paintGantry(
  scene: Scene,
  x: number,
  yN: number,
  yS: number,
  out: LightOut,
): { x: number; y: number } {
  const R = GANTRY_RISE;
  const lean = leanOf(R);
  const W = 40;
  const top = yN - R - 8;
  const cv = Canvas.sprite(W + lean + 8, yS - top + 6);
  const X = (wx: number): number => wx - x + 4;
  const Y = (wy: number): number => wy - top;
  const yel = col('#D9A63E');
  const yelDk = col('#8C6628');
  // Legs: an A-frame at each end, both sides.
  for (const gy of [yN, yS])
    for (const gx of [x, x + W - 4]) {
      for (let v = 0; v <= R; v++) {
        const px = X(gx) + leanOf(v);
        cv.set(px, Y(gy) - v, gx === x ? lighter(yel, 0.2) : yel);
        cv.set(px + 1, Y(gy) - v, yel);
        cv.set(px + 2, Y(gy) - v, yelDk);
      }
      cv.rect(X(gx) - 2, Y(gy) - 1, 8, 3, PAL.steelDark);
    }
  // Girders along the span, at height, both sides; and the end beams.
  for (let wy = yN; wy <= yS; wy++) {
    for (const gx of [x, x + W - 4]) {
      const px = X(gx) + lean;
      cv.set(px, Y(wy) - R, lighter(yel, 0.25));
      cv.set(px + 1, Y(wy) - R, yel);
      cv.set(px + 2, Y(wy) - R, yel);
      cv.set(px + 3, Y(wy) - R, yelDk);
      if ((wy - yN) % 10 === 0) cv.set(px + 1, Y(wy) - R + 1, yelDk);
    }
  }
  for (const gy of [yN, yS])
    for (let k = 0; k < W; k++)
      cv.set(X(x) + lean + k, Y(gy) - R, k === 0 ? lighter(yel, 0.25) : yel);
  // Trolley and hoist with a container on the hook.
  const ty = Math.round((yN + yS) / 2);
  cv.rect(X(x) + lean + 2, Y(ty) - R - 4, W - 4, 9, PAL.steelDark);
  cv.hline(X(x) + lean + 2, Y(ty) - R - 4, W - 4, PAL.steelLight);
  emissive(cv, () => cv.set(X(x) + lean + 4, Y(ty) - R - 2, PAL.amber));
  for (let v = 20; v < R - 2; v++) cv.set(X(x) + 18 + leanOf(v), Y(ty) - v, PAL.inkSoft);
  const load = containerSprite(true, LIVERIES[2]!, false);
  cv.blit(load.art, X(x) + 18 + leanOf(16) - load.ax, Y(ty) - 16 - load.ay + 6);
  scene.addSplit(
    { art: cv, x: x - 4, y: top, baseY: yS + 2 },
    { id: 'gantry_crane', kind: 'crane', fade: true },
  );
  for (const gy of [yN, yS]) scene.footprint(x - 2, gy - 1, W + 4, 3, 10);
  scene.shadeRect(x + 10, ty + 8, W, 12);
  out.pools.push({ x: x + W / 2, y: ty + 10, radii: [20, 40], tint: TINT_AMBER });
  out.lights.push({ x: x + lean + 4, y: ty - R, radius: 44, color: '#FFB454', intensity: 0.6 });
  return { x: x + lean + 2, y: ty - R - 6 };
}

// --- Conveyor bridge -----------------------------------------------------------------------

export const BRIDGE_RISE = 44;

/**
 * The conveyor gallery over Conveyor Gap, carried by the gap's two pillars (the shortcut's
 * obstacles). The gallery and the pillar shafts reach over drivable ground on screen, so they
 * are fading overlays, in three pieces so each fades only near the car; the pillar bases stand
 * inside their own collision discs on the ground layer.
 */
export function paintConveyorBridge(
  ctx: BakeContext,
  scene: Scene,
  x0: number,
  x1: number,
  yLine: number,
  out: LightOut,
): void {
  let y = yLine;
  const R = Math.round(BRIDGE_RISE * 0.62);
  const lean = leanOf(R);
  // The gallery is a transfer house as deep as the pillars that carry it are apart.
  const pillars = ctx.track.obstacles.filter((o) => o.kind === 'pillar' && o.id.startsWith('gap'));
  const pY0 = pillars.length ? Math.min(...pillars.map((o) => o.y)) - 6 : y - 6;
  const pY1 = pillars.length ? Math.max(...pillars.map((o) => o.y)) + 6 : y + 6;
  const D = Math.round(pY1 - pY0);
  y = Math.round(pY0);
  const b = BUILDINGS[0]!;
  const pieces = 3;
  const step = Math.ceil((x1 - x0) / pieces);
  for (let k = 0; k < pieces; k++) {
    const a = x0 + k * step;
    const e = Math.min(x1, a + step);
    const cv = Canvas.sprite(e - a + lean + 2, D + 12);
    for (let wx = a; wx < e; wx++) {
      const lx = wx - a + lean;
      // Roof of the gallery: ribbed sheet, lit north edge.
      for (let dy = 0; dy < D; dy++) {
        let c: Color =
          dy === 0 ? b.rim : dy === D - 1 ? b.trim : wx % 4 === 0 ? b.roofLine : b.roof;
        // An open belt down the middle of the deck, between two walkways.
        const mid = D >> 1;
        if (Math.abs(dy - mid) <= 2)
          c = Math.abs(dy - mid) === 2 ? PAL.steelDark : wx % 6 === 0 ? PAL.steel : 0x2e3442;
        else if (Math.abs(dy - mid) === 3) c = IND.hazardYellowDim;
        cv.set(lx, dy, c);
      }
      // South face: the truss side with the belt glimpsed through it.
      for (let v = 0; v < 8; v++) {
        const m = (wx - a) % 10;
        let c: Color =
          v === 0 ? b.trim : v === 7 ? PAL.ink : m === v || m === 9 - v ? PAL.steel : PAL.inkSoft;
        if (v === 3 && (wx >> 1) % 3 === 0) c = IND.hazardYellowDim;
        cv.set(lx - leanOf(v), D + v, c);
      }
    }
    scene.add({
      art: cv,
      x: a,
      y: y - R - D,
      baseY: y + 4,
      overlay: { id: `conveyor_bridge_${k}`, kind: 'conveyor_bridge', fade: true },
    });
  }
  scene.shadeRect(x0 + 8, y + 2, x1 - x0, D);
  // The pillars: concrete with hazard bands; the base inside the disc, the shaft an overlay.
  for (const ob of ctx.track.obstacles.filter((o) => o.kind === 'pillar')) {
    const px = Math.round(ob.x);
    const py = Math.round(ob.y);
    const r = Math.floor(ob.radius) - 1;
    const base = Canvas.sprite(2 * r + 2, 2 * r + 4);
    base.disc(r, r + 2, r, PAL.kerbShade);
    base.disc(r, r, r, PAL.kerb);
    base.disc(r - 1, r - 1, r - 2, PAL.kerbHi);
    for (let k = -r; k <= r; k++) if ((k + 20) % 4 < 2) base.set(r + k, r + 2, IND.hazardYellow);
    scene.add({ art: base, x: px - r, y: py - r - 1, baseY: py + r });
    const shaftH = R;
    const shaft = Canvas.sprite(2 * r + leanOf(R) + 2, shaftH);
    for (let v = 0; v < shaftH; v++)
      for (let dx = -r + 1; dx < r; dx++) {
        const band = v < 6 && (Math.floor((dx + v) / 2) & 1) === 0;
        shaft.set(
          r + dx + leanOf(v),
          shaftH - 1 - v,
          band
            ? IND.hazardYellow
            : dx < -r / 3
              ? PAL.kerbHi
              : dx > r / 3
                ? PAL.kerbShade
                : PAL.kerb,
        );
      }
    scene.add({
      art: shaft,
      x: px - r,
      y: py - shaftH,
      baseY: py + r,
      overlay: { id: `${ob.id}_shaft`, kind: 'pillar', fade: true },
    });
  }
  out.pools.push({ x: (x0 + x1) / 2, y: y + 8, radii: [24, 44], tint: TINT_AMBER, squashY: 1.6 });
}

// --- The dock --------------------------------------------------------------------------------

/** Quay furniture on the apron, a quay crane, and a ship alongside. */
export function paintDock(
  ctx: BakeContext,
  scene: Scene,
  quayX: number,
  waterX: number,
  y0: number,
  y1: number,
  out: LightOut,
): { conveyor: Rect } {
  const { world } = ctx;
  // Quay edge: a granite coping with mooring bollards and a yellow safety line.
  for (let y = y0; y < y1; y++) {
    for (let k = 0; k < 4; k++)
      world.set(
        waterX - 4 + k,
        y,
        k === 3 ? PAL.ink : k === 0 ? IND.hazardYellowDim : IND.graniteLight,
      );
  }
  for (let y = y0 + 20; y < y1 - 10; y += 70) {
    const cv = Canvas.sprite(6, 7);
    cv.disc(3, 3, 2.6, PAL.steelDark);
    cv.disc(2.6, 2.6, 1.6, PAL.steel);
    cv.hline(1, 6, 4, PAL.ink);
    scene.add({ art: cv, x: waterX - 10, y: y - 6, baseY: y });
  }
  // A ground conveyor along the apron feeding the ship loader.
  const conveyor = { x: quayX + 30, y: y0 + 90, w: 8, h: Math.min(420, y1 - y0 - 180) };
  // The ship: a long hull alongside, deck hatches, the bridge house aft.
  const rnd = mulberry32(77);
  const hx = waterX + 10;
  const hw = Math.min(150, world.w - hx - 6);
  const shipY0 = y0 + 40;
  const shipY1 = y1 - 40;
  const hull = col('#5A2B36');
  const hullHi = col('#8C4652');
  const deck = col('#3A4458');
  const deckLine = col('#2E3648');
  const ship = Canvas.sprite(hw + 6, shipY1 - shipY0 + 20);
  const sy = (wy: number): number => wy - shipY0;
  for (let wy = shipY0; wy < shipY1; wy++) {
    const t = Math.min(wy - shipY0, shipY1 - wy) / 60;
    const inset = t < 1 ? Math.round((1 - Math.sqrt(t)) * hw * 0.3) : 0;
    for (let lx = inset; lx < hw - inset; lx++) {
      let c: Color = deck;
      if (lx === inset || lx === hw - inset - 1) c = lx === inset ? hullHi : hull;
      else if (lx === inset + 1) c = PAL.steelLight;
      else if (
        (wy - shipY0) % 70 > 8 &&
        (wy - shipY0) % 70 < 60 &&
        lx > hw * 0.18 &&
        lx < hw * 0.82
      ) {
        const hatch = Math.floor((wy - shipY0) / 70) % LIVERIES.length;
        c =
          (wy - shipY0) % 70 === 9 || (wy - shipY0) % 70 === 59
            ? deckLine
            : (lx + wy) % 5 === 0
              ? darker(LIVERIES[hatch]!, 0.3)
              : darker(LIVERIES[hatch]!, 0.15);
      } else if (lx % 16 === 0) c = deckLine;
      ship.set(lx, sy(wy), c);
    }
  }
  // Hull side at the south end, the freeboard seen above the water.
  for (let lx = 6; lx < hw - 6; lx++)
    for (let v = 0; v < 8; v++)
      ship.set(lx, sy(shipY1) + v, v < 2 ? hullHi : v === 7 ? PAL.ink : hull);
  // Bridge house aft.
  const bh = { x: Math.round(hw * 0.2), y: shipY1 - 120, w: Math.round(hw * 0.6), h: 46 };
  for (let ly = 0; ly < bh.h; ly++)
    for (let lx = 0; lx < bh.w; lx++)
      ship.set(
        bh.x + lx,
        sy(bh.y) + ly,
        ly === 0 || lx === 0
          ? PAL.kerbIvory
          : (lx + ly) % 9 === 0
            ? PAL.kerbIvoryDark
            : col('#D8D2C4'),
      );
  emissive(ship, () => {
    for (let lx = 3; lx < bh.w - 3; lx += 5)
      ship.rect(bh.x + lx, sy(bh.y) + bh.h - 6, 3, 2, rnd() < 0.6 ? PAL.windowWarm : PAL.windowMid);
    ship.set(hw >> 1, sy(shipY0) + 6, PAL.red);
    ship.set(hw >> 1, sy(shipY1) - 4, PAL.mint);
  });
  scene.add({ art: ship, x: hx, y: shipY0, baseY: shipY1 + 8 });
  out.pools.push({ x: hx + hw / 2, y: bh.y + bh.h + 6, radii: [16, 30], tint: TINT_SODIUM });
  // Quay lamps.
  for (let y = y0 + 40; y < y1; y += 140) {
    const cv = Canvas.sprite(5, 24);
    cv.vline(2, 4, 19, PAL.steelLight);
    cv.vline(3, 4, 19, PAL.steelDark);
    cv.hline(0, 23, 5, PAL.ink);
    emissive(cv, () => {
      cv.rect(0, 0, 5, 3, PAL.lampGlow);
      cv.hline(1, 0, 3, PAL.lamp);
    });
    const lx = quayX + 14;
    if (!scene.artFits(cv, lx - 2, y - 23)) continue;
    scene.add({ art: cv, x: lx - 2, y: y - 23, baseY: y });
    out.pools.push({ x: lx + 10, y: y + 6, radii: [26, 48], tint: TINT_SODIUM });
    out.lights.push({ x: lx, y: y - 22, radius: 48, color: '#FFC47A', intensity: 0.8 });
  }
  void hash2;
  return { conveyor };
}

// --- The furnace in Smelter Hall ---------------------------------------------------------------

/**
 * The furnace on the north side of Smelter Hall: a brick mass whose open mouth faces the road
 * and pours molten light onto it. Returns the mouth's box for the glow loop.
 */
export function paintFurnace(
  ctx: BakeContext,
  scene: Scene,
  ax: number,
  ay: number,
  out: LightOut,
): Rect {
  const at = clearOf(ctx, ax, ay, 0, -1, BARRIER_REACH + 2);
  const w = 56;
  const d = 30;
  const x = at.x - (w >> 1);
  const y = at.y - d;
  const rise = Math.max(8, Math.min(40, scene.maxRise(x, y, w, d, 40)));
  const brick = BUILDINGS[1]!;
  const cv = Canvas.sprite(w + leanOf(rise) + 2, d + rise);
  for (let ly = 0; ly < d; ly++)
    for (let lx = 0; lx < w; lx++)
      cv.set(
        lx + leanOf(rise),
        ly,
        lx === 0 || ly === 0 ? brick.rim : (lx + ly * 3) % 11 === 0 ? brick.roofLine : brick.roof,
      );
  for (let v = 0; v < rise; v++)
    for (let lx = 0; lx < w; lx++) {
      const yy = d + rise - 1 - v;
      let c: Color =
        v % 4 === 3 ? brick.wallAlt : (lx + (v >> 2) * 3) % 8 === 0 ? brick.wallAlt : brick.wall;
      if (v === 0) c = PAL.ink;
      cv.set(lx + leanOf(v), yy, c);
    }
  // The mouth: an arched opening full of molten light (the glow loop plays over it).
  const mouth = { x: x + 14, y: y + d - 18, w: 28, h: 14 };
  emissive(cv, () => {
    for (let yy = 0; yy < mouth.h; yy++)
      for (let xx = 0; xx < mouth.w; xx++) {
        const arch = Math.abs(xx - mouth.w / 2) > mouth.w / 2 - Math.min(4, yy);
        if (arch) continue;
        cv.set(
          mouth.x - x + xx + leanOf(Math.max(0, 16 - yy)),
          mouth.y - (y - rise) + yy,
          yy < 3 ? IND.moltenDark : yy < 7 ? IND.moltenMid : IND.molten,
        );
      }
  });
  scene.add({ art: cv, x, y: y - rise, baseY: y + d });
  scene.solid(x, y, w, d, rise);
  out.pools.push({ x: at.x, y: at.y + 34, radii: [26, 50, 72], tint: TINT_MOLTEN, squashY: 1.2 });
  out.lights.push({ x: at.x, y: at.y + 10, radius: 90, color: '#F06A24', intensity: 1 });
  return { x: mouth.x, y: mouth.y, w: mouth.w + 6, h: mouth.h };
}

/** A warning board on two posts, hazard striped, standing at a telegraph anchor's side. */
export function warningBoard(scene: Scene, x: number, y: number, text: string): boolean {
  const tw = textWidth(text, 'micro', 1);
  const w = tw + 8;
  const cv = Canvas.sprite(w, 18);
  cv.rect(0, 0, w, 9, IND.hazardBlack);
  for (let k = 0; k < w; k++) cv.set(k, 0, (k >> 1) % 2 === 0 ? IND.hazardYellow : IND.hazardBlack);
  for (let k = 0; k < w; k++) cv.set(k, 8, (k >> 1) % 2 === 0 ? IND.hazardYellow : IND.hazardBlack);
  emissive(cv, () => drawText(cv, 4, 2, text, IND.hazardYellow, 'micro', 1));
  for (const px of [2, w - 4]) {
    cv.vline(px, 9, 9, PAL.steelLight);
    cv.vline(px + 1, 9, 9, PAL.steelDark);
  }
  if (!scene.artFits(cv, x - (w >> 1), y - 17)) return false;
  scene.add({ art: cv, x: x - (w >> 1), y: y - 17, baseY: y });
  scene.footprint(x - (w >> 1) + 2, y - 1, w - 4, 2, 3);
  return true;
}

/** A press beside the road at a piston anchor: frame, bed and the ram (animated). */
export function pressAt(
  ctx: BakeContext,
  scene: Scene,
  ax: number,
  ay: number,
  out: LightOut,
): { x: number; y: number } | null {
  const { field } = ctx;
  // The nearest ground far enough off the road, walking away from it.
  let best: { x: number; y: number } | null = null;
  for (let r = 0; r < 90 && !best; r += 3)
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ] as const) {
      const x = Math.round(ax + dx * r);
      const y = Math.round(ay + dy * r);
      let ok = true;
      for (let yy = y - 40; yy <= y + 4 && ok; yy += 2)
        for (let xx = x - 16; xx <= x + 30 && ok; xx += 2) {
          const e =
            field.edge[
              Math.max(0, Math.min(field.h - 1, yy)) * field.w +
                Math.max(0, Math.min(field.w - 1, xx))
            ]!;
          if (e <= BARRIER_REACH + 3) ok = false;
        }
      if (ok) {
        best = { x, y };
        break;
      }
    }
  if (!best) return null;
  const { x, y } = best;
  const b = BUILDINGS[4]!;
  const cv = Canvas.sprite(30, 44);
  // Bed.
  cv.rect(0, 30, 28, 13, b.wall);
  cv.rect(0, 26, 28, 5, b.roof);
  cv.hline(0, 26, 28, b.rim);
  for (let k = 0; k < 28; k++)
    cv.set(k, 41, (k >> 1) % 2 === 0 ? IND.hazardYellow : IND.hazardBlack);
  cv.hline(0, 43, 28, PAL.ink);
  // Columns and crown.
  for (const cx of [2, 22]) {
    cv.rect(cx, 4, 4, 24, b.west);
    cv.vline(cx, 4, 24, b.edge);
    cv.vline(cx + 3, 4, 24, b.line);
  }
  cv.rect(0, 0, 28, 6, b.roof);
  cv.hline(0, 0, 28, b.rim);
  cv.hline(0, 5, 28, b.line);
  emissive(cv, () => {
    cv.set(9, 34, PAL.mint);
    cv.set(12, 34, PAL.red);
  });
  if (!scene.artFits(cv, x - 14, y - 43)) return null;
  scene.add({ art: cv, x: x - 14, y: y - 43, baseY: y });
  scene.solid(x - 14, y - 12, 28, 12, 30);
  out.pools.push({ x, y: y + 6, radii: [12, 22], tint: TINT_SODIUM });
  return { x: x - 14 + 6, y: y - 43 + 6 };
}
