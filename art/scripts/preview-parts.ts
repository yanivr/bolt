import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ACCESSORIES, CHASSIS } from '@bolt/content';
import type { AccessoryDefinition, ChassisDefinition, MountPoint } from '@bolt/shared';
import {
  CAR_HEADINGS,
  CAR_TILT,
  CAR_Z_SCALE,
  TAU,
  WHEEL_HEADINGS,
  allowedRotations,
  mountAccepts,
  rotatedFootprint,
} from '@bolt/shared';
import { BEETLE_ART } from './cars/beetle.js';
import { SPIDER_ART } from './cars/benchmarks.js';
import { PICKUP_ART } from './cars/chassis/pickup.js';
import { FOUR_CYLINDER_ART } from './cars/engines.js';
import { ALL_PART_ART } from './cars/registry-parts.js';
import type { ChassisArt, PartArt } from './cars/types.js';
import { STREET_WHEEL_ART } from './cars/wheels.js';
import type { Model, Solid } from './lib/model.js';
import { renderModel } from './lib/model.js';
import type { RGBA } from './lib/pixels.js';
import { PixelBuffer, hex, writePng } from './lib/pixels.js';

/**
 * Review sheets for mounted parts, rendered with the baker's own camera.
 *
 *   npx tsx art/scripts/preview-parts.ts              every part, overviews and loaded cars
 *   npx tsx art/scripts/preview-parts.ts weapon_turret utility_radar     just those parts
 *   npx tsx art/scripts/preview-parts.ts --check      footprint, cell margin and bake time
 *
 * Per part: eight headings alone at 6x, the automatic 32 and 24 pixel icons, and the part
 * mounted on a car at four headings (the last panel outlines the catalog footprint).
 */

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = join(ROOT, 'art/preview/parts');
const BG = hex('#3a4257');
const PANEL = hex('#2c3346');
const ICON_HEADING = (-3 * TAU) / 32;
const CAR_CELL = 96;

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const wantedIds = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ART = new Map(ALL_PART_ART.map((a) => [a.id, a]));

const view = (heading: number, cell: number) => ({
  heading,
  width: cell,
  height: cell,
  tilt: CAR_TILT,
  zScale: CAR_Z_SCALE,
});

// --- Icons, exactly as the baker renders them --------------------------------------------------

function modelExtent(model: Model): number {
  let extent = 4;
  for (let y = -64; y <= 64; y += 1) {
    for (let x = -64; x <= 64; x += 1) {
      for (const solid of model.solids) {
        if (solid.shape(x, y) <= 0) {
          extent = Math.max(extent, Math.hypot(x, y) + (solid.z1 * CAR_Z_SCALE * CAR_TILT) / 2);
          break;
        }
      }
    }
  }
  return extent;
}

function icon(model: Model, size: number): PixelBuffer {
  const scale = (size / 2 - 2) / modelExtent(model);
  return renderModel(model, {
    heading: ICON_HEADING,
    width: size,
    height: size,
    tilt: CAR_TILT,
    zScale: CAR_Z_SCALE,
    scale,
    originY: size / 2 + 1,
  }).image;
}

// --- Cars --------------------------------------------------------------------------------------

type Car = { art: ChassisArt; def: ChassisDefinition };
const CARS: Car[] = [BEETLE_ART, PICKUP_ART, SPIDER_ART].map((art) => ({
  art,
  def: CHASSIS[art.id]!,
}));

function heightAt(solid: Solid, x: number, y: number): number {
  const d = solid.shape(x, y);
  if (d > 0) return -Infinity;
  if (solid.height) return solid.height(x, y, d);
  const bevel = solid.bevel ?? 0;
  if (bevel <= 0) return solid.z1;
  const t = Math.max(0, Math.min(1, -d / bevel));
  const f = solid.profile === 'linear' ? t : Math.sqrt(1 - (1 - t) * (1 - t));
  return solid.z0 + (solid.z1 - solid.z0) * f;
}

/** Height of the bodywork under a mount, unless the chassis art states one. */
function mountHeight(car: Car, mount: MountPoint): number {
  const stated = car.art.mountHeights?.[mount.id];
  if (stated !== undefined) return stated;
  let z = 0;
  for (const [dx, dy] of [
    [0, 0],
    [-2, 0],
    [2, 0],
    [0, -2],
    [0, 2],
  ] as const) {
    for (const solid of car.art.model.solids) {
      if (solid.noShadow) continue;
      z = Math.max(z, heightAt(solid, mount.x + dx, mount.y + dy));
    }
  }
  return Math.round(z * 2) / 2;
}

const bodyCache = new Map<string, PixelBuffer>();
function carBase(car: Car, frame: number): PixelBuffer {
  const key = `${car.art.id}:${frame}`;
  let base = bodyCache.get(key);
  if (!base) {
    const heading = (frame * TAU) / CAR_HEADINGS;
    base = new PixelBuffer(CAR_CELL, CAR_CELL);
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    const wheelFrame = Math.round((frame * WHEEL_HEADINGS) / CAR_HEADINGS) % WHEEL_HEADINGS;
    const wheel = renderModel(
      STREET_WHEEL_ART.model(0),
      view((wheelFrame * TAU) / WHEEL_HEADINGS, STREET_WHEEL_ART.cell),
    ).image;
    for (const a of car.def.wheelAnchors) {
      base.blit(
        wheel,
        Math.round(CAR_CELL / 2 + (a.x * c - a.y * s) - wheel.width / 2),
        Math.round(CAR_CELL / 2 + (a.x * s + a.y * c) - wheel.height / 2),
      );
    }
    base.blit(renderModel(car.art.model, view(heading, car.art.cell)).image, 0, 0);
    const e = car.art.engineAnchor;
    const engine = renderModel(FOUR_CYLINDER_ART.model, view(heading, FOUR_CYLINDER_ART.cell));
    base.blit(
      engine.image,
      Math.round(CAR_CELL / 2 + Math.round(e.x * c - e.y * s) - FOUR_CYLINDER_ART.cell / 2),
      Math.round(CAR_CELL / 2 + Math.round(e.x * s + e.y * c) - FOUR_CYLINDER_ART.cell / 2),
    );
    bodyCache.set(key, base);
  }
  const copy = new PixelBuffer(CAR_CELL, CAR_CELL);
  copy.data.set(base.data);
  return copy;
}

type Placed = {
  art: PartArt;
  def: AccessoryDefinition;
  x: number;
  y: number;
  z: number;
  turns: number;
};

const partFrameCache = new Map<string, PixelBuffer>();
function partFrame(art: PartArt, frame: number): PixelBuffer {
  const key = `${art.id}:${frame}`;
  let img = partFrameCache.get(key);
  if (!img) {
    img = renderModel(art.model, view((frame * TAU) / CAR_HEADINGS, art.cell)).image;
    partFrameCache.set(key, img);
  }
  return img;
}

/** Same placement arithmetic as `layoutCar`: rotate, lift by the mount height, far side first. */
function composeCar(car: Car, frame: number, parts: Placed[], debug = false): PixelBuffer {
  const out = carBase(car, frame);
  const heading = (frame * TAU) / CAR_HEADINGS;
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const placed = parts.map((p) => ({ p, x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
  placed.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const { p, x, y } of placed) {
    const img = partFrame(p.art, (((frame + p.turns * (CAR_HEADINGS / 4)) % 64) + 64) % 64);
    const dx = Math.round(x);
    const dy = Math.round(y - CAR_TILT * CAR_Z_SCALE * p.z);
    out.blit(
      img,
      Math.round(CAR_CELL / 2 + dx - img.width / 2),
      Math.round(CAR_CELL / 2 + dy - img.height / 2),
    );
    if (debug && frame === 0) {
      const size = rotatedFootprint(p.def.footprint, p.turns as 0 | 1 | 2 | 3);
      const x0 = Math.round(CAR_CELL / 2 + p.x - size.w / 2);
      const y0 = Math.round(CAR_CELL / 2 + dy - size.h / 2);
      const line: RGBA = [120, 255, 200, 150];
      for (let i = 0; i < size.w; i++) {
        out.blend(x0 + i, y0, line);
        out.blend(x0 + i, y0 + size.h - 1, line);
      }
      for (let i = 1; i < size.h - 1; i++) {
        out.blend(x0, y0 + i, line);
        out.blend(x0 + size.w - 1, y0 + i, line);
      }
    }
  }
  return out;
}

/** The first mount, on the first car that has one, a part can legally take. */
function placeOn(
  def: AccessoryDefinition,
  prefer?: { chassis?: string; mount?: string; turns?: number },
): { car: Car; placed: Omit<Placed, 'art'>; mount: MountPoint } | null {
  const cars = prefer?.chassis ? CARS.filter((k) => k.art.id === prefer.chassis) : CARS;
  for (const category of def.compatibleMounts) {
    for (const car of cars) {
      for (const mount of car.def.mounts) {
        if (prefer?.mount && mount.id !== prefer.mount) continue;
        if (!mount.categories.includes(category) || !mountAccepts(mount, def)) continue;
        for (const turns of allowedRotations(mount, def)) {
          if (prefer?.turns !== undefined && turns !== prefer.turns) continue;
          const size = rotatedFootprint(def.footprint, turns);
          if (size.w > mount.maxFootprint.w || size.h > mount.maxFootprint.h) continue;
          return {
            car,
            mount,
            placed: { def, x: mount.x, y: mount.y, z: mountHeight(car, mount), turns },
          };
        }
      }
    }
  }
  // Nothing matched by category: show it on the Pickup's open bed, which takes any part.
  if (!prefer) {
    const car = CARS[1]!;
    const mount = car.def.mounts.find((m) => m.id === 'bed_rear')!;
    return {
      car,
      mount,
      placed: { def, x: mount.x, y: mount.y, z: mountHeight(car, mount), turns: 0 },
    };
  }
  return null;
}

// --- Measurements ------------------------------------------------------------------------------

/** Ground bounds of a model, to compare with the catalog footprint. */
function groundBounds(model: Model): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = -24; y <= 24; y += 0.1) {
    for (let x = -24; x <= 24; x += 0.1) {
      if (!model.solids.some((s) => s.tag !== 'iconFit' && s.shape(x, y) <= 0)) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  return { x0, y0, x1, y1 };
}

function check(ids: string[]): void {
  let total = 0;
  const rows: string[] = [];
  for (const id of ids) {
    const art = ART.get(id)!;
    const def = ACCESSORIES[id]!;
    const b = groundBounds(art.model);
    const overX = Math.max(0, -def.footprint.w / 2 - b.x0, b.x1 - def.footprint.w / 2);
    const overY = Math.max(0, -def.footprint.h / 2 - b.y0, b.y1 - def.footprint.h / 2);
    const started = performance.now();
    let touches = 0;
    let top = art.cell;
    for (let h = 0; h < CAR_HEADINGS; h++) {
      const img = renderModel(art.model, view((h * TAU) / CAR_HEADINGS, art.cell)).image;
      const box = img.bounds();
      if (!box) continue;
      top = Math.min(top, box.x, box.y, art.cell - box.x - box.w, art.cell - box.y - box.h);
      if (box.x < 1 || box.y < 1 || box.x + box.w > art.cell - 1 || box.y + box.h > art.cell - 1)
        touches++;
    }
    const seconds = (performance.now() - started) / 1000;
    total += seconds;
    const zTop = Math.max(...art.model.solids.map((s) => s.z1));
    rows.push(
      [
        id.padEnd(24),
        `cell ${art.cell}`,
        `margin ${String(top).padStart(2)}`,
        `foot ${def.footprint.w}x${def.footprint.h}`.padEnd(11),
        `model ${(b.x1 - b.x0).toFixed(1)}x${(b.y1 - b.y0).toFixed(1)}`.padEnd(16),
        `tall ${zTop.toFixed(1)}`.padEnd(10),
        `${seconds.toFixed(2)} s`,
        overX > 0.15 || overY > 0.15 ? `OVER by ${overX.toFixed(1)} x ${overY.toFixed(1)}` : '',
        touches > 0 ? `TOUCHES CELL EDGE in ${touches} frames` : '',
        art.model.solids.length > 0 ? `${art.model.solids.length} solids` : '',
      ].join('  '),
    );
  }
  console.log(rows.join('\n'));
  console.log(`total ${total.toFixed(1)} s for ${ids.length} parts`);
}

// --- Sheets ------------------------------------------------------------------------------------

function crop(
  src: PixelBuffer,
  size: number,
  cx = src.width / 2,
  cy = src.height / 2,
): PixelBuffer {
  const out = new PixelBuffer(size, size);
  out.copyFrom(src, Math.round(cx - size / 2), Math.round(cy - size / 2), size, size, 0, 0);
  return out;
}

function onBg(src: PixelBuffer, bg: RGBA = BG): PixelBuffer {
  const out = new PixelBuffer(src.width, src.height);
  out.fill(bg);
  out.blit(src, 0, 0);
  return out;
}

const CAR_FRAMES = [0, 12, 28, 44];
const CAR_CROP = 80;

function partSheet(art: PartArt): void {
  const def = ACCESSORIES[art.id]!;
  const cell = art.cell;
  const aloneW = 4 * cell * 6;
  const aloneH = 2 * cell * 6;
  const carW = 4 * CAR_CROP * 4;
  const sheetW = Math.max(aloneW + 280, carW + CAR_CROP * 4 + 16);
  const sheet = new PixelBuffer(sheetW, aloneH + CAR_CROP * 4 + 8);
  sheet.fill(PANEL);
  for (let i = 0; i < 8; i++) {
    const img = onBg(partFrame(art, i * 8)).scaled(6);
    sheet.blit(img, (i % 4) * cell * 6, Math.floor(i / 4) * cell * 6);
  }
  // Icons at 4x and at true size, on the panel color the garage uses and on the track tone.
  const i32 = icon(art.model, 32);
  const i24 = icon(art.model, 24);
  sheet.blit(onBg(i32).scaled(4), aloneW + 8, 8);
  sheet.blit(onBg(i24).scaled(4), aloneW + 144, 8);
  sheet.blit(onBg(i32, hex('#151a28')), aloneW + 8, 144);
  sheet.blit(onBg(i24, hex('#151a28')), aloneW + 48, 144);
  sheet.blit(onBg(partFrame(art, 0)), aloneW + 8, 190);
  sheet.blit(onBg(partFrame(art, 20)), aloneW + 8 + cell + 4, 190);
  sheet.blit(onBg(partFrame(art, 40)), aloneW + 8 + 2 * (cell + 4), 190);

  const spot = placeOn(def);
  if (spot) {
    const placed: Placed = { ...spot.placed, art };
    CAR_FRAMES.forEach((frame, i) => {
      const car = composeCar(spot.car, frame, [placed]);
      sheet.blit(onBg(crop(car, CAR_CROP)).scaled(4), i * CAR_CROP * 4, aloneH + 8);
    });
    const debug = composeCar(spot.car, 0, [placed], true);
    sheet.blit(onBg(crop(debug, CAR_CROP)).scaled(4), carW + 16, aloneH + 8);
    // True-size cars, tucked beside the icons.
    CAR_FRAMES.forEach((frame, i) => {
      const car = onBg(crop(composeCar(spot.car, frame, [placed]), 64));
      sheet.blit(car, aloneW + 8 + (i % 4) * 66, 190 + cell + 8);
    });
  }
  writePng(join(OUT, `${art.id}.png`), sheet);
}

function overview(name: string, arts: PartArt[]): void {
  // Alone, two poses each, 5x.
  const tile = 36;
  const cols = 5;
  const rows = Math.ceil(arts.length / cols);
  const alone = new PixelBuffer(cols * tile * 2, rows * tile);
  alone.fill(BG);
  arts.forEach((art, i) => {
    const x = (i % cols) * tile * 2;
    const y = Math.floor(i / cols) * tile;
    alone.blit(crop(partFrame(art, 58), tile), x, y);
    alone.blit(crop(partFrame(art, 22), tile), x + tile, y);
    for (let k = 0; k < tile; k++) alone.blend(x, y + k, [255, 255, 255, 18]);
  });
  writePng(join(OUT, `_overview_${name}_5x.png`), alone.scaled(5));

  // Icons: 32 px row over a 24 px row, on the dark panel tone, 4x.
  const icons = new PixelBuffer(10 * 34, 2 * 34 + 2 * 26);
  icons.fill(hex('#151a28'));
  arts.forEach((art, i) => {
    icons.blit(icon(art.model, 32), (i % 10) * 34 + 1, Math.floor(i / 10) * 34 + 1);
    icons.blit(icon(art.model, 24), (i % 10) * 34 + 5, 68 + Math.floor(i / 10) * 26 + 1);
  });
  writePng(join(OUT, `_icons_${name}_4x.png`), icons.scaled(4));

  // Mounted, one heading each at 3x, with the same sheet at true size beside it.
  const crop1 = 72;
  const mounted = new PixelBuffer(cols * crop1, rows * crop1);
  mounted.fill(BG);
  arts.forEach((art, i) => {
    const spot = placeOn(ACCESSORIES[art.id]!);
    if (!spot) return;
    const car = composeCar(spot.car, i % 2 === 0 ? 6 : 26, [{ ...spot.placed, art }]);
    mounted.blit(crop(car, crop1), (i % cols) * crop1, Math.floor(i / cols) * crop1);
  });
  writePng(join(OUT, `_mounted_${name}_3x.png`), mounted.scaled(3));
  writePng(join(OUT, `_mounted_${name}_1x.png`), mounted);
}

/** Compact review rows for a batch of parts: five headings, both icons, three mounted views. */
function stripSheet(name: string, arts: PartArt[]): void {
  const tile = 36;
  const carCrop = 68;
  const rowH = carCrop * 3 + 4;
  const sheet = new PixelBuffer(5 * tile * 5 + 140 + 3 * carCrop * 3 + 70, rowH * arts.length);
  sheet.fill(PANEL);
  arts.forEach((art, row) => {
    const y = row * rowH;
    [0, 10, 22, 32, 52].forEach((frame, i) => {
      sheet.blit(onBg(crop(partFrame(art, frame), tile)).scaled(5), i * tile * 5, y + 10);
    });
    const x = 5 * tile * 5 + 6;
    sheet.blit(onBg(icon(art.model, 32), hex('#151a28')).scaled(3), x, y + 2);
    sheet.blit(onBg(icon(art.model, 24), hex('#151a28')).scaled(3), x, y + 102);
    sheet.blit(onBg(icon(art.model, 32), hex('#151a28')), x + 100, y + 2);
    sheet.blit(onBg(icon(art.model, 24), hex('#151a28')), x + 100, y + 40);
    const spot = placeOn(ACCESSORIES[art.id]!);
    if (!spot) return;
    const placed: Placed = { ...spot.placed, art };
    [0, 12, 28].forEach((frame, i) => {
      const car = composeCar(spot.car, frame, [placed], i === 0);
      sheet.blit(onBg(crop(car, carCrop)).scaled(3), x + 136 + i * carCrop * 3, y);
    });
    [44, 20].forEach((frame, i) => {
      const car = composeCar(spot.car, frame, [placed]);
      sheet.blit(onBg(crop(car, 64)), x + 138 + 3 * carCrop * 3, y + 4 + i * 66);
    });
  });
  writePng(join(OUT, `_strip_${name}.png`), sheet);
}

type LoadoutEntry = { part: string; mount: string; turns?: number };
function loadedCar(name: string, chassis: string, entries: LoadoutEntry[]): void {
  const car = CARS.find((k) => k.art.id === chassis)!;
  const parts: Placed[] = [];
  for (const entry of entries) {
    const art = ART.get(entry.part);
    const def = ACCESSORIES[entry.part];
    if (!art || !def) continue;
    const spot = placeOn(def, { chassis, mount: entry.mount, turns: entry.turns });
    if (!spot) {
      console.warn(`${name}: ${entry.part} does not fit ${entry.mount}`);
      continue;
    }
    parts.push({ ...spot.placed, art });
  }
  const frames = [0, 10, 22, 32, 42, 54];
  const row = new PixelBuffer(frames.length * CAR_CELL, CAR_CELL * 2);
  row.fill(BG);
  frames.forEach((frame, i) => {
    row.blit(composeCar(car, frame, parts), i * CAR_CELL, 0);
    row.blit(composeCar(car, frame, []), i * CAR_CELL, CAR_CELL);
  });
  writePng(join(OUT, `_loaded_${name}_4x.png`), row.scaled(4));
  writePng(join(OUT, `_loaded_${name}_1x.png`), row);
}

function main(): void {
  mkdirSync(OUT, { recursive: true });
  const ids = wantedIds.length > 0 ? wantedIds : ALL_PART_ART.map((a) => a.id);
  for (const id of ids) {
    if (!ART.has(id)) throw new Error(`No part art registered for ${id}`);
    if (!ACCESSORIES[id]) throw new Error(`${id} is not in the catalog`);
  }
  if (flags.has('--check')) {
    check(ids);
    return;
  }
  const started = performance.now();
  const stripFlag = [...flags].find((f) => f.startsWith('--strip'));
  if (stripFlag) {
    stripSheet(
      stripFlag.split('=')[1] ?? 'batch',
      ids.map((id) => ART.get(id)!),
    );
    return;
  }
  if (!flags.has('--no-parts')) for (const id of ids) partSheet(ART.get(id)!);
  if (wantedIds.length === 0 || flags.has('--overview')) {
    for (const [name, prefix] of [
      ['weapons', 'weapon_'],
      ['defenses', 'defense_'],
      ['utilities', 'utility_'],
    ] as const) {
      const arts = ALL_PART_ART.filter((a) => a.id.startsWith(prefix));
      if (arts.length > 0) overview(name, arts);
    }
    loadedCar('beetle', 'chassis_beetle', [
      { part: 'weapon_homing', mount: 'roof_mid' },
      { part: 'weapon_front_mg', mount: 'front_center' },
      { part: 'weapon_rear_mg', mount: 'rear_center' },
      { part: 'utility_spare', mount: 'left_utility' },
      { part: 'utility_nitro', mount: 'right_utility' },
    ]);
    loadedCar('pickup', 'chassis_pickup', [
      { part: 'utility_radar', mount: 'roof_cab' },
      { part: 'utility_repair', mount: 'bed_front' },
      { part: 'weapon_rear_mg', mount: 'left_bed' },
      { part: 'utility_fan', mount: 'right_bed' },
      { part: 'weapon_mortar', mount: 'bed_rear' },
      { part: 'defense_rear_bumper', mount: 'rear_center' },
    ]);
    loadedCar('spider', 'chassis_spider', [
      { part: 'utility_minesensor', mount: 'front_utility' },
      { part: 'weapon_homing', mount: 'roof_front' },
      { part: 'defense_energy_shield', mount: 'roof_mid' },
      { part: 'weapon_flame', mount: 'left_front' },
      { part: 'defense_heavy_plate', mount: 'right_front' },
      { part: 'utility_battery', mount: 'left_rear' },
      { part: 'weapon_tesla', mount: 'right_rear' },
      { part: 'utility_generator', mount: 'rear_utility' },
    ]);
  }
  console.log(`previews in ${((performance.now() - started) / 1000).toFixed(1)} s`);
}

main();
