import { hash2, mulberry32, sampleBranch } from '@bolt/shared';
import type { BakeContext } from '../biome.js';
import { Canvas, mixc } from '../canvas.js';
import type { Color } from '../canvas.js';
import { drawText } from '../font.js';
import { leanOf } from '../oblique.js';
import type { Scene } from '../oblique.js';
import type { CityLayout, Lot, Rect } from '../city/layout.js';
import { BUILDINGS, LIVERIES, PAL, darker, lighter } from '../city/palette.js';
import type { BuildingRamp } from '../city/palette.js';
import type { LightOut } from '../city/props.js';
import { Solid } from '../city/solid.js';
import type { Mass } from '../city/solid.js';
import { containerSprite, emissive } from '../city/sprites.js';
import { BARRIER_REACH } from '../city/road.js';
import { IND, TINT_MERCURY, TINT_SODIUM } from './style.js';

/**
 * The works' buildings, on the lots the city layout cuts out of the ground away from the road:
 * long sheds under sawtooth roofs with lit north lights, ridged halls with a lit monitor along
 * the ridge, flat-roofed plant houses with pipes, ducts and a stack, tank farms and container
 * yards. Every mass shows its roof, its lit west wall and its shaded south wall, and casts its
 * shadow on what stands lower to the south-east, exactly like the city's.
 */

const corrugated = (b: BuildingRamp, lx: number): Color => (lx % 3 === 2 ? b.wallAlt : b.wall);

/** South wall of a works building: cladding, a hazard dado, roller doors, a few lit windows. */
function claddingFace(
  b: BuildingRamp,
  w: number,
  rows: number,
  seed: number,
  out: { glows: number[] },
): Canvas {
  const cv = Canvas.sprite(w, rows);
  const rnd = mulberry32(seed);
  for (let ly = 0; ly < rows; ly++)
    for (let lx = 0; lx < w; lx++) cv.set(lx, ly, corrugated(b, lx));
  cv.hline(0, 0, w, b.rimLow);
  cv.hline(0, 1, w, b.trim);
  cv.hline(1, 2, w - 1, b.deep);
  cv.vline(0, 0, rows, b.edge);
  cv.vline(w - 1, 0, rows, b.line);
  // A band of high windows, some lit cold from the hall lights inside.
  if (rows >= 24)
    for (let x = 4; x + 6 < w - 3; x += 9) {
      const lit = rnd() < 0.18;
      cv.rect(x, 5, 6, 4, b.line);
      if (lit)
        emissive(cv, () => {
          cv.rect(x + 1, 6, 4, 2, IND.mercuryGlow);
          cv.hline(x + 1, 6, 4, IND.mercury);
        });
      else cv.rect(x + 1, 6, 4, 2, PAL.windowNight);
    }
  // Roller doors along the foot, with a hazard-striped sill and a bulkhead lamp.
  const doorH = Math.min(14, rows - 6);
  for (let x = 6; x + 18 < w - 4; x += 26 + ((rnd() * 3) | 0) * 6) {
    const lit = rnd() < 0.3;
    cv.rect(x - 1, rows - doorH - 1, 18, doorH + 1, b.deep);
    for (let yy = rows - doorH; yy < rows - 1; yy++) {
      if (lit && yy > rows - doorH + 3)
        emissive(cv, () =>
          cv.hline(x, yy, 16, yy === rows - doorH + 4 ? PAL.windowWarm : PAL.windowMid),
        );
      else cv.hline(x, yy, 16, (yy & 1) === 0 ? PAL.steel : PAL.steelDark);
    }
    for (let k = 0; k < 16; k++)
      cv.set(x + k, rows - 2, (k >> 1) % 2 === 0 ? IND.hazardYellow : IND.hazardBlack);
    emissive(cv, () => cv.set(x + 8, rows - doorH - 3, PAL.lamp));
    out.glows.push(x + 8);
  }
  cv.hline(0, rows - 1, w, PAL.ink);
  return cv;
}

function westCladding(b: BuildingRamp, rise: number): (u: number, v: number) => number {
  return (u, v) =>
    v <= 1 ? b.westLine : v >= rise - 3 ? b.rimLow : u % 3 === 2 ? b.westAlt : b.west;
}

function shed(scene: Scene, lot: Lot, out: LightOut, rise: number): void {
  const b = BUILDINGS[lot.family]!;
  const m: Mass = { x: lot.x, y: lot.y, w: lot.w, d: lot.h, r: rise, base: 0 };
  const P = 12;
  const G = 6;
  scene.solid(m.x, m.y, m.w, m.d, m.r + G);
  scene.later(() => {
    const solid = new Solid(scene, [m], G + 10, 2);
    // Sawtooth: each tooth rises toward the south and drops at a glazed face that shows.
    solid.roofShaped(
      m,
      (lx, ly) =>
        lx === 0 || lx === m.w - 1 || ly < 2 || ly > m.d - 3
          ? 0
          : Math.round((G * (ly % P)) / (P - 1)),
      (lx, ly) => {
        if (lx === 0 || ly === 0) return b.rim;
        if (lx === m.w - 1 || ly === m.d - 1) return b.trim;
        if (ly % P === P - 1) {
          if (lx % 6 === 0) return b.line;
          return hash2(Math.floor(lx / 18), Math.floor(ly / P), lot.seed) < 0.28
            ? IND.mercuryGlow
            : mixc(PAL.windowNight, b.roof, 0.3);
        }
        return lx % 4 === 0 ? b.roofLine : b.roof;
      },
      b.wall,
      b.west,
    );
    solid.west(m, westCladding(b, rise));
    const glows: number[] = [];
    solid.south(m, claddingFace(b, m.w, rise, lot.seed, { glows }));
    scene.add(solid.item());
    for (const gx of glows)
      out.pools.push({
        x: lot.x + gx,
        y: lot.y + lot.h + 4,
        radii: [10, 18],
        tint: TINT_SODIUM,
        squashY: 1.5,
      });
  });
}

function hall(scene: Scene, lot: Lot, out: LightOut, rise: number): void {
  const b = BUILDINGS[lot.family]!;
  const m: Mass = { x: lot.x, y: lot.y, w: lot.w, d: lot.h, r: rise, base: 0 };
  const G = Math.min(12, Math.round(lot.h * 0.18));
  scene.solid(m.x, m.y, m.w, m.d, m.r + G);
  scene.later(() => {
    const solid = new Solid(scene, [m], G + 10, 2);
    const mid = (m.d - 1) / 2;
    solid.roofShaped(
      m,
      (_lx, ly) => Math.round(G * (1 - Math.abs(ly - mid) / mid)),
      (lx, ly) => {
        if (Math.abs(ly - mid) < 1.5)
          return lx % 5 === 0
            ? b.line
            : hash2(Math.floor(lx / 20), 1, lot.seed) < 0.3
              ? IND.mercuryGlow
              : mixc(PAL.windowNight, b.roof, 0.3);
        if (ly === 0 || lx === 0) return b.rimLow;
        if (ly === m.d - 1) return b.inner;
        return ly < mid
          ? lx % 3 === 0
            ? b.roofAlt
            : b.roof
          : lx % 3 === 0
            ? b.roofLine
            : mixc(b.roofLine, b.inner, 0.4);
      },
      b.wall,
      b.west,
    );
    solid.west(m, westCladding(b, rise));
    const glows: number[] = [];
    solid.south(m, claddingFace(b, m.w, rise, lot.seed, { glows }));
    scene.add(solid.item());
    for (const gx of glows)
      out.pools.push({
        x: lot.x + gx,
        y: lot.y + lot.h + 4,
        radii: [10, 18],
        tint: TINT_SODIUM,
        squashY: 1.5,
      });
  });
}

/** Flat-roofed plant house with ducts, pipes, a vent stack with a beacon. */
function plant(scene: Scene, lot: Lot, out: LightOut, rise: number): void {
  const b = BUILDINGS[lot.family]!;
  const m: Mass = { x: lot.x, y: lot.y, w: lot.w, d: lot.h, r: rise, base: 0 };
  scene.solid(m.x, m.y, m.w, m.d, m.r);
  const rnd = mulberry32(lot.seed ^ 0x51);
  scene.later(() => {
    const solid = new Solid(scene, [m], 40, 2);
    solid.roof(m, (lx, ly) => {
      if (lx === 0 || ly === 0) return b.rim;
      if (lx === m.w - 1 || ly === m.d - 1) return b.trim;
      if (lx < 3 || ly < 3) return b.inner;
      return lx % 16 === 15 || ly % 16 === 15 ? b.roofLine : b.roof;
    });
    solid.west(m, westCladding(b, rise));
    const glows: number[] = [];
    solid.south(m, claddingFace(b, m.w, rise, lot.seed, { glows }));
    const cv = solid.cv;
    // Pipes across the roof.
    for (let k = 0; k < 2 + ((rnd() * 2) | 0); k++) {
      const py = 6 + ((rnd() * Math.max(1, m.d - 12)) | 0);
      solid.onRoof(m, py + 2, () => {
        const x0 = solid.roofX(m, 4);
        const y0 = solid.roofY(m, py);
        for (let x = 0; x < m.w - 8; x++) {
          cv.set(x0 + x, y0 - 2, x % 9 === 4 ? PAL.steelHi : PAL.steelLight);
          cv.set(x0 + x, y0 - 1, PAL.steelDark);
          cv.set(x0 + x + 1, y0, darker(b.roof, 0.4));
        }
      });
    }
    // A stack.
    if (m.w >= 30 && m.d >= 24 && rnd() < 0.35) {
      const sx = 6 + ((rnd() * (m.w - 16)) | 0);
      const sy = 6 + ((rnd() * (m.d - 14)) | 0);
      solid.onRoof(m, sy + 6, () => {
        const x0 = solid.roofX(m, sx);
        const y0 = solid.roofY(m, sy);
        const H = 26;
        for (let v = 0; v < H; v++) {
          const px = x0 + leanOf(v);
          cv.set(px, y0 - v, PAL.steelLight);
          cv.set(px + 1, y0 - v, PAL.steel);
          cv.set(px + 2, y0 - v, PAL.steel);
          cv.set(px + 3, y0 - v, PAL.steelDark);
          if (v % 8 === 7)
            for (let k = 0; k < 4; k++)
              cv.set(px + k, y0 - v, k & 1 ? IND.hazardBlack : IND.hazardYellow);
        }
        emissive(cv, () => cv.set(x0 + leanOf(H) + 1, y0 - H, PAL.red));
      });
    }
    scene.add(solid.item());
    for (const gx of glows)
      out.pools.push({
        x: lot.x + gx,
        y: lot.y + lot.h + 4,
        radii: [10, 18],
        tint: TINT_SODIUM,
        squashY: 1.5,
      });
  });
}

/** A short cylindrical tank seen in the oblique view, with a ladder and a cap. */
export function tank(
  scene: Scene,
  cx: number,
  cy: number,
  R: number,
  rise: number,
  b: BuildingRamp,
  band: Color | null,
): void {
  const foot = { x: cx - R, y: cy - R, w: 2 * R, h: 2 * R };
  scene.solid(foot.x, foot.y, foot.w, foot.h, rise);
  scene.later(() => {
    const lean = leanOf(rise);
    const cv = Canvas.solid(2 * R + lean + 6, 2 * R + rise + 6);
    const ox = cx - R - 2;
    const oy = cy - R - rise - 3;
    for (let v = 0; v <= rise; v++) {
      cv.curKey = cy + R;
      for (let dx = -R; dx <= R; dx++) {
        const dy = Math.round(Math.sqrt(Math.max(0, R * R - dx * dx)));
        const t = dx / R;
        let c: Color = t < -0.55 ? b.edge : t < -0.1 ? b.west : t < 0.45 ? b.wall : b.wallLow;
        if (band && v > rise * 0.55 && v < rise * 0.7) c = t < 0.2 ? band : darker(band, 0.35);
        if (scene.shaded(cx + dx, cy + dy, v)) c = mixc(c, b.deep, 0.45);
        cv.set(cx + dx + leanOf(v) - ox, cy + dy - v - oy, v === 0 ? PAL.ink : c);
      }
    }
    for (let v = 2; v < rise - 2; v++) {
      const lx = cx - Math.round(R * 0.6) + leanOf(v) - ox;
      const ly = cy + Math.round(R * 0.8) - v - oy;
      cv.set(lx, ly, PAL.steelDark);
      cv.set(lx + 2, ly, PAL.steelDark);
      if (v % 3 === 0) cv.set(lx + 1, ly, PAL.steel);
    }
    const tcx = cx + lean - ox;
    const tcy = cy - rise - oy;
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > R + 0.35) continue;
        let c: Color =
          d > R - 1.5 ? (dx + dy < 0 ? b.rim : b.trim) : dx + dy < -R * 0.5 ? b.rimLow : b.roof;
        if (Math.abs(dx) < 1 && Math.abs(dy) < R - 2) c = b.roofLine;
        if (scene.shaded(cx + dx, cy + dy, rise + 1)) c = mixc(c, b.deep, 0.45);
        cv.set(tcx + dx, tcy + dy, c);
      }
    scene.add({ art: cv, x: ox, y: oy, baseY: cy + R });
  });
}

function tankFarm(scene: Scene, lot: Lot, rise: number): void {
  const b = BUILDINGS[5]!;
  const R = Math.max(10, Math.min(22, Math.floor(Math.min(lot.w, lot.h) / 2) - 6));
  const step = 2 * R + 8;
  const nx = Math.max(1, Math.floor((lot.w - 4) / step));
  const ny = Math.max(1, Math.floor((lot.h - 4) / step));
  const r = Math.max(14, Math.min(rise, 26 + R));
  // A low bund wall round the farm, then the tanks back to front.
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const cx = lot.x + 4 + R + i * step + ((lot.w - 8 - nx * step + 8) >> 1);
      const cy = lot.y + 4 + R + j * step + ((lot.h - 8 - ny * step + 8) >> 1);
      if (scene.maxRise(cx - R, cy - R, 2 * R, 2 * R, r) < r) continue;
      tank(scene, cx, cy, R, r, b, (i + j) % 2 === 0 ? IND.hazardYellowDim : null);
    }
}

function containerYard(scene: Scene, lot: Lot): void {
  const rnd = mulberry32(lot.seed);
  for (let y = lot.y + 16 + 13; y < lot.y + lot.h - 2; y += 16 + 4) {
    for (let x = lot.x + 2; x + 30 < lot.x + lot.w - 2; x += 33) {
      if (rnd() < 0.2) continue;
      const sp = containerSprite(true, LIVERIES[(rnd() * LIVERIES.length) | 0]!, rnd() < 0.45);
      if (!scene.spriteFits(sp, x + sp.ax, y)) continue;
      scene.place(sp, x + sp.ax, y);
      scene.footprint(x, y - 13, 30, 13, 6);
    }
  }
}

/** Builds every untagged lot as a works building of a kind suited to its size. */
export function buildWorks(
  scene: Scene,
  layout: CityLayout,
  out: LightOut,
  skip: (lot: Lot) => boolean,
  inHall: (lot: Lot) => boolean = () => false,
): void {
  for (const lot of layout.lots) {
    if (!lot || lot.tag || skip(lot)) continue;
    const roll = hash2(lot.id, lot.x, 6007);
    const area = lot.w * lot.h;
    const cap = lot.cap;
    if (cap < 14) continue;
    // A hall's bays are big and tall, with no yards between them.
    const tall = inHall(lot) ? 18 : 0;
    if (!tall && area > 9000 && roll < 0.25) tankFarm(scene, lot, cap);
    else if (!tall && area > 6000 && roll < 0.45) containerYard(scene, lot);
    else if (lot.w >= 60 && lot.h >= 36 && roll < 0.7)
      shed(scene, lot, out, Math.max(14, Math.min(cap - 6, 32 + tall + (((roll * 40) | 0) % 20))));
    else if (lot.w >= 40 && lot.h >= 30 && roll < 0.88)
      hall(scene, lot, out, Math.max(14, Math.min(cap - 12, 36 + tall + (((roll * 97) | 0) % 24))));
    else plant(scene, lot, out, Math.max(12, Math.min(cap, 24 + tall + (((roll * 53) | 0) % 22))));
  }
}

// --- Halls the road runs through -----------------------------------------------------------

export type HallZone = { id: string; name: string; rects: Rect[] };

export function inZone(z: HallZone, x: number, y: number): boolean {
  return z.rects.some((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h);
}

/**
 * A hall's walls: a thick clad wall along the zone's boundary wherever it is solid ground,
 * raised as an extrusion so it steps back automatically where the road passes through. The
 * roof is cut away so the floor and the road inside show; its trusses are overlays.
 */
export function hallWalls(ctx: BakeContext, scene: Scene, z: HallZone, rise: number): void {
  const { field } = ctx;
  const { w, h } = field;
  const T = 10;
  const b = BUILDINGS[0]!;
  const wall = new Uint8Array(w * h);
  for (const r of z.rects)
    for (let y = Math.max(0, r.y); y < Math.min(h, r.y + r.h); y++)
      for (let x = Math.max(0, r.x); x < Math.min(w, r.x + r.w); x++) {
        // Near the boundary of the union, and not inside another rect's interior.
        let edgeD = 999;
        for (const q of [
          [-T, 0],
          [T, 0],
          [0, -T],
          [0, T],
        ] as const) {
          for (let k = 1; k <= T; k++) {
            const xx = x + (q[0] * k) / T;
            const yy = y + (q[1] * k) / T;
            if (!inZone(z, xx, yy)) {
              edgeD = Math.min(edgeD, k);
              break;
            }
          }
        }
        if (edgeD <= T && field.edge[y * w + x]! > BARRIER_REACH + 1) wall[y * w + x] = 1;
      }
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  for (const r of z.rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  scene.extrude({
    x0,
    y0,
    x1,
    y1,
    shadow: 8,
    rise: (x, y) => (wall[y * w + x] ? rise : 0),
    top: (x, y) => ((x + y) % 9 === 0 ? b.roofLine : (y & 3) === 0 ? b.rim : b.roof),
    side: (x, y, v) => {
      if (v === 0) return PAL.ink;
      if (v < 4) return (Math.floor((x + y) / 3) & 1) === 0 ? IND.hazardYellow : IND.hazardBlack;
      if (v >= rise - 2) return b.rimLow;
      if (v % 14 === 9 && x % 12 < 7) return hash2(x >> 2, v, 7) < 0.5 ? IND.mercuryGlow : b.line;
      return x % 3 === 2 ? b.wallAlt : b.wall;
    },
  });
  void T;
}

/**
 * Roof trusses spanning the road inside a hall, each its own small fading overlay, each with a
 * mercury lamp hanging from it whose cold pool lights the floor below.
 */
export function hallTrusses(
  ctx: BakeContext,
  scene: Scene,
  z: HallZone,
  out: LightOut,
  rise: number,
): number {
  const main = ctx.track.main;
  let n = 0;
  const R = Math.round(rise * 0.62);
  for (let s = 20; s < main.length; s += 84) {
    const p = sampleBranch(main, s);
    if (!inZone(z, p.x, p.y)) continue;
    const reach = p.halfWidth + p.shoulder + 18;
    // Perpendicular to the road.
    const nx = -p.ty;
    const ny = p.tx;
    const ax = p.x - nx * reach;
    const ay = p.y - ny * reach;
    const bx = p.x + nx * reach;
    const by = p.y + ny * reach;
    const minX = Math.floor(Math.min(ax, bx)) - 4;
    const minY = Math.floor(Math.min(ay, by)) - R - 6;
    const W = Math.ceil(Math.abs(bx - ax)) + 10;
    const H = Math.ceil(Math.abs(by - ay)) + 12;
    const cv = Canvas.sprite(W, H);
    const len = Math.hypot(bx - ax, by - ay);
    for (let t = 0; t <= len; t += 0.5) {
      const gx = ax + ((bx - ax) * t) / len - minX;
      const gy = ay + ((by - ay) * t) / len - R - minY;
      const x = Math.round(gx);
      const y = Math.round(gy);
      // Two chords and lacing between them, seen from above.
      cv.set(x, y, PAL.steelLight);
      cv.set(x, y + 3, PAL.steelDark);
      const lace = Math.floor(t) % 8;
      cv.set(x, y + (lace < 4 ? lace : 7 - lace) * 0.75 + 0.5, PAL.steel);
    }
    // Lamp hanging under the middle.
    const lx = Math.round(p.x - minX);
    const ly = Math.round(p.y - R - minY + 6);
    cv.vline(lx, ly - 4, 4, PAL.inkSoft);
    cv.rect(lx - 2, ly, 5, 2, PAL.steelDark);
    cv.setA(lx - 1, ly + 2, IND.mercury, 255);
    cv.setA(lx, ly + 2, IND.mercury, 255);
    cv.setA(lx + 1, ly + 2, IND.mercury, 255);
    scene.add({
      art: cv,
      x: minX,
      y: minY,
      baseY: Math.ceil(Math.max(ay, by)),
      overlay: { id: `${z.id}_truss_${n}`, kind: 'truss', fade: true },
    });
    if (n % 2 === 0) {
      out.pools.push({ x: p.x, y: p.y, radii: [22, 42], tint: TINT_MERCURY });
      out.lights.push({
        x: Math.round(p.x),
        y: Math.round(p.y - R + 8),
        radius: 56,
        color: '#D6F2E4',
        intensity: 0.9,
      });
    }
    n++;
  }
  return n;
}

/** Machines on a hall floor: presses, coil stacks, benches; each inside a free cell. */
export function hallMachines(ctx: BakeContext, scene: Scene, z: HallZone, out: LightOut): number {
  const { field } = ctx;
  let n = 0;
  const rnd = mulberry32(z.id.length * 977 + z.rects[0]!.x);
  for (const r of z.rects)
    for (let y = r.y + 14; y + 26 < r.y + r.h - 12; y += 34)
      for (let x = r.x + 14; x + 30 < r.x + r.w - 14; x += 40) {
        const mw = 22 + ((rnd() * 10) | 0);
        const md = 14 + ((rnd() * 8) | 0);
        let clear = true;
        for (let yy = y - 26; yy < y + md + 4 && clear; yy += 3)
          for (let xx = x - 4; xx < x + mw + 16 && clear; xx += 3) {
            const e =
              field.edge[
                Math.max(0, Math.min(field.h - 1, yy)) * field.w +
                  Math.max(0, Math.min(field.w - 1, xx))
              ]!;
            if (e <= BARRIER_REACH + 4) clear = false;
          }
        if (!clear) continue;
        const rise = Math.min(scene.maxRise(x, y, mw, md, 26), 12 + ((rnd() * 14) | 0));
        if (rise < 8) continue;
        machine(scene, x, y, mw, md, rise, rnd() < 0.5);
        out.pools.push({ x: x + mw / 2, y: y + md + 4, radii: [8, 14], tint: TINT_MERCURY });
        n++;
      }
  return n;
}

function machine(
  scene: Scene,
  x: number,
  y: number,
  w: number,
  d: number,
  rise: number,
  press: boolean,
): void {
  const b = BUILDINGS[press ? 2 : 3]!;
  const m: Mass = { x, y, w, d, r: rise, base: 0 };
  scene.solid(x, y, w, d, rise);
  scene.later(() => {
    const solid = new Solid(scene, [m], 18, 1);
    solid.roof(m, (lx, ly) =>
      lx === 0 || ly === 0
        ? b.rim
        : lx === w - 1 || ly === d - 1
          ? b.trim
          : (lx + ly) % 7 === 0
            ? b.roofLine
            : b.roof,
    );
    solid.west(m, (_u, v) => (v <= 1 ? b.westLine : v % 5 === 4 ? b.westAlt : b.west));
    const face = Canvas.sprite(w, rise);
    for (let ly = 0; ly < rise; ly++)
      for (let lx = 0; lx < w; lx++) face.set(lx, ly, ly < 2 ? b.trim : b.wall);
    for (let k = 0; k < w; k++)
      face.set(k, rise - 3, (k >> 1) % 2 === 0 ? IND.hazardYellow : IND.hazardBlack);
    emissive(face, () => {
      face.set(3, 4, PAL.mint);
      face.set(5, 4, PAL.red);
    });
    face.hline(0, rise - 1, w, PAL.ink);
    solid.south(m, face);
    if (press)
      solid.onRoof(m, d >> 1, () => {
        // The press head on two columns.
        const px = solid.roofX(m, 3);
        const py = solid.roofY(m, 2);
        for (const cx of [px, px + w - 8])
          for (let v = 0; v < 12; v++) {
            solid.cv.set(cx + leanOf(v), py - v, PAL.steelLight);
            solid.cv.set(cx + 1 + leanOf(v), py - v, PAL.steelDark);
          }
        for (let k = 0; k < w - 4; k++) {
          solid.cv.set(px + k + 4, py - 12, lighter(b.roof, 0.1));
          solid.cv.set(px + k + 4, py - 11, b.roof);
          solid.cv.set(px + k + 4, py - 10, b.wall);
        }
      });
    scene.add(solid.item());
  });
  void drawText;
}
