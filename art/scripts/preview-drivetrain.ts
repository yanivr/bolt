import { join, resolve } from 'node:path';
import { CHASSIS } from '@bolt/content';
import type {
  CarPose,
  ChassisSpriteManifest,
  EngineSpriteManifest,
  WheelSpriteManifest,
} from '@bolt/shared';
import { CAR_HEADINGS, CAR_TILT, CAR_Z_SCALE, TAU, WHEEL_HEADINGS, layoutCar } from '@bolt/shared';
import { BEETLE_ART } from './cars/beetle.js';
import { SPIDER_ART, TURTLE_ART } from './cars/benchmarks.js';
import { PAINTS, PAINT_KEY, PAINT_OUTLINE_KEY } from './cars/materials.js';
import { ALL_ENGINE_ART } from './cars/registry-engines.js';
import { ALL_WHEEL_ART } from './cars/registry-wheels.js';
import type { ChassisArt, EngineArt, WheelArt } from './cars/types.js';
import type { Model } from './lib/model.js';
import { footprintShadow, renderModel, silhouette } from './lib/model.js';
import type { RGBA } from './lib/pixels.js';
import { PixelBuffer, hex, writePng } from './lib/pixels.js';

/**
 * Review sheets for engines and wheel kits, rendered with the baker's camera.
 *
 *   npx tsx art/scripts/preview-drivetrain.ts            every part plus the two overviews
 *   npx tsx art/scripts/preview-drivetrain.ts engine_v8  just the named parts
 *   npx tsx art/scripts/preview-drivetrain.ts --overview only the overviews
 *
 * Per engine: `<id>_6x.png` (eight headings alone) and `<id>_on_cars_4x.png` (Beetle, Turtle).
 * Per wheel kit: `<id>_8x.png` (eight directions by every roll frame), `<id>_dirs_4x.png` (all
 * 32 directions, to check for flicker between neighbours) and `<id>_on_cars_4x.png` (Beetle,
 * Spider, front wheels steered). Every frame is also checked against its cell border.
 */

const OUT = resolve(import.meta.dirname, '../preview/drivetrain');
const ASPHALT = hex('#333a4c');
const PANEL = hex('#2a3040');
const SHADOW: RGBA = [8, 10, 22, 120];
const SHADOW_RIM: RGBA = [8, 10, 22, 56];
const INK = hex('#c9d3e6');
const WARN = hex('#ff6f80');

const view = (heading: number, cell: number) => ({
  heading,
  width: cell,
  height: cell,
  tilt: CAR_TILT,
  zScale: CAR_Z_SCALE,
});

// --- A tiny 3 x 5 label font -------------------------------------------------------------------

const GLYPHS: Record<string, string> = {
  A: '010101111101101',
  B: '110101110101110',
  C: '011100100100011',
  D: '110101101101110',
  E: '111100110100111',
  F: '111100110100100',
  G: '011100101101011',
  H: '101101111101101',
  I: '111010010010111',
  J: '001001001101010',
  K: '101101110101101',
  L: '100100100100111',
  M: '101111111101101',
  N: '110101101101101',
  O: '010101101101010',
  P: '110101110100100',
  Q: '010101101110011',
  R: '110101110101101',
  S: '011100010001110',
  T: '111010010010010',
  U: '101101101101111',
  V: '101101101101010',
  W: '101101111111101',
  X: '101101010101101',
  Y: '101101010010010',
  Z: '111001010100111',
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '110001010100111',
  '3': '110001010001110',
  '4': '101101111001001',
  '5': '111100110001110',
  '6': '011100110101010',
  '7': '111001010010010',
  '8': '010101010101010',
  '9': '010101011001110',
  '-': '000000111000000',
  '.': '000000000000010',
};

function label(buf: PixelBuffer, text: string, x: number, y: number, color: RGBA = INK): void {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const glyph = GLYPHS[ch === '_' ? '-' : ch];
    if (glyph) {
      for (let i = 0; i < 15; i++) {
        if (glyph[i] === '1') buf.set(cx + (i % 3), y + Math.floor(i / 3), color);
      }
    }
    cx += 4;
  }
}

const shortName = (id: string): string => id.replace(/^(engine|tires)_/, '').replace(/_/g, ' ');

// --- Frame caches ------------------------------------------------------------------------------

const clipped = new Set<string>();
/** Milliseconds spent rendering each part's own frames, and how many frames that was. */
const cost = new Map<string, { ms: number; frames: number }>();
function timed<T>(id: string, render: () => T): T {
  const t = performance.now();
  const result = render();
  const slot = cost.get(id) ?? { ms: 0, frames: 0 };
  slot.ms += performance.now() - t;
  slot.frames += 1;
  cost.set(id, slot);
  return result;
}
const perFrame = (id: string): number => {
  const slot = cost.get(id);
  return slot ? slot.ms / slot.frames : 0;
};

function touchesBorder(image: PixelBuffer): boolean {
  const { width: w, height: h } = image;
  for (let i = 0; i < w; i++) if (image.alphaAt(i, 0) || image.alphaAt(i, h - 1)) return true;
  for (let j = 0; j < h; j++) if (image.alphaAt(0, j) || image.alphaAt(w - 1, j)) return true;
  return false;
}

function opaque(image: PixelBuffer): number {
  let count = 0;
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] !== 0) count++;
  return count;
}

/**
 * A frame that reaches the edge of its cell may have lost pixels. Render it again with room to
 * spare and compare: any difference means the cell is too small for the part.
 */
function checkBorder(id: string, image: PixelBuffer, model: Model, heading: number): void {
  if (clipped.has(id) || !touchesBorder(image)) return;
  const roomy = renderModel(model, view(heading, image.width + 8)).image;
  if (opaque(roomy) !== opaque(image)) clipped.add(id);
}

const engineCache = new Map<string, PixelBuffer>();
function engineFrame(art: EngineArt, frame: number): PixelBuffer {
  const key = `${art.id}:${frame}`;
  let image = engineCache.get(key);
  if (!image) {
    const heading = (frame * TAU) / CAR_HEADINGS;
    image = timed(art.id, () => renderModel(art.model, view(heading, art.cell)).image);
    checkBorder(art.id, image, art.model, heading);
    engineCache.set(key, image);
  }
  return image;
}

type WheelFrame = { image: PixelBuffer; feet: PixelBuffer };
const wheelCache = new Map<string, WheelFrame>();
function wheelFrame(art: WheelArt, dir: number, roll: number): WheelFrame {
  const key = `${art.id}:${dir}:${roll}`;
  let hit = wheelCache.get(key);
  if (!hit) {
    const heading = (dir * TAU) / WHEEL_HEADINGS;
    const model = art.model(roll);
    const result = timed(art.id, () => renderModel(model, view(heading, art.cell)));
    checkBorder(art.id, result.image, model, heading);
    hit = { image: result.image, feet: footprintShadow(result, SHADOW) };
    wheelCache.set(key, hit);
  }
  return hit;
}

type BodyFrame = { image: PixelBuffer; feet: PixelBuffer };
const bodyCache = new Map<string, BodyFrame>();
function bodyFrame(art: ChassisArt, frame: number): BodyFrame {
  const key = `${art.id}:${frame}`;
  let hit = bodyCache.get(key);
  if (!hit) {
    const result = renderModel(art.model, view((frame * TAU) / CAR_HEADINGS, art.cell));
    hit = { image: result.image, feet: footprintShadow(result, SHADOW) };
    bodyCache.set(key, hit);
  }
  return hit;
}

function repaint(src: PixelBuffer, paintId: string): PixelBuffer {
  const paint = PAINTS[paintId]!;
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

// --- Car compositing: the game's own layout function, drawn into a buffer ----------------------

const STREET = ALL_WHEEL_ART[0]!;

function composeCar(
  chassis: ChassisArt,
  wheel: WheelArt,
  engine: EngineArt | null,
  pose: CarPose,
  paintId: string,
  size: number,
): PixelBuffer {
  const def = CHASSIS[chassis.id];
  if (!def) throw new Error(`No chassis definition for ${chassis.id}`);
  const chassisManifest = {
    id: chassis.id,
    wheelAnchors: def.wheelAnchors.map((w) => ({ id: w.id, x: w.x, y: w.y, steers: w.steers })),
    engineAnchor: chassis.engineAnchor,
  } as unknown as ChassisSpriteManifest;
  const wheelManifest = { id: wheel.id, rollFrames: wheel.rollFrames } as WheelSpriteManifest;
  const engineManifest = { id: engine?.id ?? 'none' } as EngineSpriteManifest;
  const out = new PixelBuffer(size, size);
  const c = size / 2;
  const put = (frame: PixelBuffer, dx: number, dy: number) =>
    out.blit(frame, Math.round(c + dx - frame.width / 2), Math.round(c + dy - frame.height / 2));

  for (const op of layoutCar(chassisManifest, wheelManifest, engineManifest, pose)) {
    if (op.kind === 'shadow') {
      // Same recipe as the baker: body footprint plus street-tire footprints at the anchors.
      const body = bodyFrame(chassis, op.frame);
      const feet = new PixelBuffer(chassis.cell, chassis.cell);
      feet.blit(body.feet, 0, 0);
      const heading = (op.frame * TAU) / CAR_HEADINGS;
      for (const anchor of def.wheelAnchors) {
        const wx = Math.round(anchor.x * Math.cos(heading) - anchor.y * Math.sin(heading));
        const wy = Math.round(anchor.x * Math.sin(heading) + anchor.y * Math.cos(heading));
        const dir = Math.round((op.frame * WHEEL_HEADINGS) / CAR_HEADINGS) % WHEEL_HEADINGS;
        const foot = wheelFrame(STREET, dir, 0).feet;
        feet.blit(
          foot,
          chassis.cell / 2 + wx - foot.width / 2,
          chassis.cell / 2 + wy - foot.height / 2,
        );
      }
      put(silhouette(feet, SHADOW, SHADOW_RIM), op.dx, op.dy);
    } else if (op.kind === 'wheel') {
      const dir = op.frame % WHEEL_HEADINGS;
      const roll = Math.floor(op.frame / WHEEL_HEADINGS);
      put(wheelFrame(wheel, dir, roll).image, op.dx, op.dy);
    } else if (op.kind === 'body') {
      put(repaint(bodyFrame(chassis, op.frame).image, paintId), op.dx, op.dy);
    } else if (op.kind === 'engine' && engine) {
      put(engineFrame(engine, op.frame), op.dx, op.dy);
    }
  }
  return out;
}

const pose = (frame: number, steer = 0, roll = 0): CarPose => ({
  headingRad: (frame * TAU) / CAR_HEADINGS,
  steer,
  roll,
  braking: false,
  headlights: false,
  bodyShiftX: 0,
  bodyShiftY: 0,
});

function canvas(w: number, h: number): PixelBuffer {
  const buf = new PixelBuffer(w, h);
  buf.fill(ASPHALT);
  return buf;
}

/** Blits the centre `size` square of a larger composed frame. */
function blitCentre(dst: PixelBuffer, src: PixelBuffer, x: number, y: number, size: number): void {
  const crop = new PixelBuffer(size, size);
  const off = Math.round((src.width - size) / 2);
  crop.copyFrom(src, off, off, size, size, 0, 0);
  dst.blit(crop, x, y);
}

// --- Per-part sheets ---------------------------------------------------------------------------

const ENGINE_CAR_FRAMES = [0, 10, 26, 44];

function engineSheets(art: EngineArt): void {
  const cell = art.cell;
  const alone = canvas(cell * 4, cell * 2);
  for (let i = 0; i < 8; i++) {
    alone.blit(engineFrame(art, i * 8), (i % 4) * cell, Math.floor(i / 4) * cell);
  }
  writePng(join(OUT, `${art.id}_6x.png`), alone.scaled(6));

  const win = 80;
  const cars = canvas(win * 4, win * 2);
  const rows: Array<[ChassisArt, string]> = [
    [BEETLE_ART, 'paint_signal'],
    [TURTLE_ART, 'paint_mint'],
  ];
  rows.forEach(([chassis, paint], row) => {
    ENGINE_CAR_FRAMES.forEach((frame, col) => {
      const car = composeCar(chassis, STREET, art, pose(frame), paint, 112);
      blitCentre(cars, car, col * win, row * win, win);
    });
  });
  label(cars, shortName(art.id), 2, 2);
  writePng(join(OUT, `${art.id}_on_cars_4x.png`), cars.scaled(4));
}

const WHEEL_CAR_POSES: Array<[number, number]> = [
  [0, 1],
  [10, -1],
  [20, 0.6],
  [44, 0],
];

function wheelSheets(art: WheelArt): void {
  const cell = art.cell;
  const frames = canvas(cell * 8, cell * art.rollFrames);
  for (let r = 0; r < art.rollFrames; r++) {
    for (let d = 0; d < 8; d++) {
      frames.blit(wheelFrame(art, d * 4, r).image, d * cell, r * cell);
    }
  }
  writePng(join(OUT, `${art.id}_8x.png`), frames.scaled(8));

  const dirs = canvas(cell * 16, cell * 2);
  for (let d = 0; d < WHEEL_HEADINGS; d++) {
    dirs.blit(wheelFrame(art, d, 0).image, (d % 16) * cell, Math.floor(d / 16) * cell);
  }
  writePng(join(OUT, `${art.id}_dirs_4x.png`), dirs.scaled(4));

  const beetleWin = 84;
  const spiderWin = 112;
  const cars = canvas(beetleWin * 2 + spiderWin * 2, spiderWin * 2);
  WHEEL_CAR_POSES.forEach(([frame, steer], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const beetle = composeCar(BEETLE_ART, art, null, pose(frame, steer, i), 'paint_signal', 128);
    blitCentre(cars, beetle, col * beetleWin, 14 + row * spiderWin, beetleWin);
    const spider = composeCar(SPIDER_ART, art, null, pose(frame, steer, i), 'paint_sunflare', 128);
    blitCentre(cars, spider, beetleWin * 2 + col * spiderWin, row * spiderWin, spiderWin);
  });
  label(cars, shortName(art.id), 2, 2);
  writePng(join(OUT, `${art.id}_on_cars_4x.png`), cars.scaled(4));
}

// --- Overviews ---------------------------------------------------------------------------------

function engineOverview(): void {
  const cols = 5;
  const tileW = 2 * 46;
  const tileH = 52;
  const rows = Math.ceil(ALL_ENGINE_ART.length / cols);
  const sheet = canvas(cols * tileW, rows * tileH);
  ALL_ENGINE_ART.forEach((art, i) => {
    const x = (i % cols) * tileW;
    const y = Math.floor(i / cols) * tileH;
    sheet.rect(x, y, tileW, 8, PANEL);
    label(sheet, shortName(art.id), x + 2, y + 2, clipped.has(art.id) ? WARN : INK);
    [0, 12].forEach((frame, k) => {
      const car = composeCar(BEETLE_ART, STREET, art, pose(frame), 'paint_signal', 112);
      // Window on the rear deck: follow the engine anchor round the car.
      const heading = (frame * TAU) / CAR_HEADINGS;
      const ax = -BEETLE_ART.engineAnchor.y * Math.sin(heading);
      const ay = BEETLE_ART.engineAnchor.y * Math.cos(heading);
      const crop = new PixelBuffer(46, 44);
      crop.copyFrom(car, Math.round(56 + ax - 23), Math.round(56 + ay - 31), 46, 44, 0, 0);
      sheet.blit(crop, x + k * 46, y + 8);
    });
  });
  writePng(join(OUT, 'overview_engines_4x.png'), sheet.scaled(4));
  writePng(join(OUT, 'overview_engines_1x.png'), sheet);

  // Every engine alone at four headings, ten engines to a sheet.
  const cell = 48;
  for (let page = 0; page * 10 < ALL_ENGINE_ART.length; page++) {
    const arts = ALL_ENGINE_ART.slice(page * 10, page * 10 + 10);
    const contact = canvas(cell * 8, cell * Math.ceil(arts.length / 2));
    arts.forEach((art, i) => {
      const x = (i % 2) * cell * 4;
      const y = Math.floor(i / 2) * cell;
      [0, 10, 26, 44].forEach((frame, k) => {
        const image = engineFrame(art, frame);
        contact.blit(image, x + k * cell + (cell - art.cell) / 2, y + (cell - art.cell) / 2);
      });
      label(contact, shortName(art.id), x + 2, y + 2, clipped.has(art.id) ? WARN : INK);
    });
    const name = `overview_engines_alone_${String.fromCharCode(97 + page)}_4x.png`;
    writePng(join(OUT, name), contact.scaled(4));
  }

  // Whole cars at game size, so each engine can be judged the way a player sees it.
  const win = 72;
  const cars = canvas(10 * win, 2 * win);
  ALL_ENGINE_ART.forEach((art, i) => {
    const car = composeCar(
      BEETLE_ART,
      STREET,
      art,
      pose(i % 2 === 0 ? 4 : 60),
      'paint_cobalt',
      112,
    );
    blitCentre(cars, car, (i % 10) * win, Math.floor(i / 10) * win, win);
  });
  writePng(join(OUT, 'overview_engines_cars_2x.png'), cars.scaled(2));
}

function wheelOverview(): void {
  const cols = 4;
  const tileW = 3 * 32;
  const tileH = 42;
  const rows = Math.ceil(ALL_WHEEL_ART.length / cols);
  const sheet = canvas(cols * tileW, rows * tileH);
  ALL_WHEEL_ART.forEach((art, i) => {
    const x = (i % cols) * tileW;
    const y = Math.floor(i / cols) * tileH;
    sheet.rect(x, y, tileW, 8, PANEL);
    label(sheet, shortName(art.id), x + 2, y + 2, clipped.has(art.id) ? WARN : INK);
    [0, 4, 8].forEach((dir, k) => {
      const frame = wheelFrame(art, dir, 0).image;
      sheet.blit(frame, x + k * 32 + (32 - art.cell) / 2, y + 9 + (32 - art.cell) / 2);
    });
  });
  writePng(join(OUT, 'overview_wheels_4x.png'), sheet.scaled(4));
  writePng(join(OUT, 'overview_wheels_1x.png'), sheet);

  // Every kit at three directions by every roll frame, five kits to a sheet.
  for (let page = 0; page * 5 < ALL_WHEEL_ART.length; page++) {
    const arts = ALL_WHEEL_ART.slice(page * 5, page * 5 + 5);
    const tile = 32;
    const roll = canvas(tile * 12, (tile + 2) * arts.length);
    arts.forEach((art, row) => {
      [0, 4, 8].forEach((dir, k) => {
        for (let r = 0; r < art.rollFrames && r < 4; r++) {
          const frame = wheelFrame(art, dir, r).image;
          const tx = (k * 4 + r) * tile + (tile - art.cell) / 2;
          roll.blit(frame, tx, row * (tile + 2) + (tile - art.cell) / 2);
        }
      });
      label(roll, shortName(art.id), 2, row * (tile + 2) + 1);
    });
    const name = `overview_wheels_roll_${String.fromCharCode(97 + page)}_4x.png`;
    writePng(join(OUT, name), roll.scaled(4));
  }

  const win = 76;
  const cars = canvas(5 * win, Math.ceil(ALL_WHEEL_ART.length / 5) * (win + 8));
  ALL_WHEEL_ART.forEach((art, i) => {
    const x = (i % 5) * win;
    const y = Math.floor(i / 5) * (win + 8);
    label(cars, shortName(art.id), x + 2, y + 2);
    const car = composeCar(BEETLE_ART, art, null, pose(6, -0.8, i), 'paint_signal', 128);
    blitCentre(cars, car, x, y + 8, win);
  });
  writePng(join(OUT, 'overview_wheels_on_beetle_4x.png'), cars.scaled(4));
  writePng(join(OUT, 'overview_wheels_on_beetle_1x.png'), cars);
}

// --- Entry -------------------------------------------------------------------------------------

function main(): void {
  const argv = process.argv.slice(2);
  const overviewOnly = argv.includes('--overview');
  const noOverview = argv.includes('--no-overview');
  const ids = argv.filter((a) => !a.startsWith('--'));
  const wanted = (id: string) => !overviewOnly && (ids.length === 0 || ids.includes(id));
  for (const id of ids) {
    if (![...ALL_ENGINE_ART, ...ALL_WHEEL_ART].some((a) => a.id === id)) {
      throw new Error(`Unknown part ${id}`);
    }
  }

  for (const art of ALL_ENGINE_ART) {
    if (!wanted(art.id)) continue;
    engineSheets(art);
    // The full bake is 64 headings; estimate it from the frames rendered here.
    const bake = (perFrame(art.id) * CAR_HEADINGS) / 1000;
    console.log(`${art.id}: cell ${art.cell}, about ${bake.toFixed(1)} s to bake`);
  }
  for (const art of ALL_WHEEL_ART) {
    if (!wanted(art.id)) continue;
    wheelSheets(art);
    const bake = (perFrame(art.id) * WHEEL_HEADINGS * art.rollFrames) / 1000;
    console.log(
      `${art.id}: cell ${art.cell}, ${art.rollFrames} roll frames, about ${bake.toFixed(1)} s to bake`,
    );
  }
  if (!noOverview && (ids.length === 0 || overviewOnly)) {
    engineOverview();
    wheelOverview();
  }
  for (const id of clipped) console.warn(`CLIPPED: ${id} does not fit its cell`);
  console.log(`sheets in ${OUT}`);
}

main();
