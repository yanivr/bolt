import { hash2, mulberry32 } from '@bolt/shared';
import type { TrackHazard } from '@bolt/shared';
import type { BakeContext } from '../../biome.js';
import { Canvas, col, mixc } from '../../canvas.js';
import type { Color } from '../../canvas.js';
import { drawText } from '../../font.js';
import { leanOf } from '../../oblique.js';
import type { Scene } from '../../oblique.js';
import { fountain } from '../ground.js';
import type { FixedLot, Rect, Reserve } from '../layout.js';
import { G_PLAZA, G_QUAY, G_STREET, G_WATER } from '../layout.js';
import {
  BUILDINGS,
  PAL,
  ROOF_CONCRETE,
  ROOF_MAROON,
  ROOF_TEAL,
  TINT_GOLD,
  TINT_HEX,
  TINT_WARM,
  darker,
  lighter,
} from '../palette.js';
import type { LightOut } from '../props.js';
import { BARRIER_REACH } from '../road.js';
import { Solid } from '../solid.js';
import type { Mass } from '../solid.js';
import { busShelter, drawBox, emissive } from '../sprites.js';

/**
 * Backstreet Blitz's landmarks, placed from the track's own anchors and hazards: the clock
 * market square in the infield, the old town gatehouse over the cobbled street (its arch an
 * overlay the cars pass under), the harbor grain silos east of the track, the tram stop at the
 * west end of the rails, and the tram street with its catenary.
 */

export type BlitzSites = {
  square: Rect;
  clock: { x: number; y: number };
  gate: { x: number; yN: number; yS: number; north: Rect; south: Rect };
  silos: { x: number; y: number };
  tram: { y: number; x0: number; x1: number; stop: Rect; crossX0: number; crossX1: number };
  waterX: number;
  /** The strip between Bakers Row and the jink round the market. */
  lens: Rect | null;
};

const anchorAt = (ctx: BakeContext, id: string): { x: number; y: number } => {
  const a = ctx.def.anchors.find((q) => q.id === id);
  const p = a?.points[0];
  if (!p) throw new Error(`city_02 painter: no anchor ${id}`);
  return { x: Math.round(p.x), y: Math.round(p.y) };
};

/** Clear ground around a point, walking out until the road (plus its barrier) is near. */
function clearBox(ctx: BakeContext, x: number, y: number, margin: number, cap: number): Rect {
  const { field } = ctx;
  const ok = (px: number, py: number): boolean =>
    px >= 0 && py >= 0 && px < field.w && py < field.h && field.edge[py * field.w + px]! > margin;
  let x0 = x;
  let x1 = x;
  let y0 = y;
  let y1 = y;
  while (x0 > x - cap && ok(x0 - 1, y)) x0--;
  while (x1 < x + cap && ok(x1 + 1, y)) x1++;
  while (y0 > y - cap && ok(x, y0 - 1)) y0--;
  while (y1 < y + cap && ok(x, y1 + 1)) y1++;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function planBlitz(
  ctx: BakeContext,
  _scene: Scene,
): { reserves: Reserve[]; fixed: FixedLot[]; sites: BlitzSites } {
  const { field, def } = ctx;
  const W = def.worldWidth;
  const H = def.worldHeight;
  // The clock market: the square east of the jink, round the anchor.
  const ca = anchorAt(ctx, 'clock_market');
  const box = clearBox(ctx, ca.x + 140, ca.y, BARRIER_REACH + 6, 130);
  const square = { x: box.x, y: box.y + 6, w: Math.min(box.w, 230), h: Math.min(box.h - 6, 236) };
  const clock = { x: square.x + Math.round(square.w * 0.62), y: square.y + 44 };

  // The gate: where the old town street passes the anchor, its north and south banks.
  const ga = anchorAt(ctx, 'old_town_gate');
  // Walk the field, not the drive mask: the gate's bollards stand on the road.
  let yN = ga.y;
  while (yN > 0 && field.edge[yN * field.w + ga.x]! <= 0) yN--;
  let yS = ga.y;
  while (yS < H - 1 && field.edge[yS * field.w + ga.x]! <= 0) yS++;
  const north = { x: ga.x - 20, y: yN - 44, w: 40, h: 44 };
  // The south tower stands right behind the barrier; whatever of it leans over the road on
  // screen is drawn as a fading overlay.
  const south = { x: ga.x - 20, y: yS + 14, w: 40, h: 30 };

  const sa = anchorAt(ctx, 'harbor_silos');
  const crossing = def.hazards.find((hz) => hz.kind === 'crossing') as
    Extract<TrackHazard, { kind: 'crossing' }> | undefined;
  if (!crossing) throw new Error('city_02 painter: no crossing');
  const railY = Math.round(
    (crossing.railPath[0]!.y + crossing.railPath[crossing.railPath.length - 1]!.y) / 2,
  );
  const rx0 = Math.round(crossing.railPath[0]!.x);
  const rx1 = Math.round(crossing.railPath[crossing.railPath.length - 1]!.x);
  // Where the rails cross the road.
  let cx0 = Math.round((crossing.a.x + crossing.b.x) / 2);
  let cx1 = cx0;
  while (cx0 > 0 && field.edge[railY * field.w + cx0]! <= 0) cx0--;
  while (cx1 < W - 1 && field.edge[railY * field.w + cx1]! <= 0) cx1++;
  const stop = {
    x: rx0 + 4,
    y: railY + 10,
    w: Math.max(40, cx0 - BARRIER_REACH - 24 - rx0),
    h: 16,
  };
  let southBank = railY + 24;
  const sxm = stop.x + (stop.w >> 1);
  while (southBank < H - 1 && field.edge[southBank * field.w + sxm]! > 4) southBank++;
  const waterX = Math.max(rx1 + 22, W - 84);

  // Between Bakers Row and the main road's jink: a strip of market stalls.
  let lens: Rect | null = null;
  const bakers = ctx.track.branches.find((b) => def.shortcuts[b.index - 1]?.id === 'bakers_row');
  if (bakers) {
    const mid = Math.round(bakers.length / 2);
    const i = Math.min(bakers.count - 1, Math.round(mid / 10));
    const bx = Math.round(bakers.x[i]!);
    const by = Math.round(bakers.y[i]!);
    let x0 = bx;
    while (x0 < W - 1 && field.edge[by * field.w + x0]! <= 0) x0++;
    let x1 = x0;
    while (x1 < W - 1 && field.edge[by * field.w + x1]! > 0) x1++;
    let y0 = by;
    while (y0 > 0 && field.edge[(y0 - 1) * field.w + x0 + 6]! > 0) y0--;
    let y1 = by;
    while (y1 < H - 1 && field.edge[(y1 + 1) * field.w + x0 + 6]! > 0) y1++;
    if (x1 - x0 >= 24) lens = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  const reserves: Reserve[] = [
    { ...square, ground: G_PLAZA },
    // The tram street east of Signal Street, and the stop to the west.
    { x: cx1 + 2, y: railY - 22, w: rx1 - cx1 + 14, h: 44, ground: G_STREET },
    // West of it the stop, open down to the boulevard so nothing stands in front of it.
    { x: rx0 - 14, y: railY - 22, w: cx0 - rx0 + 12, h: southBank - railY + 22, ground: G_STREET },
    { x: waterX - 46, y: 0, w: 46, h: H, ground: G_QUAY },
    { x: waterX, y: 0, w: W - waterX, h: H, ground: G_WATER },
    { x: sa.x - 74, y: sa.y - 84, w: 150, h: 160, ground: G_QUAY },
  ];
  if (lens) reserves.push({ ...lens, ground: G_PLAZA });
  const fixed: FixedLot[] = [
    { ...north, family: ROOF_CONCRETE, rise: 60, tag: 'gate_north' },
    { ...south, family: ROOF_CONCRETE, rise: 48, tag: 'gate_south' },
    { x: clock.x - 16, y: clock.y - 14, w: 32, h: 28, family: ROOF_MAROON, rise: 96, tag: 'clock' },
    { x: sa.x - 62, y: sa.y - 64, w: 128, h: 124, family: ROOF_CONCRETE, rise: 110, tag: 'silos' },
  ];
  return {
    reserves,
    fixed,
    sites: {
      square,
      clock,
      gate: { x: ga.x, yN, yS, north, south },
      silos: sa,
      tram: { y: railY, x0: rx0, x1: rx1, stop, crossX0: cx0, crossX1: cx1 },
      waterX,
      lens,
    },
  };
}

// --- Shared helpers ------------------------------------------------------------------------

/** Upper bound for a fixed structure's rise, warning when the road caps it. */
function capRise(scene: Scene, r: Rect, rise: number, what: string): number {
  const max = scene.maxRise(r.x, r.y, r.w, r.h, rise);
  if (max < rise) console.warn(`  city_02 ${what}: rise ${rise} capped to ${max} by the road`);
  return Math.max(0, max);
}

/** Ashlar stone: courses of blocks with staggered joints. */
function ashlar(b: (typeof BUILDINGS)[number], lx: number, ly: number): Color {
  const course = Math.floor(ly / 5);
  const joint = (lx + (course & 1) * 4) % 9 === 0;
  if (ly % 5 === 4) return b.wallAlt;
  return joint ? b.wallAlt : b.wall;
}

// --- The clock market ----------------------------------------------------------------------

export function paintSquare(
  ctx: BakeContext,
  scene: Scene,
  sites: BlitzSites,
  out: LightOut,
  cobble: (x: number, y: number) => Color,
): void {
  const { world } = ctx;
  const sq = sites.square;
  const cx = sq.x + Math.round(sq.w * 0.42);
  const cy = sq.y + Math.round(sq.h * 0.58);
  // Cobbles laid in rings round the fountain, a stone border, a darker course every ring.
  for (let y = sq.y; y < sq.y + sq.h; y++) {
    for (let x = sq.x; x < sq.x + sq.w; x++) {
      const edge = Math.min(x - sq.x, y - sq.y, sq.x + sq.w - 1 - x, sq.y + sq.h - 1 - y);
      let c = cobble(x, y);
      const d = Math.hypot(x - cx, y - cy);
      if (edge < 3) c = edge === 0 ? PAL.kerbShade : edge === 1 ? PAL.kerbHi : PAL.kerb;
      else if (d > 22 && d < 64 && Math.floor(d) % 14 === 0) c = PAL.mortar;
      else if (d >= 64 && d < 67) c = PAL.sett;
      world.set(x, y, c);
    }
  }
  fountain(ctx, scene, cx, cy, 12);
  out.pools.push({ x: cx, y: cy, radii: [16, 26], tint: TINT_GOLD });
  // A statue in the basin: a figure on a plinth, lit from the upper left.
  const st = Canvas.sprite(9, 20);
  st.rect(1, 13, 7, 6, PAL.kerbShade);
  st.hline(1, 13, 7, PAL.kerbHi);
  st.rect(2, 4, 4, 9, PAL.steel);
  st.vline(2, 4, 9, PAL.steelHi);
  st.rect(3, 1, 3, 3, PAL.steel);
  st.set(3, 1, PAL.steelHi);
  st.set(6, 5, PAL.steelLight);
  st.set(7, 4, PAL.steelLight);
  st.hline(1, 19, 7, PAL.ink);
  scene.add({ art: st, x: cx - 4, y: cy - 19, baseY: cy + 2 });
  // Stalls round the square under striped canvas, crates of produce in front.
  const rnd = mulberry32(sq.x * 31 + sq.y);
  const stripes: ReadonlyArray<readonly [Color, Color]> = [
    [PAL.kerbCoral, PAL.kerbIvory],
    [col('#3E7C5C'), PAL.kerbIvory],
    [col('#D9A63E'), PAL.kerbIvoryDark],
    [col('#3C4C7C'), PAL.kerbIvory],
  ];
  const stall = (x: number, y: number, k: number): void => {
    const [a, b] = stripes[k % stripes.length]!;
    stallSprite(scene, x, y, a, b, rnd);
    out.pools.push({ x: x + 8, y: y + 4, radii: [9, 15], tint: TINT_WARM });
  };
  let k = 0;
  for (let x = sq.x + 10; x + 20 < sq.x + sq.w - 8; x += 24) {
    if (Math.abs(x + 8 - sites.clock.x) < 30) continue;
    stall(x, sq.y + 22, k++);
  }
  for (let x = sq.x + 10; x + 20 < sq.x + sq.w - 8; x += 24) stall(x, sq.y + sq.h - 10, k++);
  for (let y = sq.y + 52; y + 14 < sq.y + sq.h - 24; y += 22) {
    stall(sq.x + 8, y, k++);
    stall(sq.x + sq.w - 26, y, k++);
  }
  // Lanterns at the corners of the basin.
  for (const [lx, ly] of [
    [cx - 26, cy - 22],
    [cx + 26, cy - 22],
    [cx - 26, cy + 24],
    [cx + 26, cy + 24],
  ] as const)
    lanternPost(scene, out, lx, ly);
  if (sites.lens) {
    const ln = sites.lens;
    let j = 0;
    for (let y = ln.y + 24; y + 14 < ln.y + ln.h - 6; y += 22)
      stall(ln.x + Math.max(3, ((ln.w - 18) >> 1) - 2), y, j++ + 1);
  }
}

function lanternPost(scene: Scene, out: LightOut, x: number, y: number): void {
  const cv = Canvas.sprite(5, 15);
  cv.vline(2, 4, 10, PAL.ink);
  cv.vline(1, 5, 9, PAL.steelDark);
  cv.hline(0, 14, 5, PAL.ink);
  cv.rect(0, 0, 5, 5, PAL.ink);
  emissive(cv, () => {
    cv.rect(1, 1, 3, 3, PAL.lampGlow);
    cv.set(1, 1, PAL.lamp);
  });
  if (!scene.artFits(cv, x - 2, y - 14)) return;
  scene.add({ art: cv, x: x - 2, y: y - 14, baseY: y });
  scene.footprint(x - 1, y - 1, 3, 2, 3);
  out.pools.push({ x, y: y + 2, radii: [10, 18], tint: TINT_WARM });
}

/** A market stall: striped canvas roof on four posts, produce crates on the counter. */
function stallSprite(
  scene: Scene,
  x: number,
  y: number,
  a: Color,
  b: Color,
  rnd: () => number,
): void {
  const w = 18;
  const cv = Canvas.sprite(w + 2, 18);
  // Canvas roof: a shallow ridge, stripes running front to back.
  for (let yy = 0; yy < 8; yy++)
    for (let xx = 0; xx < w; xx++) {
      const s = (xx >> 1) & 1 ? a : b;
      cv.set(xx, yy, yy < 3 ? lighter(s, 0.18) : yy === 7 ? darker(s, 0.35) : s);
    }
  // Scalloped valance.
  for (let xx = 0; xx < w; xx++)
    if (xx % 3 !== 2) cv.set(xx, 8, darker((xx >> 1) & 1 ? a : b, 0.25));
  cv.vline(0, 8, 9, PAL.woodDark);
  cv.vline(w - 1, 8, 9, PAL.woodDark);
  // Counter with goods.
  cv.rect(1, 12, w - 2, 4, PAL.wood);
  cv.hline(1, 12, w - 2, PAL.woodLight);
  const goods = [col('#D9542E'), col('#E8B23A'), col('#6FA03E'), col('#B03A4A'), col('#E3D2A0')];
  for (let xx = 2; xx < w - 2; xx += 3) {
    const g = goods[(rnd() * goods.length) | 0]!;
    cv.set(xx, 11, g);
    cv.set(xx + 1, 11, lighter(g, 0.2));
    cv.set(xx, 10, darker(g, 0.2));
  }
  cv.hline(0, 16, w, PAL.ink);
  // The canvas throws a little shade on the counter.
  cv.mapRect(1, 9, w - 2, 2, (c) => darker(c, 0.3));
  if (!scene.artFits(cv, x, y - 16)) return;
  scene.add({ art: cv, x, y: y - 16, baseY: y });
  scene.footprint(x, y - 6, w, 6, 4);
}

/** The market clock tower: a brick shaft, a stone belfry, a copper pyramid and a lit dial. */
export function paintClockTower(scene: Scene, lot: Rect, out: LightOut): void {
  const b = BUILDINGS[ROOF_MAROON]!;
  const stone = BUILDINGS[ROOF_CONCRETE]!;
  const copper = BUILDINGS[ROOF_TEAL]!;
  const sr = capRise(scene, lot, 96, 'clock tower');
  const spire = 22;
  const m: Mass = { x: lot.x, y: lot.y, w: lot.w, d: lot.h, r: sr, base: 0 };
  scene.solid(m.x, m.y, m.w, m.d, m.r);
  scene.later(() => {
    const solid = new Solid(scene, [m], spire + 10, 3);
    const mx = (m.w - 1) / 2;
    const my = (m.d - 1) / 2;
    solid.roofShaped(
      m,
      (lx, ly) =>
        Math.max(
          0,
          Math.round(spire * (1 - Math.max(Math.abs(lx - mx) / mx, Math.abs(ly - my) / my))),
        ),
      (lx, ly) => {
        const ax = (lx - mx) / mx;
        const ay = (ly - my) / my;
        if (lx === 0 || ly === 0) return stone.rim;
        if (lx === m.w - 1 || ly === m.d - 1) return stone.trim;
        if (Math.abs(ax) >= Math.abs(ay)) return ax < 0 ? copper.rim : copper.inner;
        return ay < 0 ? copper.roof : ly % 3 === 0 ? copper.roofLine : copper.west;
      },
      b.wall,
      b.west,
    );
    solid.west(m, (u, v) => {
      if (v <= 1) return b.westLine;
      if (v >= sr - 3) return stone.rimLow;
      if (v >= sr - 26) return v % 5 === 4 ? stone.westAlt : stone.west;
      if (u >= 10 && u < 15 && v > 20 && v < sr - 34 && v % 24 > 6 && v % 24 < 16)
        return -PAL.windowMid;
      return v % 4 === 3 ? b.westAlt : b.west;
    });
    const face = Canvas.sprite(m.w, sr);
    for (let ly = 0; ly < sr; ly++)
      for (let lx = 0; lx < m.w; lx++) {
        let c: Color =
          ly < 26
            ? ashlar(stone, lx, ly)
            : ly % 4 === 3
              ? b.wallAlt
              : (lx + (ly >> 2) * 3) % 8 === 0
                ? b.wallAlt
                : b.wall;
        if (lx < 2 || lx >= m.w - 2) c = (Math.floor(ly / 5) & 1) === 0 ? stone.pier : stone.wall;
        if (lx === 0) c = stone.edge;
        if (lx === m.w - 1) c = b.line;
        face.set(lx, ly, c);
      }
    face.hline(0, 0, m.w, stone.rimLow);
    face.hline(0, 1, m.w, stone.trim);
    face.hline(1, 2, m.w - 1, stone.deep);
    face.hline(0, 26, m.w, stone.trim);
    face.hline(1, 27, m.w - 1, b.deep);
    // Belfry louvres, warm light behind them.
    for (let k = 0; k < 2; k++) {
      const bx = 6 + k * 12;
      face.rect(bx, 5, 7, 17, stone.deep);
      emissive(face, () => {
        face.rect(bx + 1, 7, 5, 14, PAL.windowDim);
        face.rect(bx + 1, 7, 5, 5, PAL.windowMid);
      });
      for (let yy = 10; yy < 21; yy += 3) face.hline(bx + 1, yy, 5, stone.deep);
    }
    // Arched door at the foot.
    face.rect(11, sr - 15, 10, 15, b.deep);
    face.rect(12, sr - 13, 8, 13, PAL.woodDark);
    face.hline(13, sr - 14, 6, b.deep);
    face.vline(16, sr - 13, 13, PAL.ink);
    face.hline(0, sr - 1, m.w, PAL.ink);
    solid.south(m, face);
    // The dial hangs square to the screen.
    const dial = Canvas.sprite(23, 23);
    const c0 = 11;
    dial.disc(c0, c0, 11, PAL.ink);
    dial.disc(c0, c0, 10, stone.trim);
    emissive(dial, () => {
      dial.disc(c0, c0, 8, col('#F4E6BC'));
      for (let hr = 0; hr < 12; hr++) {
        const a = (hr / 12) * Math.PI * 2;
        dial.set(Math.round(c0 + Math.sin(a) * 7), Math.round(c0 - Math.cos(a) * 7), PAL.ink);
      }
      // Twenty to seven: golden hour.
      const ha = ((6 + 40 / 60) / 12) * Math.PI * 2;
      const ma = (40 / 60) * Math.PI * 2;
      dial.line(c0, c0, c0 + Math.sin(ha) * 4, c0 - Math.cos(ha) * 4, PAL.ink);
      dial.line(c0, c0, c0 + Math.sin(ma) * 6.5, c0 - Math.cos(ma) * 6.5, PAL.inkSoft);
      dial.set(c0, c0, PAL.coral);
    });
    solid.decal(m, (m.w - 23) >> 1, 30, dial);
    solid.onRoof(m, m.d, () => {
      const fx = solid.roofX(m, Math.round(mx)) + leanOf(sr + spire) - leanOf(sr);
      const fy = solid.roofY(m, Math.round(my)) - spire;
      solid.cv.vline(fx, fy - 6, 7, PAL.gold);
      solid.cv.set(fx, fy - 7, PAL.goldHi);
      solid.cv.hline(fx - 2, fy - 4, 5, PAL.goldDim);
    });
    scene.add(solid.item());
  });
  out.lights.push({
    x: lot.x + (lot.w >> 1),
    y: lot.y + lot.h - sr + 40,
    radius: 70,
    color: TINT_HEX[TINT_GOLD]!,
    intensity: 0.6,
  });
  out.pools.push({
    x: lot.x + lot.w / 2,
    y: lot.y + lot.h + 10,
    radii: [16, 28],
    tint: TINT_GOLD,
    squashY: 1.4,
  });
}

// --- The old town gate ---------------------------------------------------------------------

/** One gate tower: ashlar walls, a crenellated parapet, arrow slits, a lantern by the arch. */
function gateTower(
  scene: Scene,
  r: Rect,
  rise: number,
  out: LightOut,
  facing: 'north' | 'south',
  overlay?: string,
): void {
  const b = BUILDINGS[ROOF_CONCRETE]!;
  const m: Mass = { x: r.x, y: r.y, w: r.w, d: r.h, r: rise, base: 0 };
  scene.solid(m.x, m.y, m.w, m.d, m.r);
  scene.later(() => {
    const solid = new Solid(scene, [m], 20, 2);
    // A steep tiled cap: four slopes to a point, the one toward the light the brightest.
    const tile = BUILDINGS[ROOF_MAROON]!;
    const cap = 16;
    const mx = (m.w - 1) / 2;
    const my = (m.d - 1) / 2;
    solid.roofShaped(
      m,
      (lx, ly) =>
        Math.max(
          0,
          Math.round(cap * (1 - Math.max(Math.abs(lx - mx) / mx, Math.abs(ly - my) / my))),
        ),
      (lx, ly) => {
        const ax = (lx - mx) / mx;
        const ay = (ly - my) / my;
        if (lx === 0 || ly === 0) return b.rim;
        if (lx === m.w - 1 || ly === m.d - 1) return b.trim;
        const course = (Math.abs(ax) >= Math.abs(ay) ? lx : ly) % 3 === 0;
        if (Math.abs(ax) >= Math.abs(ay))
          return ax < 0 ? (course ? tile.roofAlt : tile.rim) : course ? tile.deep : tile.inner;
        return ay < 0 ? (course ? tile.roofAlt : tile.roof) : course ? tile.roofLine : tile.west;
      },
      b.wall,
      b.west,
    );
    solid.west(m, (u, v) => {
      if (v <= 1) return b.westLine;
      if (v >= rise - 3) return b.rimLow;
      if (u >= 14 && u < 17 && v > 14 && v < rise - 10 && v % 18 < 7) return b.deep;
      return v % 5 === 4 ? b.westAlt : b.west;
    });
    const face = Canvas.sprite(m.w, rise);
    for (let ly = 0; ly < rise; ly++)
      for (let lx = 0; lx < m.w; lx++) face.set(lx, ly, ashlar(b, lx, ly));
    face.vline(0, 0, rise, b.edge);
    face.vline(m.w - 1, 0, rise, b.line);
    // Crenellated top edge.
    for (let lx = 0; lx < m.w; lx++) face.set(lx, 0, (lx >> 2) % 2 === 0 ? b.rim : b.deep);
    face.hline(0, 3, m.w, b.trim);
    face.hline(1, 4, m.w - 1, b.deep);
    for (const sx of [9, m.w - 12]) {
      face.rect(sx, 12, 3, 9, b.deep);
      face.rect(sx, rise - 30, 3, 8, b.deep);
    }
    if (facing === 'north') {
      // A lit window over the street and a lantern on a bracket.
      emissive(face, () => {
        face.rect(16, 14, 8, 9, PAL.windowMid);
        face.hline(16, 14, 8, PAL.windowWarm);
      });
    }
    face.hline(0, rise - 1, m.w, PAL.ink);
    solid.south(m, face);
    // A tower standing close south of the road leans over it on screen: that part of it is
    // a fading overlay, like the arch.
    if (overlay) scene.addSplit(solid.item(), { id: overlay, kind: 'gate_tower', fade: true });
    else scene.add(solid.item());
  });
  out.pools.push({
    x: r.x + r.w / 2,
    y: r.y + r.h + 8,
    radii: [12, 22],
    tint: TINT_WARM,
    squashY: 1.4,
  });
}

export const ARCH_RISE = 30;
const GABLE = 10;

/**
 * The gate: two towers and a gatehouse across the street between them. The gatehouse reaches
 * over drivable ground, so it is a fading overlay: a pitched tile roof running north-south, its
 * lit west face with the arch cut out of it (the cobbles show through the opening), and the
 * shadow it throws on the street. The south tower stands close to the road and is split the
 * same way.
 */
export function paintGate(scene: Scene, sites: BlitzSites, out: LightOut): void {
  const g = sites.gate;
  const nr = capRise(scene, g.north, 64, 'north gate tower');
  gateTower(scene, g.north, nr, out, 'north');
  gateTower(scene, g.south, 56, out, 'south', 'old_town_gate_south_tower');
  const stone = BUILDINGS[ROOF_CONCRETE]!;
  const tile = BUILDINGS[ROOF_MAROON]!;
  const W = 26;
  const x0 = g.x - (W >> 1);
  const yA = g.north.y + g.north.h - 6;
  const yB = g.south.y + 6;
  const R = ARCH_RISE;
  const top = yA - R - GABLE - 4;
  const cv = Canvas.sprite(W + leanOf(R + GABLE) + 4, yB - top + 2);
  const X = (wx: number): number => wx - x0 + 1;
  const Y = (wy: number): number => wy - top;
  const span = g.yS - g.yN;
  const mid = (g.yN + g.yS) / 2;
  const archTop = R - 8;
  // West face: piers at both ends, spandrels above the curve, the opening left empty.
  for (let wy = yA; wy <= yB; wy++) {
    const t = (wy - mid) / (span / 2 + 3);
    const opening = Math.abs(t) < 1 ? Math.round(archTop * Math.sqrt(1 - t * t)) : -1;
    for (let v = 0; v < R; v++) {
      if (v < opening) continue;
      const voussoir = opening > 0 && v < opening + 3;
      let c: Color;
      if (voussoir) c = (Math.floor((wy + v * 2) / 3) & 1) === 0 ? stone.rim : stone.trim;
      else if (v >= R - 2) c = stone.rimLow;
      else c = ashlarWest(stone, wy, v);
      cv.set(X(x0) + leanOf(v), Y(wy) - v, c);
    }
  }
  // Pitched tile roof, ridge running north-south: the west slope in the light, the east slope
  // a step down, the ridge capped. Drawn point by point at its true height.
  const midX = (W - 1) / 2;
  for (let wy = yA - 1; wy <= yB; wy++)
    for (let lx = 0; lx < W; lx++) {
      const gz = Math.round(GABLE * (1 - Math.abs(lx - midX) / midX));
      const hgt = R + gz;
      let c: Color;
      if (Math.abs(lx - midX) < 1) c = tile.rim;
      else if (lx === 0 || wy === yA - 1) c = tile.rimLow;
      else if (lx === W - 1) c = tile.inner;
      else if (lx < midX) c = (wy - yA) % 4 === 3 ? tile.roofAlt : tile.roof;
      else
        c =
          (wy - yA) % 4 === 3
            ? mixc(tile.roofLine, tile.inner, 0.6)
            : mixc(tile.roofLine, tile.inner, 0.3);
      const sx = X(x0) + lx + leanOf(hgt);
      cv.set(sx, Y(wy) - hgt, c);
      cv.set(sx + 1, Y(wy) - hgt, c);
    }
  // The gable at the south end, over the south tower.
  for (let lx = 0; lx < W; lx++) {
    const gz = Math.round(GABLE * (1 - Math.abs(lx - midX) / midX));
    for (let v = R; v < R + gz; v++)
      cv.set(X(x0) + lx + leanOf(v), Y(yB) - v, (lx + v) % 5 === 0 ? stone.wallAlt : stone.wall);
  }
  // A lantern hung in the arch.
  emissive(cv, () => {
    const lx = X(x0) + leanOf(archTop) - 1;
    cv.set(lx, Y(Math.round(mid)) - archTop + 2, PAL.lamp);
    cv.set(lx, Y(Math.round(mid)) - archTop + 3, PAL.lampGlow);
  });
  scene.add({
    art: cv,
    x: x0 - 1,
    y: top,
    baseY: yB,
    overlay: { id: 'old_town_gate_arch', kind: 'gate_arch', fade: true },
  });
  scene.shadeRect(x0 + 4, g.yN + 2, W + 6, span - 2);
  out.pools.push({ x: g.x - 20, y: mid, radii: [16, 30], tint: TINT_WARM });
  out.lights.push({
    x: g.x - 14,
    y: Math.round(mid),
    radius: 40,
    color: TINT_HEX[TINT_WARM]!,
    intensity: 0.6,
  });
}

function ashlarWest(b: (typeof BUILDINGS)[number], u: number, v: number): Color {
  const course = Math.floor(v / 4);
  if (v % 4 === 3) return b.westAlt;
  return (u + (course & 1) * 5) % 10 === 0 ? b.westLine : b.west;
}

// --- Harbor silos --------------------------------------------------------------------------

/** Four concrete grain silos with a headhouse and a gallery: the tallest things on the map. */
export function paintSilos(scene: Scene, sites: BlitzSites, out: LightOut): void {
  const { x, y } = sites.silos;
  const R = 25;
  const rise = 108;
  const centers: Array<[number, number]> = [
    [x - 28, y - 30],
    [x + 26, y - 30],
    [x - 28, y + 28],
    [x + 26, y + 28],
  ];
  const b = BUILDINGS[ROOF_CONCRETE]!;
  for (const [cx, cy] of centers) {
    const foot = { x: cx - R, y: cy - R, w: 2 * R, h: 2 * R };
    const r = capRise(scene, foot, rise, 'silo');
    scene.solid(foot.x, foot.y, foot.w, foot.h, r);
    scene.later(() => {
      const lean = leanOf(r);
      const cv = Canvas.solid(2 * R + lean + 6, 2 * R + r + 8);
      const ox = cx - R - 2;
      const oy = cy - R - r - 4;
      // The drum: every ring from the foot up, toned by how far round toward the light it is.
      for (let v = 0; v <= r; v++) {
        const ccx = cx + leanOf(v);
        const ccy = cy - v;
        cv.curKey = cy + R;
        for (let dx = -R; dx <= R; dx++) {
          const dy = Math.round(Math.sqrt(Math.max(0, R * R - dx * dx)));
          const px = ccx + dx - ox;
          const py = ccy + dy - oy;
          const t = dx / R;
          let c: Color = t < -0.55 ? b.edge : t < -0.1 ? b.west : t < 0.45 ? b.wall : b.wallLow;
          if (v % 18 === 17) c = darker(c, 0.18);
          // Weather streaks under the rim.
          if (hash2(dx + cx, Math.floor(v / 6), 41) < 0.08 && v > r - 30) c = darker(c, 0.12);
          if (scene.shaded(cx + dx, cy + dy, v)) c = mixc(c, b.deep, 0.45);
          cv.set(px, py, c);
          if (v === 0) cv.set(px, py + 1, PAL.ink);
        }
      }
      // A ladder up the lit side.
      for (let v = 2; v < r - 2; v++) {
        const lx = cx - Math.round(R * 0.62) + leanOf(v) - ox;
        const ly = cy + Math.round(R * 0.78) - v - oy;
        cv.set(lx, ly, PAL.steelDark);
        cv.set(lx + 2, ly, PAL.steelDark);
        if (v % 3 === 0) cv.set(lx + 1, ly, PAL.steel);
      }
      // Top: a domed concrete cap with a hatch.
      const tcx = cx + lean - ox;
      const tcy = cy - r - oy;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const d = Math.hypot(dx, dy);
          if (d > R + 0.35) continue;
          let c: Color =
            d > R - 1.5
              ? b.rim
              : dx + dy < -R * 0.6
                ? b.rim
                : dx + dy > R * 0.5
                  ? b.roofLine
                  : b.roof;
          if (d > R - 1.5 && dx + dy > 0) c = b.trim;
          if (scene.shaded(cx + dx, cy + dy, r + 1)) c = mixc(c, b.deep, 0.45);
          cv.set(tcx + dx, tcy + dy, c);
        }
      cv.rect(tcx - 3, tcy - 3, 6, 5, b.inner);
      cv.hline(tcx - 3, tcy - 3, 6, b.rimLow);
      scene.add({ art: cv, x: ox, y: oy, baseY: cy + R });
    });
  }
  // The headhouse on the north side, joined to the drums by a gallery.
  const hh = { x: x - 14, y: y - 66, w: 30, h: 16 };
  const hr = capRise(scene, hh, rise + 22, 'headhouse');
  const hm: Mass = { x: hh.x, y: hh.y, w: hh.w, d: hh.h, r: hr, base: 0 };
  scene.solid(hh.x, hh.y, hh.w, hh.h, hr);
  scene.later(() => {
    const solid = new Solid(scene, [hm], 10, 2);
    solid.roof(hm, (lx, ly) =>
      lx === 0 || ly === 0 ? b.rim : lx === hm.w - 1 || ly === hm.d - 1 ? b.trim : b.roof,
    );
    solid.west(hm, (_u, v) => (v <= 1 ? b.westLine : v % 12 === 11 ? b.westAlt : b.west));
    const face = Canvas.sprite(hm.w, hr);
    for (let ly = 0; ly < hr; ly++)
      for (let lx = 0; lx < hm.w; lx++) face.set(lx, ly, ly % 12 === 11 ? b.wallAlt : b.wall);
    face.vline(0, 0, hr, b.edge);
    face.vline(hm.w - 1, 0, hr, b.line);
    for (let ly = 8; ly < hr - 10; ly += 12) {
      face.rect(6, ly, 4, 6, b.deep);
      face.rect(20, ly, 4, 6, b.deep);
      if (hash2(ly, 3, 77) < 0.4) emissive(face, () => face.rect(20, ly + 1, 4, 4, PAL.windowMid));
    }
    // Painted name down the face.
    drawText(face, 3, 20, 'GRAIN', mixc(b.wall, PAL.kerbIvory, 0.55), 'micro', 1);
    face.hline(0, hr - 1, hm.w, PAL.ink);
    solid.south(hm, face);
    solid.onRoof(hm, hm.d, () => {
      const ax = solid.roofX(hm, hm.w - 4);
      const ay = solid.roofY(hm, 4);
      solid.cv.vline(ax, ay - 12, 13, PAL.steelLight);
      emissive(solid.cv, () => solid.cv.set(ax, ay - 13, PAL.red));
    });
    scene.add(solid.item());
  });
  out.lights.push({ x, y: y - rise, radius: 60, color: '#F4B45E', intensity: 0.4 });
}

// --- The tram stop and the tram street --------------------------------------------------------

/** A two-car tram waiting at the stop, with its pantograph up to the wire. */
function tramSprite(len: number): Canvas {
  const cv = Canvas.sprite(len + 4, 34);
  const body = col('#E9D9B4');
  const bodyDk = col('#B9A88A');
  const stripe = PAL.kerbCoral;
  const cars = 2;
  const cw = Math.floor((len - 2) / cars);
  for (let k = 0; k < cars; k++) {
    const x = 2 + k * (cw + 2);
    drawBox(cv, x + 4, 12, cw - 4, 12, 10, body, bodyDk);
    // Roof gear.
    cv.rect(x + 8, 15, cw - 12, 3, PAL.steel);
    cv.hline(x + 8, 15, cw - 12, PAL.steelLight);
    // Livery band and windows down the south side.
    cv.hline(x + 1, 25, cw - 4, stripe);
    cv.hline(x + 1, 30, cw - 4, stripe);
    emissive(cv, () => {
      for (let wx = x + 3; wx < x + cw - 6; wx += 5) cv.rect(wx, 26, 3, 3, PAL.windowWarm);
    });
  }
  // Pantograph up to the wire.
  const px = 2 + Math.round(cw / 2) + 4;
  cv.line(px, 14, px + 3, 4, PAL.steelDark);
  cv.line(px + 6, 14, px + 3, 4, PAL.steelDark);
  cv.hline(px - 1, 3, 9, PAL.steelLight);
  emissive(cv, () => {
    cv.set(1, 29, PAL.red);
    cv.set(len + 1, 29, PAL.ivory);
  });
  return cv;
}

export const CATENARY_RISE = 30;

/**
 * The tram stop at the west end of the rails, the masts down both sides of the tram street, and
 * the contact wire, which is an overlay where it spans Signal Street.
 */
export function paintTram(ctx: BakeContext, scene: Scene, sites: BlitzSites, out: LightOut): void {
  const { world } = ctx;
  const t = sites.tram;
  // Platform: a raised slab south of the rails.
  const st = t.stop;
  for (let y = st.y; y < st.y + st.h; y++)
    for (let x = st.x; x < st.x + st.w; x++) {
      const edge =
        y === st.y
          ? PAL.kerbIvory
          : y === st.y + 1
            ? PAL.kerbHi
            : (x - st.x) % 12 === 0
              ? PAL.walkGrout
              : PAL.walkLight;
      world.set(x, y, edge);
    }
  // Buffer stop at the end of the line.
  const bs = Canvas.sprite(6, 12);
  bs.rect(0, 0, 6, 6, PAL.kerbCoral);
  bs.hline(0, 0, 6, PAL.coralHi);
  for (let k = 0; k < 6; k += 2) bs.set(k, 3, PAL.kerbIvory);
  bs.rect(0, 6, 6, 5, PAL.kerbCoralDark);
  bs.hline(0, 11, 6, PAL.ink);
  scene.add({ art: bs, x: t.x0 - 6, y: t.y - 6, baseY: t.y + 6 });
  // Shelter on the platform, and the tram waiting beside it.
  const shelter = busShelter();
  const sx = st.x + st.w - 36;
  if (scene.spriteFits(shelter, sx, st.y + st.h - 1)) {
    scene.place(shelter, sx, st.y + st.h - 1);
    out.pools.push({ x: sx + 6, y: st.y + st.h, radii: [10, 18], tint: TINT_WARM });
  }
  const len = Math.min(96, st.w - 6);
  const tram = tramSprite(len);
  const tx = t.x0 + 2;
  const ty = t.y + 10 - tram.h;
  if (scene.artFits(tram, tx, ty)) {
    scene.add({ art: tram, x: tx, y: ty, baseY: t.y + 9 });
    scene.footprint(tx + 2, t.y - 6, len, 14, 6);
  }
  // Catenary masts down both sides of the tram street, every few car lengths.
  const masts: number[] = [];
  for (let x = t.x0 + 30; x < t.x1 - 10; x += 60) {
    if (x > t.crossX0 - 20 && x < t.crossX1 + 20) continue;
    masts.push(x);
  }
  masts.push(t.crossX0 - BARRIER_REACH - 6, t.crossX1 + BARRIER_REACH + 6);
  for (const mx of masts) {
    for (const side of [-1, 1]) {
      const gy = t.y + side * 19 + (side > 0 ? 2 : 0);
      const cv = Canvas.sprite(3, CATENARY_RISE + 3);
      cv.vline(0, 1, CATENARY_RISE + 1, PAL.steelLight);
      cv.vline(1, 1, CATENARY_RISE + 1, PAL.steelDark);
      cv.hline(0, 0, 3, PAL.steel);
      cv.hline(0, CATENARY_RISE + 2, 3, PAL.ink);
      if (scene.artFits(cv, mx - 1, gy - CATENARY_RISE - 2)) {
        scene.add({ art: cv, x: mx - 1, y: gy - CATENARY_RISE - 2, baseY: gy });
        scene.footprint(mx - 1, gy - 1, 3, 2, 6);
      }
    }
  }
  // The wire: one contact wire over the rail centre, with span wires to the masts. Drawn as
  // one long sprite; whatever reaches over the road becomes the fading overlay.
  const wy = t.y - Math.round(CATENARY_RISE * 0.62);
  const W = t.x1 - t.x0 + 4;
  const wire = Canvas.sprite(W, 30);
  const Y0 = wy - 12;
  for (let x = 0; x < W; x++) wire.set(x, wy - Y0, PAL.ink);
  for (const mx of masts) {
    const lx = mx - t.x0;
    wire.line(lx, wy - Y0 - 8, lx, wy - Y0, PAL.inkSoft);
    wire.line(lx - 1, wy - Y0 + 12, lx, wy - Y0, PAL.inkSoft);
  }
  scene.addSplit(
    { art: wire, x: t.x0, y: Y0, baseY: t.y + 24 },
    { id: 'tram_catenary', kind: 'catenary', fade: true },
  );
}

/** The tram street's bed off the road: rails on a course of dark setts, through the blocks. */
export function paintTramBed(ctx: BakeContext, sites: BlitzSites, roofId: Uint16Array): void {
  const { world, field } = ctx;
  const t = sites.tram;
  for (let y = t.y - 14; y <= t.y + 14; y++)
    for (let x = t.x0 - 4; x <= t.x1 + 4; x++) {
      if (x < 0 || y < 0 || x >= field.w || y >= field.h) continue;
      const p = y * field.w + x;
      if (field.edge[p]! <= 0 || roofId[p]) continue;
      const d = Math.abs(y + 0.5 - t.y);
      let c: Color;
      if (d >= 6 && d < 7) c = PAL.rail;
      else if (d >= 7 && d < 8) c = PAL.railMid;
      else if (d >= 8 && d < 9) c = PAL.railGroove;
      else if (d > 12.5) c = PAL.kerbShade;
      else {
        const course = Math.floor(x / 4);
        const vv = y + (course & 1) * 2;
        c =
          x % 4 === 0 || vv % 5 === 0
            ? PAL.mortar
            : hash2(course, vv >> 2, 61) < 0.3
              ? PAL.cobble
              : PAL.cobbleDark;
      }
      world.set(x, y, c);
    }
}
