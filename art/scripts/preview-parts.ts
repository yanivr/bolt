import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ACCESSORIES, CHASSIS } from '@bolt/content';
import type { AccessoryDefinition, ChassisDefinition, MountPoint, QuarterTurn } from '@bolt/shared';
import {
  CAR_HEADINGS,
  CAR_TILT,
  CAR_Z_SCALE,
  TAU,
  WHEEL_HEADINGS,
  accessoryMounts,
  allowedRotations,
  fitsMountBox,
  mountAccepts,
  occupiedFootprint,
  partAnchorOffset,
} from '@bolt/shared';
import { PAINTS, PAINT_KEY, PAINT_OUTLINE_KEY } from './cars/materials.js';
import { renderPartFrame } from './cars/parts/frame.js';
import { ALL_CHASSIS_ART } from './cars/registry-chassis.js';
import { ALL_ENGINE_ART } from './cars/registry-engines.js';
import { ALL_PART_ART } from './cars/registry-parts.js';
import type { ChassisArt, PartArt } from './cars/types.js';
import { STREET_WHEEL_ART } from './cars/wheels.js';
import { renderIcon } from './lib/icon.js';
import type { Model } from './lib/model.js';
import { renderModel } from './lib/model.js';
import type { RGBA } from './lib/pixels.js';
import { PixelBuffer, hex, writePng } from './lib/pixels.js';

/**
 * Review sheets for mounted parts, rendered with the baker's own camera and the baker's own
 * part frames (`renderPartFrame`), on the five real chassis with their real mounts, mount
 * heights and default engines. A preview is the pixels the game gets.
 *
 *   npx tsx art/scripts/preview-parts.ts                 everything below
 *   npx tsx art/scripts/preview-parts.ts weapon_turret   review rows for just those parts
 *   npx tsx art/scripts/preview-parts.ts --check         cell margins, anchors and bake time
 *   npx tsx art/scripts/preview-parts.ts --loaded        only the fully loaded cars
 *
 * Review rows (`_review_<category>_<n>.png`, five parts a sheet): the part alone at 5x in
 * three headings; its 32 and 24 pixel icons at 3x and at true size; the part on a car at 3x
 * on each of the four paints; the same at true size; and once at 5x. The questions to ask of
 * every row: can the part be named from the 3x picture on a phone, can its direction be read,
 * does it stand off the body on every paint, and is the icon a full, bright tile.
 *
 * Loaded cars (`_loaded_<chassis>_4x.png` and `_1x.png`): each chassis with every mount
 * filled, six headings on one paint over the two garage views on all four, to check that a
 * full car still reads as a car.
 */

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = join(ROOT, 'art/preview/parts');
const BG = hex('#3a4257');
const PANEL = hex('#2c3346');
const ICON_BG = hex('#151a28');
const CAR_CELL = 112;
const PAINT_IDS = ['paint_signal', 'paint_cobalt', 'paint_mint', 'paint_sunflare'] as const;
/** The garage's two main view headings (of 64) and two race headings. */
const GARAGE_FRAMES = [18, 46];

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

// --- Cars --------------------------------------------------------------------------------------

type Car = { art: ChassisArt; def: ChassisDefinition; engine: Model; engineCell: number };
const CARS: Car[] = ALL_CHASSIS_ART.map((art) => {
  const def = CHASSIS[art.id]!;
  const engine = ALL_ENGINE_ART.find((e) => e.id === def.defaultEngineId)!;
  // The same rule as the baker: an engine in a bay loses the pipes that hang below the deck.
  const model =
    art.engineAnchor.y < 15
      ? { ...engine.model, solids: engine.model.solids.filter((s) => s.z1 >= 9) }
      : engine.model;
  return { art, def, engine: model, engineCell: engine.cell };
});
const carById = (id: string) => CARS.find((c) => c.art.id === id)!;

/** Same exact-color palette swap the client performs at load. */
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

const layerCache = new Map<
  string,
  { wheels: PixelBuffer; body: PixelBuffer; engine: PixelBuffer }
>();
function carLayers(car: Car, frame: number) {
  const key = `${car.art.id}:${frame}`;
  let layers = layerCache.get(key);
  if (!layers) {
    const heading = (frame * TAU) / CAR_HEADINGS;
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    const wheels = new PixelBuffer(CAR_CELL, CAR_CELL);
    const wheelFrame = Math.round((frame * WHEEL_HEADINGS) / CAR_HEADINGS) % WHEEL_HEADINGS;
    const wheel = renderModel(
      STREET_WHEEL_ART.model(0),
      view((wheelFrame * TAU) / WHEEL_HEADINGS, STREET_WHEEL_ART.cell),
    ).image;
    for (const a of car.def.wheelAnchors)
      wheels.blit(
        wheel,
        Math.round(CAR_CELL / 2 + Math.round(a.x * c - a.y * s) - wheel.width / 2),
        Math.round(CAR_CELL / 2 + Math.round(a.x * s + a.y * c) - wheel.height / 2),
      );
    const body = new PixelBuffer(CAR_CELL, CAR_CELL);
    body.blit(
      renderModel(car.art.model, view(heading, car.art.cell)).image,
      (CAR_CELL - car.art.cell) / 2,
      (CAR_CELL - car.art.cell) / 2,
    );
    const engine = new PixelBuffer(CAR_CELL, CAR_CELL);
    const e = car.art.engineAnchor;
    engine.blit(
      renderModel(car.engine, view(heading, car.engineCell)).image,
      Math.round(CAR_CELL / 2 + Math.round(e.x * c - e.y * s) - car.engineCell / 2),
      Math.round(CAR_CELL / 2 + Math.round(e.x * s + e.y * c) - car.engineCell / 2),
    );
    layers = { wheels, body, engine };
    layerCache.set(key, layers);
  }
  return layers;
}

type Placed = {
  art: PartArt;
  def: AccessoryDefinition;
  x: number;
  y: number;
  z: number;
  turns: QuarterTurn;
};

const partFrameCache = new Map<string, PixelBuffer>();
function partFrame(art: PartArt, frame: number): PixelBuffer {
  const key = `${art.id}:${frame}`;
  let img = partFrameCache.get(key);
  if (!img) {
    img = renderPartFrame(art, (frame * TAU) / CAR_HEADINGS);
    partFrameCache.set(key, img);
  }
  return img;
}

/** Same placement arithmetic as `layoutCar`: rotate, lift by the mount height, far side first. */
function composeCar(
  car: Car,
  frame: number,
  parts: Placed[],
  paintId: string = PAINT_IDS[0],
  debug = false,
): PixelBuffer {
  const layers = carLayers(car, frame);
  const out = new PixelBuffer(CAR_CELL, CAR_CELL);
  out.blit(layers.wheels, 0, 0);
  out.blit(repaint(layers.body, paintId), 0, 0);
  out.blit(layers.engine, 0, 0);
  const heading = (frame * TAU) / CAR_HEADINGS;
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const placed = parts.map((p) => ({ p, x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
  placed.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const { p, x, y } of placed) {
    const partFrameIndex = (((frame + p.turns * (CAR_HEADINGS / 4)) % 64) + 64) % 64;
    const img = partFrame(p.art, partFrameIndex);
    const dx = Math.round(x);
    const dy = Math.round(y - CAR_TILT * CAR_Z_SCALE * p.z);
    out.blit(
      img,
      Math.round(CAR_CELL / 2 + dx - img.width / 2),
      Math.round(CAR_CELL / 2 + dy - img.height / 2),
    );
    if (debug) {
      // The base the rules use, and where the manifest says the muzzles and pivot are.
      const size = occupiedFootprint(p.def, p.turns);
      const line: RGBA = [120, 255, 200, 170];
      if (frame === 0) {
        const x0 = Math.round(CAR_CELL / 2 + p.x - size.w / 2);
        const y0 = Math.round(CAR_CELL / 2 + dy - size.h / 2);
        for (let i = 0; i < size.w; i++) {
          out.blend(x0 + i, y0, line);
          out.blend(x0 + i, y0 + size.h - 1, line);
        }
        for (let i = 1; i < size.h - 1; i++) {
          out.blend(x0, y0 + i, line);
          out.blend(x0 + size.w - 1, y0 + i, line);
        }
      }
      const partHeading = (partFrameIndex * TAU) / CAR_HEADINGS;
      const mark = (anchor: { x: number; y: number; z: number }, color: RGBA) => {
        const at = partAnchorOffset(anchor, partHeading);
        out.set(
          Math.round(CAR_CELL / 2 + dx + at.x - 0.5),
          Math.round(CAR_CELL / 2 + dy + at.y - 0.5),
          color,
        );
      };
      for (const m of p.art.muzzles ?? []) mark(m, [255, 40, 255, 255]);
      if (p.art.pivot) mark(p.art.pivot, [40, 255, 60, 255]);
    }
  }
  return out;
}

type Spot = { car: Car; mount: MountPoint; turns: QuarterTurn };

/** Every mount of the five chassis a part can go on, with its default facing there. */
function spotsFor(def: AccessoryDefinition): Spot[] {
  const out: Spot[] = [];
  for (const category of [...def.compatibleMounts, 'UNIVERSAL' as const])
    for (const car of CARS)
      for (const mount of accessoryMounts(car.def)) {
        if (!mount.categories.includes(category)) continue;
        if (!mountAccepts(mount, def) || !fitsMountBox(mount, def)) continue;
        out.push({ car, mount, turns: allowedRotations(mount, def)[0] ?? 0 });
      }
  return out;
}

function mountHeight(car: Car, mount: MountPoint): number {
  return car.art.mountHeights?.[mount.id] ?? 10;
}

function placedAt(art: PartArt, spot: Spot, turns: QuarterTurn = spot.turns): Placed {
  return {
    art,
    def: ACCESSORIES[art.id]!,
    x: spot.mount.x,
    y: spot.mount.y,
    z: mountHeight(spot.car, spot.mount),
    turns,
  };
}

/** Where the review rows show a part: a mount that suits it, varied across the five cars. */
const PREFERRED: Record<string, [chassis: string, mount: string, turns?: QuarterTurn]> = {
  weapon_front_mg: ['chassis_beetle', 'front_center'],
  weapon_rear_mg: ['chassis_trike', 'right_rear'],
  weapon_turret: ['chassis_beetle', 'roof_mid'],
  weapon_shotgun: ['chassis_trike', 'roof_mid'],
  weapon_railshot: ['chassis_arrow', 'roof_mid'],
  weapon_rocket: ['chassis_spider', 'roof_front'],
  weapon_homing: ['chassis_beetle', 'roof_mid'],
  weapon_mine: ['chassis_beetle', 'rear_center'],
  weapon_oil: ['chassis_arrow', 'rear_center'],
  weapon_foam: ['chassis_beetle', 'front_center'],
  weapon_emp: ['chassis_arrow', 'roof_rear'],
  weapon_tesla: ['chassis_spider', 'right_front'],
  weapon_flame: ['chassis_trike', 'front_center'],
  weapon_frost: ['chassis_trike', 'roof_mid'],
  weapon_hammer: ['chassis_beetle', 'front_center'],
  weapon_saw: ['chassis_spider', 'right_front'],
  weapon_harpoon: ['chassis_arrow', 'front_center'],
  weapon_air: ['chassis_spider', 'roof_front'],
  weapon_boomerang: ['chassis_beetle', 'roof_mid'],
  weapon_mortar: ['chassis_pickup', 'bed_rear'],
  defense_light_plate: ['chassis_spider', 'right_front'],
  defense_heavy_plate: ['chassis_beetle', 'front_center'],
  defense_front_bumper: ['chassis_beetle', 'front_center'],
  defense_rear_bumper: ['chassis_pickup', 'rear_center'],
  defense_minesweeper: ['chassis_arrow', 'front_center'],
  defense_energy_shield: ['chassis_beetle', 'roof_mid'],
  defense_antimissile: ['chassis_spider', 'roof_mid'],
  defense_wheel_cage: ['chassis_beetle', 'left_utility'],
  defense_engine_case: ['chassis_spider', 'rear_utility'],
  utility_spare: ['chassis_beetle', 'left_utility'],
  utility_nitro: ['chassis_beetle', 'right_utility'],
  utility_fan: ['chassis_arrow', 'roof_rear'],
  utility_overdrive: ['chassis_trike', 'left_rear'],
  defense_side_panels: ['chassis_spider', 'right_rear'],
  utility_spoiler: ['chassis_beetle', 'rear_center'],
  utility_radar: ['chassis_pickup', 'roof_cab'],
  utility_solar: ['chassis_beetle', 'roof_mid'],
  utility_jump: ['chassis_pickup', 'bed_rear'],
  utility_radiator: ['chassis_beetle', 'front_center'],
  utility_minesensor: ['chassis_spider', 'front_utility'],
  utility_winch: ['chassis_trike', 'front_center'],
};

function reviewSpot(def: AccessoryDefinition, index: number): Spot {
  const spots = spotsFor(def);
  const wanted = PREFERRED[def.id];
  const found = wanted
    ? spots.find((s) => s.car.art.id === wanted[0] && s.mount.id === wanted[1])
    : undefined;
  if (wanted && !found)
    console.warn(`${def.id}: preferred mount ${wanted.join(' ')} does not take it`);
  const spot = found ?? spots[index % Math.max(1, spots.length)];
  if (!spot) throw new Error(`${def.id} fits no mount of the five chassis`);
  return wanted?.[2] !== undefined ? { ...spot, turns: wanted[2] } : spot;
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

/** Where a part's mount point is drawn on the car cell at a heading. */
function mountOnScreen(placed: Placed, frame: number): { x: number; y: number } {
  const heading = (frame * TAU) / CAR_HEADINGS;
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return {
    x: CAR_CELL / 2 + placed.x * c - placed.y * s,
    y: CAR_CELL / 2 + placed.x * s + placed.y * c - CAR_TILT * CAR_Z_SCALE * placed.z,
  };
}

const ALONE = 44;
const CROP = 62;

/** Review rows for a batch of parts. See the header for what is in a row. */
function reviewSheet(name: string, arts: PartArt[], firstIndex = 0): void {
  const rowH = CROP * 5 + 6;
  const aloneW = 3 * ALONE * 5;
  const iconW = 150;
  const paintW = 4 * CROP * 3;
  const trueW = CROP * 2 + 8;
  const bigW = CROP * 5;
  const sheet = new PixelBuffer(aloneW + iconW + paintW + trueW + bigW + 24, rowH * arts.length);
  sheet.fill(PANEL);
  arts.forEach((art, row) => {
    const y = row * rowH;
    const def = ACCESSORIES[art.id]!;
    [0, 22, 52].forEach((frame, i) => {
      sheet.blit(onBg(crop(partFrame(art, frame), ALONE)).scaled(5), i * ALONE * 5, y + 40);
    });
    let x = aloneW + 6;
    sheet.blit(onBg(renderIcon(art.model, 32), ICON_BG).scaled(3), x, y + 4);
    sheet.blit(onBg(renderIcon(art.model, 24), ICON_BG).scaled(3), x, y + 108);
    sheet.blit(onBg(renderIcon(art.model, 32), ICON_BG), x + 104, y + 4);
    sheet.blit(onBg(renderIcon(art.model, 24), ICON_BG), x + 104, y + 44);
    // The icon as the slot tile shows it: one and a half times, on the lighter plate.
    sheet.blit(onBg(renderIcon(art.model, 32), hex('#33415c')).scaled(2), x, y + 190);
    x += iconW;
    const spot = reviewSpot(def, firstIndex + row);
    const placed = placedAt(art, spot);
    PAINT_IDS.forEach((paintId, i) => {
      const frame = GARAGE_FRAMES[i % 2]!;
      const at = mountOnScreen(placed, frame);
      const car = composeCar(spot.car, frame, [placed], paintId);
      sheet.blit(onBg(crop(car, CROP, at.x, at.y)).scaled(3), x + i * CROP * 3, y + 2);
      // The race view under it: the same car heading up the screen and across it.
      const raceFrame = [0, 16, 40, 56][i]!;
      const raceAt = mountOnScreen(placed, raceFrame);
      const race = composeCar(spot.car, raceFrame, [placed], paintId);
      sheet.blit(
        onBg(crop(race, CROP, raceAt.x, raceAt.y)).scaled(2),
        x + i * CROP * 3,
        y + CROP * 3 + 4,
      );
      sheet.blit(
        onBg(crop(race, CROP, raceAt.x, raceAt.y)),
        x + i * CROP * 3 + CROP * 2 + 2,
        y + CROP * 3 + 4,
      );
    });
    x += paintW + 4;
    PAINT_IDS.forEach((paintId, i) => {
      const frame = GARAGE_FRAMES[i % 2]!;
      const car = composeCar(spot.car, frame, [placed], paintId);
      const at = mountOnScreen(placed, frame);
      sheet.blit(
        onBg(crop(car, CROP, at.x, at.y)),
        x + (i % 2) * (CROP + 2),
        y + 2 + Math.floor(i / 2) * (CROP + 2),
      );
    });
    // Heading 0 with the base the rules use, and the muzzle and pivot anchors marked.
    const debugAt = mountOnScreen(placed, 0);
    sheet.blit(
      onBg(
        crop(composeCar(spot.car, 0, [placed], PAINT_IDS[2], true), CROP, debugAt.x, debugAt.y),
      ).scaled(2),
      x,
      y + 2 * CROP + 8,
    );
    x += trueW;
    const bigFrame = GARAGE_FRAMES[0]!;
    const bigAt = mountOnScreen(placed, bigFrame);
    sheet.blit(
      onBg(
        crop(composeCar(spot.car, bigFrame, [placed], PAINT_IDS[row % 4]!), CROP, bigAt.x, bigAt.y),
      ).scaled(5),
      x,
      y + 2,
    );
  });
  writePng(join(OUT, `_review_${name}.png`), sheet);
}

/** All icons of a category: 32 px row over a 24 px row on the panel tone, 4x. */
function iconSheet(name: string, arts: PartArt[]): void {
  const icons = new PixelBuffer(10 * 34, 2 * 34 + 2 * 26);
  icons.fill(ICON_BG);
  arts.forEach((art, i) => {
    icons.blit(renderIcon(art.model, 32), (i % 10) * 34 + 1, Math.floor(i / 10) * 34 + 1);
    icons.blit(renderIcon(art.model, 24), (i % 10) * 34 + 5, 68 + Math.floor(i / 10) * 26 + 1);
  });
  writePng(join(OUT, `_icons_${name}_4x.png`), icons.scaled(4));
  writePng(join(OUT, `_icons_${name}_1x.png`), icons);
}

/** Every part of a category on a car, one heading each, at 3x and at true size. */
function mountedSheet(name: string, arts: PartArt[]): void {
  const cols = 5;
  const tile = 76;
  const rows = Math.ceil(arts.length / cols);
  const sheet = new PixelBuffer(cols * tile, rows * tile);
  sheet.fill(BG);
  arts.forEach((art, i) => {
    const spot = reviewSpot(ACCESSORIES[art.id]!, i);
    const placed = placedAt(art, spot);
    const frame = GARAGE_FRAMES[i % 2]!;
    const car = composeCar(spot.car, frame, [placed], PAINT_IDS[i % 4]!);
    sheet.blit(crop(car, tile), (i % cols) * tile, Math.floor(i / cols) * tile);
  });
  writePng(join(OUT, `_mounted_${name}_3x.png`), sheet.scaled(3));
  writePng(join(OUT, `_mounted_${name}_1x.png`), sheet);
}

type LoadoutEntry = { part: string; mount: string; turns?: QuarterTurn; offset?: [number, number] };

/** Every mount of each chassis filled with something that belongs there. */
const LOADED: Record<string, LoadoutEntry[]> = {
  chassis_beetle: [
    { part: 'weapon_front_mg', mount: 'front_center' },
    { part: 'weapon_homing', mount: 'roof_mid' },
    { part: 'utility_spare', mount: 'left_utility' },
    { part: 'utility_nitro', mount: 'right_utility' },
    { part: 'utility_spoiler', mount: 'rear_center' },
  ],
  chassis_arrow: [
    { part: 'weapon_harpoon', mount: 'front_center' },
    { part: 'weapon_railshot', mount: 'roof_mid' },
    { part: 'utility_fan', mount: 'roof_rear' },
    { part: 'weapon_oil', mount: 'rear_center' },
  ],
  chassis_pickup: [
    { part: 'utility_radar', mount: 'roof_cab' },
    { part: 'utility_repair', mount: 'bed_front', offset: [-5, 0] },
    { part: 'utility_battery', mount: 'bed_front', offset: [5, 0] },
    { part: 'weapon_rear_mg', mount: 'left_bed', turns: 3 },
    { part: 'weapon_flame', mount: 'right_bed', turns: 1 },
    { part: 'weapon_mortar', mount: 'bed_rear' },
    { part: 'defense_rear_bumper', mount: 'rear_center' },
  ],
  chassis_spider: [
    { part: 'utility_minesensor', mount: 'front_utility' },
    { part: 'weapon_saw', mount: 'left_front' },
    { part: 'weapon_front_mg', mount: 'right_front', turns: 0 },
    { part: 'weapon_rocket', mount: 'roof_front' },
    { part: 'weapon_turret', mount: 'roof_mid' },
    { part: 'defense_side_panels', mount: 'left_rear' },
    { part: 'weapon_tesla', mount: 'right_rear' },
    { part: 'utility_generator', mount: 'rear_utility' },
  ],
  chassis_trike: [
    { part: 'weapon_shotgun', mount: 'front_center' },
    { part: 'weapon_frost', mount: 'roof_mid', turns: 1 },
    { part: 'weapon_rear_mg', mount: 'left_rear' },
    { part: 'utility_repair', mount: 'right_rear' },
  ],
};

function loadedParts(chassisId: string): Placed[] {
  const car = carById(chassisId);
  const parts: Placed[] = [];
  for (const entry of LOADED[chassisId] ?? []) {
    const art = ART.get(entry.part);
    const def = ACCESSORIES[entry.part];
    const mount = car.def.mounts.find((m) => m.id === entry.mount);
    if (!art || !def || !mount) throw new Error(`loaded ${chassisId}: unknown ${entry.part}`);
    if (!mountAccepts(mount, def) || !fitsMountBox(mount, def))
      throw new Error(`loaded ${chassisId}: ${entry.part} does not go on ${entry.mount}`);
    const allowed = allowedRotations(mount, def);
    const turns = entry.turns ?? allowed[0] ?? 0;
    if (!allowed.includes(turns))
      throw new Error(`loaded ${chassisId}: ${entry.part} cannot face ${turns} on ${entry.mount}`);
    parts.push({
      art,
      def,
      x: mount.x + (entry.offset?.[0] ?? 0),
      y: mount.y + (entry.offset?.[1] ?? 0),
      z: mountHeight(car, mount),
      turns,
    });
  }
  return parts;
}

function loadedCar(chassisId: string): void {
  const car = carById(chassisId);
  const parts = loadedParts(chassisId);
  const name = chassisId.replace('chassis_', '');
  const frames = [0, 10, 22, 32, 42, 54];
  const cell = 104;
  // Four tiles a row, so the 4x sheet stays small enough to be read pixel for pixel.
  const tiles: PixelBuffer[] = [
    ...frames.map((frame, i) => composeCar(car, frame, parts, PAINT_IDS[i % 4]!)),
    // The two garage views on each paint, with the bare car last for comparison.
    ...PAINT_IDS.map((paintId, i) => composeCar(car, GARAGE_FRAMES[i % 2]!, parts, paintId)),
    composeCar(car, GARAGE_FRAMES[0]!, [], PAINT_IDS[0]),
    composeCar(car, GARAGE_FRAMES[1]!, [], PAINT_IDS[1]),
  ];
  const sheet = new PixelBuffer(4 * cell, 3 * cell);
  sheet.fill(BG);
  tiles.forEach((tile, i) =>
    sheet.blit(crop(tile, cell), (i % 4) * cell, Math.floor(i / 4) * cell),
  );
  writePng(join(OUT, `_loaded_${name}_4x.png`), sheet.scaled(4));
  writePng(join(OUT, `_loaded_${name}_3x.png`), sheet.scaled(3));
  writePng(join(OUT, `_loaded_${name}_5x.png`), sheet.scaled(5));
  writePng(join(OUT, `_loaded_${name}_1x.png`), sheet);
}

// --- Checks ------------------------------------------------------------------------------------

/** Ground bounds of a model, to compare with the catalog footprint. */
function groundBounds(model: Model): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = -30; y <= 30; y += 0.25) {
    for (let x = -30; x <= 30; x += 0.25) {
      if (!model.solids.some((s) => s.shape(x, y) <= 0)) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  return { x0, y0, x1, y1 };
}

function check(ids: string[]): boolean {
  let total = 0;
  let bad = 0;
  const rows: string[] = [];
  for (const id of ids) {
    const art = ART.get(id)!;
    const def = ACCESSORIES[id]!;
    const b = groundBounds(art.model);
    const started = performance.now();
    let margin = art.cell;
    let lost = 0;
    for (let h = 0; h < CAR_HEADINGS; h++) {
      const heading = (h * TAU) / CAR_HEADINGS;
      const img = renderPartFrame(art, heading);
      const box = img.bounds();
      if (!box) continue;
      margin = Math.min(margin, box.x, box.y, art.cell - box.x - box.w, art.cell - box.y - box.h);
      for (const anchor of [...(art.muzzles ?? []), ...(art.pivot ? [art.pivot] : [])]) {
        const at = partAnchorOffset(anchor, heading);
        const px = Math.round(art.cell / 2 + at.x - 0.5);
        const py = Math.round(art.cell / 2 + at.y - 0.5);
        let near = false;
        for (let dy = -2; dy <= 2 && !near; dy++)
          for (let dx = -2; dx <= 2 && !near; dx++) near = img.alphaAt(px + dx, py + dy) !== 0;
        if (!near) lost++;
      }
    }
    const seconds = (performance.now() - started) / 1000;
    total += seconds;
    const problems = [
      margin < 1 ? 'TOUCHES CELL EDGE' : '',
      margin > 5 ? `cell could be ${art.cell - 2 * (margin - 2)}` : '',
      lost > 0 ? `ANCHOR OFF THE DRAWING in ${lost} frames` : '',
      def.category === 'weapon' && !art.muzzles?.length ? 'NO MUZZLE' : '',
    ].filter(Boolean);
    if (problems.some((p) => p === p.toUpperCase())) bad++;
    rows.push(
      [
        id.padEnd(24),
        `cell ${art.cell}`,
        `margin ${String(margin).padStart(2)}`,
        `foot ${def.footprint.w}x${def.footprint.h}`.padEnd(11),
        `drawn ${(b.x1 - b.x0).toFixed(1)}x${(b.y1 - b.y0).toFixed(1)}`.padEnd(16),
        `muzzles ${art.muzzles?.length ?? 0}${art.pivot ? ' +pivot' : ''}`.padEnd(17),
        `${seconds.toFixed(2)} s`,
        ...problems,
      ].join('  '),
    );
  }
  console.log(rows.join('\n'));
  console.log(
    `total ${total.toFixed(1)} s for ${ids.length} parts${bad ? `, ${bad} with problems` : ''}`,
  );
  return bad === 0;
}

function main(): void {
  mkdirSync(OUT, { recursive: true });
  const ids = wantedIds.length > 0 ? wantedIds : ALL_PART_ART.map((a) => a.id);
  for (const id of ids) {
    if (!ART.has(id)) throw new Error(`No part art registered for ${id}`);
    if (!ACCESSORIES[id]) throw new Error(`${id} is not in the catalog`);
  }
  if (flags.has('--check')) {
    if (!check(ids)) process.exit(1);
    return;
  }
  const started = performance.now();
  if (wantedIds.length > 0) {
    reviewSheet(
      'batch',
      ids.map((id) => ART.get(id)!),
    );
  } else {
    for (const [name, prefix] of [
      ['weapons', 'weapon_'],
      ['defenses', 'defense_'],
      ['utilities', 'utility_'],
    ] as const) {
      const arts = ALL_PART_ART.filter((a) => a.id.startsWith(prefix));
      if (!flags.has('--loaded')) {
        for (let i = 0; i < arts.length; i += 5)
          reviewSheet(`${name}_${i / 5 + 1}`, arts.slice(i, i + 5), i);
        iconSheet(name, arts);
        mountedSheet(name, arts);
      }
    }
    for (const car of CARS) loadedCar(car.art.id);
  }
  console.log(`previews in ${((performance.now() - started) / 1000).toFixed(1)} s`);
}

main();
