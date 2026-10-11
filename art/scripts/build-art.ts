import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CHASSIS, CITY_01 } from '@bolt/content';
import type {
  CarAtlasManifest,
  CarPose,
  ChassisSpriteManifest,
  EngineSpriteManifest,
  IconSheetManifest,
  VfxManifest,
  WheelSpriteManifest,
} from '@bolt/shared';
import {
  CAR_HEADINGS,
  CAR_SHEET_COLUMNS,
  CAR_TILT,
  CAR_Z_SCALE,
  TAU,
  WHEEL_HEADINGS,
  layoutCar,
} from '@bolt/shared';
import { ALL_CHASSIS_ART } from './cars/registry-chassis.js';
import { ALL_ENGINE_ART } from './cars/registry-engines.js';
import { ALL_PART_ART } from './cars/registry-parts.js';
import { ALL_WHEEL_ART } from './cars/registry-wheels.js';
import { CAR_MATERIALS, PAINTS, PAINT_KEY, PAINT_OUTLINE_KEY } from './cars/materials.js';
import type { ChassisArt, EngineArt, PartArt, WheelArt } from './cars/types.js';
import type { Model } from './lib/model.js';
import { addGlow, extractTagged, footprintShadow, renderModel, silhouette } from './lib/model.js';
import type { RGBA } from './lib/pixels.js';
import { PixelBuffer, hex, readPng, writePng } from './lib/pixels.js';
import { bakeTerrain } from './terrain/index.js';
import { buildCoreVfx } from './vfx/core.js';

/**
 * Art pipeline entry point. Bakes every sprite sheet and terrain set from code, writes the
 * manifests the client loads, saves heading-0 source cells, and renders review sheets.
 *
 *   pnpm art                 bake everything
 *   pnpm art -- --cars       cars only (skips the slower terrain bake)
 *   pnpm art:check           bake to memory and fail if committed assets differ
 */

const ROOT = resolve(import.meta.dirname, '../..');
const ATLAS_DIR = join(ROOT, 'apps/web/public/assets/atlases/cars');
const VFX_DIR = join(ROOT, 'apps/web/public/assets/atlases/vfx_core');
const MAPS_DIR = join(ROOT, 'apps/web/public/assets/maps');
const SOURCE_DIR = join(ROOT, 'art/source/cars');
const MANIFEST_DIR = join(ROOT, 'art/manifests');
const PREVIEW_DIR = join(ROOT, 'art/preview/cars');

const args = new Set(process.argv.slice(2));
const carsOnly = args.has('--cars');
const check = args.has('--check');
const onlyArg = [...args].find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;

const SHADOW: RGBA = [8, 10, 22, 120];
const SHADOW_RIM: RGBA = [8, 10, 22, 56];

function sheet(frames: PixelBuffer[], columns: number): PixelBuffer {
  const fw = frames[0]!.width;
  const fh = frames[0]!.height;
  const rows = Math.ceil(frames.length / columns);
  const out = new PixelBuffer(fw * columns, fh * rows);
  frames.forEach((f, i) => out.blit(f, (i % columns) * fw, Math.floor(i / columns) * fh));
  return out;
}

type Baked = {
  files: Map<string, PixelBuffer>;
  manifest: CarAtlasManifest;
  frames: {
    chassis: Record<
      string,
      { body: PixelBuffer[]; shadow: PixelBuffer[]; brake: PixelBuffer[]; head: PixelBuffer[] }
    >;
    wheels: Record<string, PixelBuffer[][]>;
    wheelFeet: Record<string, PixelBuffer[]>;
    engines: Record<string, PixelBuffer[]>;
    parts: Record<string, PixelBuffer[]>;
  };
};

/** Camera for every vehicle sprite: the shared tilt and height exaggeration. */
const view = (heading: number, cell: number) => ({
  heading,
  width: cell,
  height: cell,
  tilt: CAR_TILT,
  zScale: CAR_Z_SCALE,
});

function bakeChassis(art: ChassisArt, wheelArt: WheelArt, baked: Baked): void {
  const def = CHASSIS[art.id];
  if (!def) throw new Error(`No chassis definition for ${art.id}`);
  const body: PixelBuffer[] = [];
  const shadow: PixelBuffer[] = [];
  const brake: PixelBuffer[] = [];
  const head: PixelBuffer[] = [];
  const wheelFeet = baked.frames.wheelFeet[wheelArt.id]!;
  const lampOn = CAR_MATERIALS.lampOn!.ramp[2];
  const tailOn = CAR_MATERIALS.tailOn!.ramp[2];

  for (let h = 0; h < CAR_HEADINGS; h++) {
    const heading = (h * TAU) / CAR_HEADINGS;
    const base = renderModel(art.model, view(heading, art.cell));
    body.push(base.image);

    // The shadow is where the whole assembly stands on the ground, wheels included.
    const feet = footprintShadow(base, SHADOW);
    for (const anchor of def.wheelAnchors) {
      const c = Math.cos(heading);
      const s = Math.sin(heading);
      const wx = Math.round(anchor.x * c - anchor.y * s);
      const wy = Math.round(anchor.x * s + anchor.y * c);
      const wheel = wheelFeet[Math.round((h * WHEEL_HEADINGS) / CAR_HEADINGS) % WHEEL_HEADINGS]!;
      feet.blit(wheel, art.cell / 2 + wx - wheel.width / 2, art.cell / 2 + wy - wheel.height / 2);
    }
    shadow.push(silhouette(feet, SHADOW, SHADOW_RIM));

    // Lit lamps reuse the body's own pixels, so they can never drift from the bodywork.
    brake.push(addGlow(extractTagged(base, art.model, ['taillight'], tailOn), [244, 107, 88, 120]));
    head.push(addGlow(extractTagged(base, art.model, ['headlight'], lampOn), [246, 195, 91, 110]));
  }

  baked.frames.chassis[art.id] = { body, shadow, brake, head };
  baked.files.set(`${art.id}_body.png`, sheet(body, CAR_SHEET_COLUMNS));
  baked.files.set(`${art.id}_shadow.png`, sheet(shadow, CAR_SHEET_COLUMNS));
  baked.files.set(`${art.id}_brake.png`, sheet(brake, CAR_SHEET_COLUMNS));
  baked.files.set(`${art.id}_head.png`, sheet(head, CAR_SHEET_COLUMNS));

  const ref = (suffix: string) => ({
    file: `${art.id}_${suffix}.png`,
    frameWidth: art.cell,
    frameHeight: art.cell,
    columns: CAR_SHEET_COLUMNS,
    rows: CAR_HEADINGS / CAR_SHEET_COLUMNS,
  });
  const entry: ChassisSpriteManifest = {
    id: art.id,
    body: ref('body'),
    shadow: ref('shadow'),
    brakeLights: ref('brake'),
    headlights: ref('head'),
    paintKey: [PAINT_OUTLINE_KEY, ...PAINT_KEY],
    wheelAnchors: def.wheelAnchors.map((w) => ({ id: w.id, x: w.x, y: w.y, steers: w.steers })),
    engineAnchor: art.engineAnchor,
    ...(art.engineAnchor.y < ENGINE_BAY_Y ? { engineInBay: true } : {}),
    exhausts: art.exhausts,
    headlightAnchors: art.headlightAnchors,
    brakeLightAnchors: art.brakeLightAnchors,
    ...(art.mountHeights ? { mountHeights: art.mountHeights } : {}),
  };
  baked.manifest.chassis[art.id] = entry;
}

function bakeWheels(art: WheelArt, baked: Baked): void {
  const rows: PixelBuffer[][] = [];
  const flat: PixelBuffer[] = [];
  const feet: PixelBuffer[] = [];
  for (let r = 0; r < art.rollFrames; r++) {
    const model = art.model(r);
    const row: PixelBuffer[] = [];
    for (let h = 0; h < WHEEL_HEADINGS; h++) {
      const result = renderModel(model, view((h * TAU) / WHEEL_HEADINGS, art.cell));
      row.push(result.image);
      flat.push(result.image);
      if (r === 0) feet.push(footprintShadow(result, SHADOW));
    }
    rows.push(row);
  }
  baked.frames.wheels[art.id] = rows;
  baked.frames.wheelFeet[art.id] = feet;
  baked.files.set(`${art.id}.png`, sheet(flat, WHEEL_HEADINGS));
  const entry: WheelSpriteManifest = {
    id: art.id,
    sheet: {
      file: `${art.id}.png`,
      frameWidth: art.cell,
      frameHeight: art.cell,
      columns: WHEEL_HEADINGS,
      rows: art.rollFrames,
    },
    rollFrames: art.rollFrames,
  };
  baked.manifest.wheels[art.id] = entry;
}

/** Height of the deck an engine rests on; solids wholly below it are tailpipes. */
const ENGINE_DECK = 9;
/** An engine anchor this far forward of the tail has bodywork behind it. */
const ENGINE_BAY_Y = 15;

function bakeEngine(art: EngineArt, baked: Baked): void {
  const frames: PixelBuffer[] = [];
  for (let h = 0; h < CAR_HEADINGS; h++) {
    frames.push(renderModel(art.model, view((h * TAU) / CAR_HEADINGS, art.cell)).image);
  }
  baked.frames.engines[art.id] = frames;
  baked.files.set(`${art.id}.png`, sheet(frames, CAR_SHEET_COLUMNS));
  // Mid and front engine bays have bodywork behind the engine, so the low tailpipes that hang
  // off a rear deck would be drawn across a windshield. The bay sheet leaves them out.
  const enclosed = { ...art.model, solids: art.model.solids.filter((s) => s.z1 >= ENGINE_DECK) };
  const bayFrames: PixelBuffer[] = [];
  for (let h = 0; h < CAR_HEADINGS; h++) {
    bayFrames.push(renderModel(enclosed, view((h * TAU) / CAR_HEADINGS, art.cell)).image);
  }
  baked.files.set(`${art.id}_bay.png`, sheet(bayFrames, CAR_SHEET_COLUMNS));
  const ref = (file: string) => ({
    file,
    frameWidth: art.cell,
    frameHeight: art.cell,
    columns: CAR_SHEET_COLUMNS,
    rows: CAR_HEADINGS / CAR_SHEET_COLUMNS,
  });
  const entry: EngineSpriteManifest = {
    id: art.id,
    sheet: ref(`${art.id}.png`),
    bay: ref(`${art.id}_bay.png`),
    exhaustStyle: art.exhaustStyle,
  };
  baked.manifest.engines[art.id] = entry;
}

function bakePart(art: PartArt, baked: Baked): void {
  const frames: PixelBuffer[] = [];
  for (let h = 0; h < CAR_HEADINGS; h++) {
    frames.push(renderModel(art.model, view((h * TAU) / CAR_HEADINGS, art.cell)).image);
  }
  baked.frames.parts[art.id] = frames;
  baked.files.set(`${art.id}.png`, sheet(frames, CAR_SHEET_COLUMNS));
  (baked.manifest.parts ??= {})[art.id] = {
    id: art.id,
    sheet: {
      file: `${art.id}.png`,
      frameWidth: art.cell,
      frameHeight: art.cell,
      columns: CAR_SHEET_COLUMNS,
      rows: CAR_HEADINGS / CAR_SHEET_COLUMNS,
    },
  };
}

/**
 * Catalog icons at 32 and 24 pixels, rendered straight from each part's model at icon scale
 * (never by shrinking a sprite), turned to a three-quarter pose so the shape reads.
 */
const ICON_COLUMNS = 16;
const ICON_HEADING = (-3 * TAU) / 32;
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
function bakeIcons(models: Array<{ id: string; model: Model }>, baked: Baked): void {
  const sheets: IconSheetManifest[] = [];
  for (const size of [32, 24]) {
    const rows = Math.max(1, Math.ceil(models.length / ICON_COLUMNS));
    const out = new PixelBuffer(ICON_COLUMNS * size, rows * size);
    const index: Record<string, number> = {};
    models.forEach(({ id, model }, i) => {
      const scale = (size / 2 - 2) / modelExtent(model);
      const icon = renderModel(model, {
        heading: ICON_HEADING,
        width: size,
        height: size,
        tilt: CAR_TILT,
        zScale: CAR_Z_SCALE,
        scale,
        originY: size / 2 + 1,
      }).image;
      out.blit(icon, (i % ICON_COLUMNS) * size, Math.floor(i / ICON_COLUMNS) * size);
      index[id] = i;
    });
    baked.files.set(`icons_${size}.png`, out);
    sheets.push({ file: `icons_${size}.png`, size, columns: ICON_COLUMNS, index });
  }
  baked.manifest.icons = sheets;
}

/** All shipped chassis side by side, for the silhouette test in Section 13.8. */
function writeLineup(baked: Baked): void {
  const ids = Object.keys(baked.manifest.chassis);
  const cell = 96;
  const paints = ['paint_signal', 'paint_cobalt', 'paint_mint', 'paint_sunflare'];
  const headings = [0, 6, 16, 26, 36, 52];
  const sheet = new PixelBuffer(cell * headings.length, cell * ids.length);
  sheet.fill(hex('#3a4257'));
  const dark = new PixelBuffer(cell * ids.length, cell);
  dark.fill(hex('#3a4257'));
  ids.forEach((id, row) => {
    headings.forEach((h, col) => {
      const pose: CarPose = {
        headingRad: (h * TAU) / CAR_HEADINGS,
        steer: col === 1 ? 1 : col === 4 ? -1 : 0,
        roll: col,
        braking: col === 5,
        headlights: col >= 3,
        bodyShiftX: 0,
        bodyShiftY: 0,
      };
      sheet.blit(
        composeCar(
          baked,
          id,
          'tires_street',
          'engine_four_cylinder',
          pose,
          paints[row % paints.length]!,
        ),
        col * cell,
        row * cell,
      );
    });
    // Pure silhouettes: can each chassis be told apart without color or detail?
    const shadow = baked.frames.chassis[id]!.shadow[0]!;
    for (let y = 0; y < cell; y++)
      for (let x = 0; x < cell; x++)
        if (shadow.alphaAt(x, y) > 100) dark.set(row * cell + x, y, hex('#0e1320'));
  });
  writePng(join(PREVIEW_DIR, 'lineup_1x.png'), sheet);
  writePng(join(PREVIEW_DIR, 'lineup_3x.png'), sheet.scaled(3));
  writePng(join(PREVIEW_DIR, 'silhouettes_3x.png'), dark.scaled(3));
}

/** Node-side renderer for review sheets. Uses the same layout function as the game client. */
function composeCar(
  baked: Baked,
  chassisId: string,
  wheelId: string,
  engineId: string,
  pose: CarPose,
  paintId: string,
): PixelBuffer {
  const chassis = baked.manifest.chassis[chassisId]!;
  const out = new PixelBuffer(chassis.body.frameWidth, chassis.body.frameHeight);
  const cx = out.width / 2;
  const cy = out.height / 2;
  const ops = layoutCar(
    chassis,
    baked.manifest.wheels[wheelId]!,
    baked.manifest.engines[engineId]!,
    pose,
  );
  for (const op of ops) {
    let frame: PixelBuffer;
    if (op.kind === 'wheel')
      frame =
        baked.frames.wheels[op.sheetId]![Math.floor(op.frame / WHEEL_HEADINGS)]![
          op.frame % WHEEL_HEADINGS
        ]!;
    else if (op.kind === 'engine') frame = baked.frames.engines[op.sheetId]![op.frame]!;
    else {
      const set = baked.frames.chassis[op.sheetId]!;
      frame =
        op.kind === 'body'
          ? set.body[op.frame]!
          : op.kind === 'shadow'
            ? set.shadow[op.frame]!
            : op.kind === 'brake'
              ? set.brake[op.frame]!
              : set.head[op.frame]!;
    }
    if (op.kind === 'body') frame = repaint(frame, paintId);
    out.blit(
      frame,
      Math.round(cx + op.dx - frame.width / 2),
      Math.round(cy + op.dy - frame.height / 2),
    );
  }
  return out;
}

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

function writePreviews(baked: Baked): void {
  mkdirSync(PREVIEW_DIR, { recursive: true });
  writeLineup(baked);
  const cell = 96;
  const bg = hex('#3a4257');
  const basePose: CarPose = {
    headingRad: 0,
    steer: 0,
    roll: 0,
    braking: false,
    headlights: false,
    bodyShiftX: 0,
    bodyShiftY: 0,
  };

  // Sheet 1: all sixteen headings, at game size and at 4x.
  const row = new PixelBuffer(cell * 16, cell);
  row.fill(bg);
  for (let h = 0; h < 16; h++) {
    const car = composeCar(
      baked,
      'chassis_beetle',
      'tires_street',
      'engine_four_cylinder',
      { ...basePose, headingRad: (h * TAU) / 16 },
      'paint_signal',
    );
    row.blit(car, h * cell, 0);
  }
  writePng(join(PREVIEW_DIR, 'beetle_headings_1x.png'), row);
  const half = new PixelBuffer(cell * 8, cell * 2);
  half.copyFrom(row, 0, 0, cell * 8, cell, 0, 0);
  half.copyFrom(row, cell * 8, 0, cell * 8, cell, 0, cell);
  writePng(join(PREVIEW_DIR, 'beetle_headings_4x.png'), half.scaled(4));

  // Sheet 2: states at heading 0 and a diagonal: steer left/right, brake, lights, lean, paints.
  const poses: Array<[string, Partial<CarPose>, string]> = [
    ['neutral', {}, 'paint_signal'],
    ['steer left', { steer: -1, bodyShiftX: 1 }, 'paint_signal'],
    ['steer right', { steer: 1, bodyShiftX: -1 }, 'paint_signal'],
    ['brake', { braking: true, bodyShiftY: -1 }, 'paint_signal'],
    ['lights', { headlights: true }, 'paint_signal'],
    ['cobalt', { headlights: true }, 'paint_cobalt'],
    ['mint', { steer: 0.6 }, 'paint_mint'],
    ['sunflare', { braking: true }, 'paint_sunflare'],
  ];
  const states = new PixelBuffer(cell * poses.length, cell * 2);
  states.fill(bg);
  poses.forEach(([, pose, paint], i) => {
    states.blit(
      composeCar(
        baked,
        'chassis_beetle',
        'tires_street',
        'engine_four_cylinder',
        { ...basePose, ...pose },
        paint,
      ),
      i * cell,
      0,
    );
    states.blit(
      composeCar(
        baked,
        'chassis_beetle',
        'tires_street',
        'engine_four_cylinder',
        { ...basePose, ...pose, headingRad: (3 * TAU) / 16 },
        paint,
      ),
      i * cell,
      cell,
    );
  });
  writePng(join(PREVIEW_DIR, 'beetle_states_4x.png'), states.scaled(4));

  // Sheet 3: the separate layers, so each can be reviewed alone.
  const set = baked.frames.chassis['chassis_beetle']!;
  const layers = new PixelBuffer(cell * 6, cell);
  layers.fill(bg);
  layers.blit(set.body[0]!, 0, 0);
  layers.blit(set.shadow[0]!, cell, 0);
  layers.blit(set.brake[0]!, cell * 2, 0);
  layers.blit(set.head[0]!, cell * 3, 0);
  layers.blit(baked.frames.engines['engine_four_cylinder']![0]!, cell * 4 + 28, 28);
  for (let r = 0; r < 3; r++)
    for (let d = 0; d < 4; d++)
      layers.blit(
        baked.frames.wheels['tires_street']![r]![d * 2]!,
        cell * 5 + 4 + d * 22,
        6 + r * 28,
      );
  writePng(join(PREVIEW_DIR, 'beetle_layers_4x.png'), layers.scaled(4));

  // Sheet 4: on the baked track, at game size and 3x, in four headings.
  const mapDir = join(MAPS_DIR, 'city_01/city_clear_night');
  try {
    const ground = readPng(join(mapDir, 'ground_3_4.png'));
    const scene = new PixelBuffer(320, 180);
    scene.copyFrom(ground, 120, 150, 320, 180, 0, 0);
    const paints = ['paint_signal', 'paint_cobalt', 'paint_mint', 'paint_sunflare'];
    [12, 14, 0, 3].forEach((h, i) => {
      const car = composeCar(
        baked,
        'chassis_beetle',
        'tires_street',
        'engine_four_cylinder',
        {
          ...basePose,
          headingRad: (h * TAU) / 16,
          headlights: true,
          braking: i === 1,
          steer: i === 3 ? 0.8 : 0,
        },
        paints[i]!,
      );
      scene.blit(car, 20 + i * 74, 30 + (i % 2) * 40);
    });
    writePng(join(PREVIEW_DIR, 'beetle_on_track_1x.png'), scene);
    writePng(join(PREVIEW_DIR, 'beetle_on_track_3x.png'), scene.scaled(3));
  } catch {
    // Terrain not baked yet; the track preview is optional.
  }
}

function bakeCars(): Baked {
  const baked: Baked = {
    files: new Map(),
    manifest: { version: 1, chassis: {}, wheels: {}, engines: {}, paints: {} },
    frames: { chassis: {}, wheels: {}, wheelFeet: {}, engines: {}, parts: {} },
  };
  for (const [id, paint] of Object.entries(PAINTS)) {
    baked.manifest.paints[id] = {
      id,
      displayName: paint.displayName,
      ramp: [paint.outline, ...paint.ramp],
    };
  }
  // `--only=id,id` bakes just those sheets, for quick iteration on one part.
  const wanted = (id: string) => !only || only.has(id);
  for (const art of ALL_WHEEL_ART)
    if (wanted(art.id) || art === ALL_WHEEL_ART[0]) bakeWheels(art, baked);
  for (const art of ALL_ENGINE_ART) if (wanted(art.id)) bakeEngine(art, baked);
  for (const art of ALL_CHASSIS_ART) if (wanted(art.id)) bakeChassis(art, ALL_WHEEL_ART[0]!, baked);
  for (const art of ALL_PART_ART) if (wanted(art.id)) bakePart(art, baked);
  if (!only) {
    bakeIcons(
      [
        ...ALL_CHASSIS_ART.map((a) => ({ id: a.id, model: a.model })),
        ...ALL_ENGINE_ART.map((a) => ({ id: a.id, model: a.model })),
        ...ALL_WHEEL_ART.map((a) => ({ id: a.id, model: a.model(0) })),
        ...ALL_PART_ART.map((a) => ({ id: a.id, model: a.model })),
      ],
      baked,
    );
  }
  // No non-paint material may collide with the paint key, or the runtime swap would recolor it.
  const key = new Set([PAINT_OUTLINE_KEY, ...PAINT_KEY].map((c) => c.toLowerCase()));
  for (const [name, mat] of Object.entries(CAR_MATERIALS)) {
    if (name === 'paint') continue;
    for (const c of [...mat.ramp, mat.outline]) {
      const h = `#${[c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      if (key.has(h)) throw new Error(`Material ${name} reuses paint key color ${h}`);
    }
  }
  return baked;
}

function digestDir(dir: string): string {
  const hash = createHash('sha256');
  for (const name of readdirSync(dir).sort()) {
    hash.update(name);
    hash.update(readFileSync(join(dir, name)));
  }
  return hash.digest('hex');
}

function main(): void {
  const started = performance.now();
  const baked = bakeCars();

  if (check) {
    let mismatched = 0;
    for (const [name, buf] of baked.files) {
      const existing = readPng(join(ATLAS_DIR, name));
      if (
        existing.width !== buf.width ||
        existing.height !== buf.height ||
        !Buffer.from(existing.data.buffer).equals(Buffer.from(buf.data.buffer))
      ) {
        console.error(`atlas out of date: ${name}`);
        mismatched++;
      }
    }
    const manifestOnDisk = readFileSync(join(ATLAS_DIR, 'manifest.json'), 'utf8');
    if (manifestOnDisk !== `${JSON.stringify(baked.manifest, null, 2)}\n`) {
      console.error('atlas out of date: manifest.json');
      mismatched++;
    }
    if (mismatched > 0) process.exit(1);
    console.log(`car atlases match the pipeline (${baked.files.size} sheets)`);
    return;
  }

  mkdirSync(ATLAS_DIR, { recursive: true });
  mkdirSync(MANIFEST_DIR, { recursive: true });
  let bytes = 0;
  for (const [name, buf] of baked.files) bytes += writePng(join(ATLAS_DIR, name), buf);
  if (only) {
    // Partial bake: keep everything already on disk and replace just the requested entries.
    const disk = JSON.parse(
      readFileSync(join(ATLAS_DIR, 'manifest.json'), 'utf8'),
    ) as CarAtlasManifest;
    baked.manifest = {
      ...disk,
      chassis: { ...disk.chassis, ...baked.manifest.chassis },
      wheels: { ...disk.wheels, ...baked.manifest.wheels },
      engines: { ...disk.engines, ...baked.manifest.engines },
      parts: { ...(disk.parts ?? {}), ...(baked.manifest.parts ?? {}) },
      paints: baked.manifest.paints,
    };
  }
  const manifestText = `${JSON.stringify(baked.manifest, null, 2)}\n`;
  writeFileSync(join(ATLAS_DIR, 'manifest.json'), manifestText);
  writeFileSync(join(MANIFEST_DIR, 'cars.json'), manifestText);

  // Heading-0 source cells in the canonical 64 x 96 authoring frame (Section 12.4).
  for (const [id, set] of Object.entries(baked.frames.chassis)) {
    const src = new PixelBuffer(64, 96);
    src.copyFrom(set.body[0]!, 16, 0, 64, 96, 0, 0);
    writePng(join(SOURCE_DIR, `${id}_body.png`), src);
  }
  for (const [id, frames] of Object.entries(baked.frames.engines))
    writePng(join(SOURCE_DIR, `${id}.png`), frames[0]!);
  for (const [id, rows] of Object.entries(baked.frames.wheels))
    writePng(join(SOURCE_DIR, `${id}.png`), rows[0]![0]!);

  if (only) {
    console.log(
      `partial bake: ${[...only].join(', ')} in ${((performance.now() - started) / 1000).toFixed(1)} s`,
    );
    return;
  }

  const vfx: VfxManifest = { version: 1, strips: {} };
  mkdirSync(VFX_DIR, { recursive: true });
  const vfxSheet: PixelBuffer[] = [];
  for (const strip of buildCoreVfx()) {
    writePng(join(VFX_DIR, `${strip.id}.png`), strip.image);
    vfx.strips[strip.id] = {
      id: strip.id,
      file: `${strip.id}.png`,
      frameWidth: strip.frameWidth,
      frameHeight: strip.frameHeight,
      frames: strip.frames,
      fps: strip.fps,
    };
    vfxSheet.push(strip.image);
  }
  writeFileSync(join(VFX_DIR, 'manifest.json'), `${JSON.stringify(vfx, null, 2)}\n`);
  writeFileSync(join(MANIFEST_DIR, 'vfx_core.json'), `${JSON.stringify(vfx, null, 2)}\n`);
  {
    const h = vfxSheet.reduce((sum, b) => sum + b.height + 4, 4);
    const w = Math.max(...vfxSheet.map((b) => b.width)) + 8;
    const review = new PixelBuffer(w, h);
    review.fill(hex('#2a3246'));
    let y = 4;
    for (const b of vfxSheet) {
      review.blit(b, 4, y);
      y += b.height + 4;
    }
    mkdirSync(PREVIEW_DIR, { recursive: true });
    writePng(join(PREVIEW_DIR, '../vfx_core_4x.png'), review.scaled(4));
  }

  console.log(
    `cars: ${baked.files.size} sheets, ${(bytes / 1024).toFixed(1)} KB, sha256 ${digestDir(ATLAS_DIR).slice(0, 16)}`,
  );

  if (!carsOnly) {
    const outDir = join(MAPS_DIR, 'city_01/city_clear_night');
    const manifest = bakeTerrain({ def: CITY_01, presetId: 'city_clear_night', outDir });
    writeFileSync(
      join(MANIFEST_DIR, 'city_01_city_clear_night.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    console.log(
      `terrain: ${manifest.ground.length} chunks, ${manifest.overlays.length} overlays, ${manifest.animated.length} animated`,
    );
  }

  writePreviews(baked);
  console.log(`done in ${((performance.now() - started) / 1000).toFixed(1)} s`);
}

main();
