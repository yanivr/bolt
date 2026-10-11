import { join, resolve } from 'node:path';
import { CHASSIS, CHASSIS_LIST } from '@bolt/content';
import { CAR_HEADINGS, CAR_TILT, CAR_Z_SCALE, TAU } from '@bolt/shared';
import { FOUR_CYLINDER_ART } from './cars/engines.js';
import { PAINTS, PAINT_KEY, PAINT_OUTLINE_KEY } from './cars/materials.js';
import { ALL_CHASSIS_ART } from './cars/registry-chassis.js';
import type { ChassisArt } from './cars/types.js';
import { STREET_WHEEL_ART } from './cars/wheels.js';
import { footprintShadow, renderModel } from './lib/model.js';
import type { RGBA } from './lib/pixels.js';
import { PixelBuffer, hex, writePng } from './lib/pixels.js';

/**
 * Chassis review sheets, independent of the main baker.
 *
 *   npx tsx art/scripts/preview-chassis.ts needle crab      per-chassis sheets
 *   npx tsx art/scripts/preview-chassis.ts --sheets         silhouettes and lineups of all 20
 *   npx tsx art/scripts/preview-chassis.ts --fit [ids...]   64-heading cell margin and timing
 *
 * Per chassis it writes, under art/preview/chassis:
 *   <name>_4x.png         ten headings with street wheels and the four-cylinder engine
 *   <name>_1x.png         the same ten headings at game size
 *   <name>_mounts_4x.png  a straight-down fit view (body bounds, wheel wells, mount boxes)
 *                         and three tilted headings with a cross at every mount, lifted by
 *                         its mount height
 */

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = join(ROOT, 'art/preview/chassis');
const ROAD = hex('#3b4152');
const SHADOW: RGBA = [8, 10, 22, 120];
const DEG = Math.PI / 180;
const SHEET_HEADINGS = [0, 45, 90, 135, 180, 225, 270, 315, 22.5, 202.5];

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const names = args.filter((a) => !a.startsWith('--'));
const artById = new Map(ALL_CHASSIS_ART.map((a) => [a.id, a]));

function rotated(x: number, y: number, rad: number): { x: number; y: number } {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: x * c - y * s, y: x * s + y * c };
}

const wheelCache = new Map<number, ReturnType<typeof renderModel>>();
function wheelAt(heading: number): ReturnType<typeof renderModel> {
  const key = Math.round(heading / DEG / 0.5);
  let hit = wheelCache.get(key);
  if (!hit) {
    hit = renderModel(STREET_WHEEL_ART.model(0), {
      heading,
      width: STREET_WHEEL_ART.cell,
      height: STREET_WHEEL_ART.cell,
      tilt: CAR_TILT,
      zScale: CAR_Z_SCALE,
    });
    wheelCache.set(key, hit);
  }
  return hit;
}

const engineCache = new Map<number, PixelBuffer>();
function engineAt(heading: number): PixelBuffer {
  const key = Math.round(heading / DEG / 0.5);
  let hit = engineCache.get(key);
  if (!hit) {
    hit = renderModel(FOUR_CYLINDER_ART.model, {
      heading,
      width: FOUR_CYLINDER_ART.cell,
      height: FOUR_CYLINDER_ART.cell,
      tilt: CAR_TILT,
      zScale: CAR_Z_SCALE,
    }).image;
    engineCache.set(key, hit);
  }
  return hit;
}

/** Same exact-color palette swap the client performs at load. */
function repaint(src: PixelBuffer, paintId: string): PixelBuffer {
  const paint = PAINTS[paintId];
  if (!paint || paintId === 'paint_signal') return src;
  const from = [PAINT_OUTLINE_KEY, ...PAINT_KEY].map((c) => hex(c));
  const to = [paint.outline, ...paint.ramp].map((c) => hex(c));
  const out = new PixelBuffer(src.width, src.height);
  out.data.set(src.data);
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i + 3] === 0) continue;
    for (let k = 0; k < from.length; k++) {
      const f = from[k]!;
      if (out.data[i] === f[0] && out.data[i + 1] === f[1] && out.data[i + 2] === f[2]) {
        const t = to[k]!;
        out.data[i] = t[0];
        out.data[i + 1] = t[1];
        out.data[i + 2] = t[2];
        break;
      }
    }
  }
  return out;
}

type Composite = { image: PixelBuffer; mask: PixelBuffer; body: PixelBuffer };

/** One assembled car on a transparent cell: shadow, wheels, body, engine. */
function compose(
  art: ChassisArt,
  headingDeg: number,
  cell: number,
  opts: { paint?: string; tilt?: number; engine?: boolean } = {},
): Composite {
  const def = CHASSIS[art.id];
  if (!def) throw new Error(`No chassis definition for ${art.id}`);
  const heading = headingDeg * DEG;
  const tilt = opts.tilt ?? CAR_TILT;
  const base = renderModel(art.model, {
    heading,
    width: cell,
    height: cell,
    tilt,
    zScale: CAR_Z_SCALE,
  });
  const c = cell / 2;
  const wheel = wheelAt(heading);
  const feet = footprintShadow(base, SHADOW);
  const wheels = new PixelBuffer(cell, cell);
  for (const anchor of def.wheelAnchors) {
    const p = rotated(anchor.x, anchor.y, heading);
    const wx = c + Math.round(p.x) - wheel.image.width / 2;
    const wy = c + Math.round(p.y) - wheel.image.height / 2;
    feet.blit(footprintShadow(wheel, SHADOW), wx, wy);
    wheels.blit(wheel.image, wx, wy);
  }
  const image = new PixelBuffer(cell, cell);
  for (let y = 0; y < cell; y++)
    for (let x = 0; x < cell; x++) if (feet.alphaAt(x, y) !== 0) image.blend(x + 2, y + 3, SHADOW);
  image.blit(wheels, 0, 0);
  const body = repaint(base.image, opts.paint ?? 'paint_signal');
  image.blit(body, 0, 0);
  if (opts.engine !== false) {
    const e = rotated(art.engineAnchor.x, art.engineAnchor.y, heading);
    const sprite = engineAt(heading);
    image.blit(
      sprite,
      c + Math.round(e.x) - sprite.width / 2,
      c + Math.round(e.y) - sprite.height / 2,
    );
  }
  const mask = new PixelBuffer(cell, cell);
  mask.blit(wheels, 0, 0);
  mask.blit(base.image, 0, 0);
  return { image, mask, body: base.image };
}

function onRoad(w: number, h: number): PixelBuffer {
  const out = new PixelBuffer(w, h);
  out.fill(ROAD);
  return out;
}

function cross(img: PixelBuffer, x: number, y: number, arm: number, color: RGBA): void {
  const dark: RGBA = [0, 0, 0, 255];
  for (let i = -arm; i <= arm; i++) {
    for (const t of [-1, 0, 1]) {
      img.set(x + i, y + t, dark);
      img.set(x + t, y + i, dark);
    }
  }
  for (let i = -arm + 1; i <= arm - 1; i++) {
    img.set(x + i, y, color);
    img.set(x, y + i, color);
  }
}

function box(
  img: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: RGBA,
  dash = 0,
): void {
  for (let x = x0; x <= x1; x++) {
    if (dash && Math.floor(x / dash) % 2) continue;
    img.set(x, y0, color);
    img.set(x, y1, color);
  }
  for (let y = y0; y <= y1; y++) {
    if (dash && Math.floor(y / dash) % 2) continue;
    img.set(x0, y, color);
    img.set(x1, y, color);
  }
}

function chassisSheets(art: ChassisArt): void {
  const def = CHASSIS[art.id]!;
  const name = art.id.replace('chassis_', '');
  const cell = art.cell;
  const started = performance.now();

  const columns = 5;
  const rows = Math.ceil(SHEET_HEADINGS.length / columns);
  const sheet = onRoad(cell * columns, cell * rows);
  SHEET_HEADINGS.forEach((deg, i) => {
    sheet.blit(compose(art, deg, cell).image, (i % columns) * cell, Math.floor(i / columns) * cell);
  });
  writePng(join(OUT, `${name}_4x.png`), sheet.scaled(4));
  const strip = onRoad(cell * SHEET_HEADINGS.length, cell);
  SHEET_HEADINGS.forEach((_deg, i) => {
    strip.copyFrom(
      sheet,
      (i % columns) * cell,
      Math.floor(i / columns) * cell,
      cell,
      cell,
      i * cell,
      0,
    );
  });
  writePng(join(OUT, `${name}_1x.png`), strip);

  // Fit view and mount crosses.
  const s = 4;
  const fitHeadings = [0, 45, 90, 180];
  const small = onRoad(cell * (fitHeadings.length + 1), cell);
  small.blit(compose(art, 0, cell, { tilt: 0, engine: false }).image, 0, 0);
  fitHeadings.forEach((deg, i) => small.blit(compose(art, deg, cell).image, (i + 1) * cell, 0));
  const big = small.scaled(s);
  const c = cell / 2;
  const px = (v: number) => Math.round((c + v) * s);
  box(
    big,
    px(-def.bodyHalfWidth),
    px(-def.bodyHalfLength),
    px(def.bodyHalfWidth),
    px(def.bodyHalfLength),
    [255, 255, 255, 255],
    4,
  );
  for (const w of def.wheelAnchors)
    box(big, px(w.x - 4), px(w.y - 7), px(w.x + 4), px(w.y + 7), [90, 255, 120, 255]);
  for (const m of def.mounts) {
    const engine = m.categories.includes('ENGINE');
    const color: RGBA = engine ? [80, 220, 255, 255] : [255, 230, 70, 255];
    box(
      big,
      px(m.x - m.maxFootprint.w / 2),
      px(m.y - m.maxFootprint.h / 2),
      px(m.x + m.maxFootprint.w / 2),
      px(m.y + m.maxFootprint.h / 2),
      color,
      engine ? 2 : 0,
    );
  }
  fitHeadings.forEach((deg, i) => {
    for (const m of def.mounts) {
      if (m.categories.includes('ENGINE')) continue;
      const p = rotated(m.x, m.y, deg * DEG);
      const z = art.mountHeights?.[m.id] ?? 10;
      cross(
        big,
        Math.round(((i + 1) * cell + c + p.x) * s),
        Math.round((c + p.y - CAR_TILT * CAR_Z_SCALE * z) * s),
        5,
        [255, 80, 240, 255],
      );
    }
  });
  writePng(join(OUT, `${name}_mounts_4x.png`), big);

  const missing = def.mounts
    .filter((m) => !m.categories.includes('ENGINE') && art.mountHeights?.[m.id] === undefined)
    .map((m) => m.id);
  const e = def.mounts.find((m) => m.categories.includes('ENGINE'));
  const engineOk = e && e.x === art.engineAnchor.x && e.y === art.engineAnchor.y;
  console.log(
    `${name}: sheets in ${((performance.now() - started) / 1000).toFixed(1)} s` +
      (missing.length ? `  MISSING mountHeights: ${missing.join(', ')}` : '') +
      (engineOk ? '' : '  ENGINE ANCHOR MISMATCH'),
  );
}

/** Renders all 64 headings, as the baker does, and reports the clear margin of the cell. */
function fit(art: ChassisArt): void {
  const started = performance.now();
  let margin = Infinity;
  let worst = 0;
  for (let h = 0; h < CAR_HEADINGS; h++) {
    const image = renderModel(art.model, {
      heading: (h * TAU) / CAR_HEADINGS,
      width: art.cell,
      height: art.cell,
      tilt: CAR_TILT,
      zScale: CAR_Z_SCALE,
    }).image;
    const b = image.bounds();
    if (!b) continue;
    const m = Math.min(b.x, b.y, art.cell - (b.x + b.w), art.cell - (b.y + b.h));
    if (m < margin) {
      margin = m;
      worst = h;
    }
  }
  const secs = (performance.now() - started) / 1000;
  console.log(
    `${art.id}: cell ${art.cell}, clear margin ${margin} px (heading ${worst}), 64 frames in ${secs.toFixed(1)} s${margin < 1 ? '  TOO TIGHT' : ''}`,
  );
}

function allSheets(): void {
  const cell = 128;
  const arts = CHASSIS_LIST.map((d) => artById.get(d.id)).filter((a): a is ChassisArt => !!a);
  const columns = 5;
  const rows = Math.ceil(arts.length / columns);
  const ink = hex('#0b0e18');

  // Silhouettes at two headings: body plus wheels, no color, no detail.
  const combined = onRoad(cell * columns * 2, cell * rows);
  [0, 45].forEach((deg, k) => {
    const sil = onRoad(cell * columns, cell * rows);
    arts.forEach((art, i) => {
      const { mask } = compose(art, deg, cell);
      const ox = (i % columns) * cell;
      const oy = Math.floor(i / columns) * cell;
      for (let y = 0; y < cell; y++)
        for (let x = 0; x < cell; x++) if (mask.alphaAt(x, y) !== 0) sil.set(ox + x, oy + y, ink);
    });
    writePng(join(OUT, `silhouettes_${deg}_2x.png`), sil.scaled(2));
    combined.blit(sil, k * cell * columns, 0);
  });
  writePng(join(OUT, 'silhouettes_1x.png'), combined);

  // Lineups in two paints at different headings.
  const lineups: Array<[string, number]> = [
    ['paint_signal', 45],
    ['paint_cobalt', 200],
  ];
  const small = onRoad(cell * columns * 2, cell * rows);
  lineups.forEach(([paint, deg], k) => {
    const sheet = onRoad(cell * columns, cell * rows);
    arts.forEach((art, i) => {
      sheet.blit(
        compose(art, deg, cell, { paint }).image,
        (i % columns) * cell,
        Math.floor(i / columns) * cell,
      );
    });
    writePng(join(OUT, `lineup_${paint.replace('paint_', '')}_3x.png`), sheet.scaled(3));
    small.blit(sheet, k * cell * columns, 0);
  });
  writePng(join(OUT, 'lineup_1x.png'), small);
  console.log(`sheets: ${arts.length} chassis`);
}

function main(): void {
  const wanted = names.map((n) => (n.startsWith('chassis_') ? n : `chassis_${n}`));
  for (const id of wanted) if (!artById.has(id)) throw new Error(`No chassis art for ${id}`);
  const arts = wanted.length ? wanted.map((id) => artById.get(id)!) : ALL_CHASSIS_ART;
  if (flags.has('--fit')) {
    for (const art of arts) fit(art);
    return;
  }
  if (flags.has('--sheets')) {
    allSheets();
    return;
  }
  for (const art of arts) chassisSheets(art);
}

main();
