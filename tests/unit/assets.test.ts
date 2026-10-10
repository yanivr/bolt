import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CATALOG, CHASSIS, CITY_01, PAINTS, TEMPLATES, baselineBlueprint } from '@bolt/content';
import type { CarAtlasManifest, SpriteSheetRef, TerrainManifest, VfxManifest } from '@bolt/shared';
import {
  CAR_HEADINGS,
  CAR_SHEET_COLUMNS,
  FALLBACK_ENGINE_SPRITE,
  FALLBACK_TIRE_SPRITE,
  WHEEL_HEADINGS,
  buildHash,
  drawableChassisIds,
  partsWithoutSprites,
  resolveCarSprites,
} from '@bolt/shared';
import { describe, expect, it } from 'vitest';
import { PixelBuffer, decodePng, encodePng, readPng } from '../../art/scripts/lib/pixels.js';

const ASSETS = resolve('apps/web/public/assets');
const carsDir = join(ASSETS, 'atlases/cars');
const vfxDir = join(ASSETS, 'atlases/vfx_core');
const mapDir = join(ASSETS, 'maps/city_01/city_clear_night');
const cars = JSON.parse(readFileSync(join(carsDir, 'manifest.json'), 'utf8')) as CarAtlasManifest;
const vfx = JSON.parse(readFileSync(join(vfxDir, 'manifest.json'), 'utf8')) as VfxManifest;
const terrain = JSON.parse(readFileSync(join(mapDir, 'manifest.json'), 'utf8')) as TerrainManifest;

function expectSheet(dir: string, ref: SpriteSheetRef): PixelBuffer {
  // Atlas names must be stable and free from case-sensitivity traps (Section 13.8).
  expect(ref.file).toMatch(/^[a-z0-9_]+\.png$/);
  const image = readPng(join(dir, ref.file));
  expect(image.width).toBe(ref.frameWidth * ref.columns);
  expect(image.height).toBe(ref.frameHeight * ref.rows);
  return image;
}

function frameIsEmpty(
  image: PixelBuffer,
  ref: SpriteSheetRef,
  column: number,
  row: number,
): boolean {
  for (let y = 0; y < ref.frameHeight; y++) {
    for (let x = 0; x < ref.frameWidth; x++)
      if (image.alphaAt(column * ref.frameWidth + x, row * ref.frameHeight + y) !== 0) return false;
  }
  return true;
}

describe('PNG codec', () => {
  it('round-trips indexed and truecolor images exactly', () => {
    const small = new PixelBuffer(9, 7);
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 9; x++)
        small.set(x, y, [(x * 40) % 256, (y * 60) % 256, 77, (x + y) % 3 === 0 ? 0 : 255]);
    const rich = new PixelBuffer(40, 40);
    for (let y = 0; y < 40; y++)
      for (let x = 0; x < 40; x++)
        rich.set(x, y, [x * 6, y * 6, (x * y) % 256, 128 + ((x + y) % 2) * 127]);
    for (const src of [small, rich]) {
      const back = decodePng(encodePng(src));
      expect(back.width).toBe(src.width);
      expect(back.height).toBe(src.height);
      for (let i = 0; i < src.data.length; i += 4) {
        expect(back.data[i + 3]).toBe(src.data[i + 3]);
        if (src.data[i + 3] !== 0)
          expect([back.data[i], back.data[i + 1], back.data[i + 2]]).toEqual([
            src.data[i],
            src.data[i + 1],
            src.data[i + 2],
          ]);
      }
    }
  });
});

/**
 * Catalog parts that have no sprite sheet in the car atlas yet. The rules, the server and the
 * simulation know all 120 parts; the artists are still drawing most of them. This list is
 * the outstanding work, id by id, and the test below fails the moment it disagrees with the
 * atlas in either direction: a part gains art and must be removed from here, or a part is
 * listed that already has art, or a part is missing art without being listed. It must shrink
 * to empty before launch. Nothing here is drawn with a made-up sprite: a chassis on this list
 * cannot be picked, and an engine or wheel kit on it is drawn with the default one.
 */
export const SPRITES_PENDING: readonly string[] = [
  // Chassis: 16 of 20.
  'chassis_needle',
  'chassis_crab',
  'chassis_cobra',
  'chassis_scorpion',
  'chassis_buggy',
  'chassis_chameleon',
  'chassis_brick',
  'chassis_trike',
  'chassis_wagon',
  'chassis_rammer',
  'chassis_drifter',
  'chassis_kangaroo',
  'chassis_horseshoe',
  'chassis_pickup',
  'chassis_twins',
  'chassis_platform',
  // Engines: 19 of 20.
  'engine_mini_electric',
  'engine_v6',
  'engine_v8',
  'engine_v12',
  'engine_small_turbo',
  'engine_twin_turbo',
  'engine_supercharger',
  'engine_diesel',
  'engine_electric_sport',
  'engine_electric_eco',
  'engine_hybrid',
  'engine_rotary',
  'engine_turbine',
  'engine_rocket',
  'engine_twin',
  'engine_spring',
  'engine_offroad',
  'engine_resilient',
  'engine_experimental',
  // Wheel kits: 19 of 20.
  'tires_slick',
  'tires_rain',
  'tires_sand',
  'tires_mud',
  'tires_snow',
  'tires_ice',
  'tires_soft',
  'tires_hard',
  'tires_drift',
  'tires_armored',
  'tires_solid',
  'tires_balloon',
  'tires_monster',
  'tires_micro',
  'tires_halftrack',
  'tires_track',
  'tires_magnetic',
  'tires_adaptive',
  'tires_blades',
  // Weapons: 20 of 20.
  'weapon_front_mg',
  'weapon_rear_mg',
  'weapon_turret',
  'weapon_shotgun',
  'weapon_railshot',
  'weapon_rocket',
  'weapon_homing',
  'weapon_mine',
  'weapon_oil',
  'weapon_foam',
  'weapon_emp',
  'weapon_tesla',
  'weapon_flame',
  'weapon_frost',
  'weapon_hammer',
  'weapon_saw',
  'weapon_harpoon',
  'weapon_air',
  'weapon_boomerang',
  'weapon_mortar',
  // Defenses: 20 of 20.
  'defense_light_plate',
  'defense_heavy_plate',
  'defense_front_bumper',
  'defense_rear_bumper',
  'defense_side_panels',
  'defense_wheel_cage',
  'defense_engine_case',
  'defense_ceramic',
  'defense_breakaway',
  'defense_composite',
  'defense_energy_shield',
  'defense_faraday',
  'defense_heatguard',
  'defense_antimissile',
  'defense_minesweeper',
  'defense_fireproof',
  'defense_oilproof',
  'defense_damper',
  'defense_steer_assist',
  'defense_reactive',
  // Utilities: 20 of 20.
  'utility_spare',
  'utility_repair',
  'utility_fan',
  'utility_radiator',
  'utility_battery',
  'utility_generator',
  'utility_capacitor',
  'utility_nitro',
  'utility_overdrive',
  'utility_traction',
  'utility_gyro',
  'utility_radar',
  'utility_minesensor',
  'utility_decoy',
  'utility_jump',
  'utility_winch',
  'utility_ballast',
  'utility_spoiler',
  'utility_targeting',
  'utility_solar',
];

describe('car atlases match the catalog', () => {
  it('has a sprite sheet for every catalog part that is not on SPRITES_PENDING, and for none that is', () => {
    const missing = partsWithoutSprites(cars, CATALOG);
    // Exactly the pending list: nothing silently missing, nothing listed that has arrived.
    expect([...missing].sort()).toEqual([...SPRITES_PENDING].sort());
    expect(new Set(SPRITES_PENDING).size).toBe(SPRITES_PENDING.length);
    // Every id on the list is a real catalog part.
    const known = new Set([
      ...Object.keys(CATALOG.chassis),
      ...Object.keys(CATALOG.engines),
      ...Object.keys(CATALOG.tires),
      ...Object.keys(CATALOG.parts),
    ]);
    for (const id of SPRITES_PENDING) expect(known.has(id), id).toBe(true);
    // The count of finished parts can only go up. Raise this number as art lands.
    expect(120 - SPRITES_PENDING.length).toBeGreaterThanOrEqual(6);
    // Paints are complete.
    for (const id of Object.keys(PAINTS)) expect(cars.paints[id], id).toBeDefined();
    // The atlas holds nothing the catalog does not know.
    for (const id of Object.keys(cars.chassis)) expect(CATALOG.chassis[id], id).toBeDefined();
    for (const id of Object.keys(cars.engines)) expect(CATALOG.engines[id], id).toBeDefined();
    for (const id of Object.keys(cars.wheels)) expect(CATALOG.tires[id], id).toBeDefined();
    for (const id of Object.keys(cars.parts ?? {})) expect(CATALOG.parts[id], id).toBeDefined();
  });

  it('always has the default car and the stand-in sprites the fallback relies on', () => {
    expect(cars.chassis.chassis_beetle).toBeDefined();
    expect(cars.engines[FALLBACK_ENGINE_SPRITE]).toBeDefined();
    expect(cars.wheels[FALLBACK_TIRE_SPRITE]).toBeDefined();
    expect(SPRITES_PENDING).not.toContain('chassis_beetle');
    expect(SPRITES_PENDING).not.toContain(FALLBACK_ENGINE_SPRITE);
    expect(SPRITES_PENDING).not.toContain(FALLBACK_TIRE_SPRITE);
  });

  it('offers only chassis with art in the picker, and draws stand-ins for drawing only', () => {
    const drawable = drawableChassisIds(cars, CATALOG);
    expect(drawable).toEqual(Object.keys(CATALOG.chassis).filter((id) => !SPRITES_PENDING.includes(id)));
    expect(drawable).toContain('chassis_beetle');
    for (const id of drawable) {
      // The picker's car for each drawable chassis resolves to sheets that exist.
      const blueprint = baselineBlueprint({ chassisId: id });
      const sprites = resolveCarSprites(cars, blueprint);
      expect(sprites.loadout, id).not.toBeNull();
      expect(cars.chassis[sprites.loadout!.chassisId]).toBeDefined();
      expect(cars.engines[sprites.loadout!.engineId]).toBeDefined();
      expect(cars.wheels[sprites.loadout!.tireKitId]).toBeDefined();
      expect(cars.paints[sprites.loadout!.paintId]).toBeDefined();
    }
    // A part without art is replaced for drawing and reported; the blueprint is untouched.
    const rocket = TEMPLATES.find((t) => t.id === 'example_straight_line_rocket')!.blueprint;
    const before = buildHash(rocket);
    const frozen = JSON.stringify(rocket);
    const shown = resolveCarSprites(cars, rocket);
    expect(JSON.stringify(rocket)).toBe(frozen);
    expect(buildHash(rocket)).toBe(before);
    if (SPRITES_PENDING.includes('chassis_arrow')) expect(shown.loadout).toBeNull();
    else {
      const expectId = (own: string, fallback: string) => (SPRITES_PENDING.includes(own) ? fallback : own);
      expect(shown.loadout).toEqual({
        chassisId: 'chassis_arrow',
        engineId: expectId('engine_v8', FALLBACK_ENGINE_SPRITE),
        tireKitId: expectId('tires_slick', FALLBACK_TIRE_SPRITE),
        paintId: rocket.paintId,
      });
      expect(shown.substituted).toEqual(['engine_v8', 'tires_slick'].filter((id) => SPRITES_PENDING.includes(id)));
    }
    // A chassis without art has no stand-in: it cannot be drawn, so it cannot be picked.
    for (const id of SPRITES_PENDING.filter((p) => p.startsWith('chassis_'))) {
      expect(resolveCarSprites(cars, baselineBlueprint({ chassisId: id })).loadout, id).toBeNull();
      expect(drawable).not.toContain(id);
    }
    // An unknown paint falls back to the default paint, never to an undefined ramp.
    expect(resolveCarSprites(cars, { ...baselineBlueprint(), paintId: 'paint_missing' }).loadout!.paintId).toBe('paint_signal');
  });

  it.each(Object.values(cars.chassis))(
    '$id has a non-empty frame for every heading in every layer',
    (entry) => {
      for (const ref of [entry.body, entry.shadow, entry.brakeLights, entry.headlights]) {
        expect(ref.columns).toBe(CAR_SHEET_COLUMNS);
        expect(ref.columns * ref.rows).toBe(CAR_HEADINGS);
        const image = expectSheet(carsDir, ref);
        // Lamps can be hidden behind the bodywork at some headings in the tilted view.
        if (ref === entry.brakeLights || ref === entry.headlights) continue;
        for (let h = 0; h < CAR_HEADINGS; h++)
          expect(frameIsEmpty(image, ref, h % ref.columns, Math.floor(h / ref.columns))).toBe(false);
      }
      const def = CHASSIS[entry.id]!;
      expect(entry.wheelAnchors.map((w) => [w.id, w.x, w.y, w.steers])).toEqual(
        def.wheelAnchors.map((w) => [w.id, w.x, w.y, w.steers]),
      );
    },
  );

  it.each(Object.values(cars.chassis))(
    '$id fits its cell at every heading with a clear margin',
    (entry) => {
      const image = readPng(join(carsDir, entry.body.file));
      const { frameWidth: fw, frameHeight: fh } = entry.body;
      for (let h = 0; h < CAR_HEADINGS; h++) {
        const x0 = (h % entry.body.columns) * fw;
        const y0 = Math.floor(h / entry.body.columns) * fh;
        for (let i = 0; i < fw; i++) {
          expect(image.alphaAt(x0 + i, y0)).toBe(0);
          expect(image.alphaAt(x0 + i, y0 + fh - 1)).toBe(0);
        }
        for (let j = 0; j < fh; j++) {
          expect(image.alphaAt(x0, y0 + j)).toBe(0);
          expect(image.alphaAt(x0 + fw - 1, y0 + j)).toBe(0);
        }
      }
    },
  );

  it('bakes bodies in the paint key and keeps that key out of every other layer', () => {
    const keyOf = (hex: string) => parseInt(hex.slice(1), 16);
    for (const entry of Object.values(cars.chassis)) {
      const key = new Set(entry.paintKey.map(keyOf));
      const body = readPng(join(carsDir, entry.body.file));
      const seen = new Set<number>();
      for (let i = 0; i < body.data.length; i += 4)
        if (body.data[i + 3] !== 0)
          seen.add((body.data[i]! << 16) | (body.data[i + 1]! << 8) | body.data[i + 2]!);
      let used = 0;
      for (const k of key) if (seen.has(k)) used++;
      expect(used).toBeGreaterThanOrEqual(4);
      for (const paint of Object.values(cars.paints))
        expect(paint.ramp).toHaveLength(entry.paintKey.length);
      const others = [
        ...Object.values(cars.engines).map((e) => e.sheet.file),
        ...Object.values(cars.wheels).map((w) => w.sheet.file),
      ];
      for (const file of others) {
        const image = readPng(join(carsDir, file));
        for (let i = 0; i < image.data.length; i += 4) {
          if (image.data[i + 3] === 0) continue;
          expect(
            key.has((image.data[i]! << 16) | (image.data[i + 1]! << 8) | image.data[i + 2]!),
          ).toBe(false);
        }
      }
    }
  });

  it('has wheel and engine sheets with the declared layout', () => {
    for (const w of Object.values(cars.wheels)) {
      expect(w.sheet.columns).toBe(WHEEL_HEADINGS);
      expect(w.sheet.rows).toBe(w.rollFrames);
      const image = expectSheet(carsDir, w.sheet);
      for (let r = 0; r < w.rollFrames; r++)
        for (let c = 0; c < WHEEL_HEADINGS; c++)
          expect(frameIsEmpty(image, w.sheet, c, r)).toBe(false);
    }
    for (const e of Object.values(cars.engines)) {
      expect(e.sheet.columns * e.sheet.rows).toBe(CAR_HEADINGS);
      expectSheet(carsDir, e.sheet);
    }
  });

  it('uses only fully opaque or fully clear pixels in body, wheel and engine art', () => {
    const files = [
      ...Object.values(cars.chassis).map((c) => c.body.file),
      ...Object.values(cars.wheels).map((w) => w.sheet.file),
      ...Object.values(cars.engines).map((e) => e.sheet.file),
    ];
    for (const file of files) {
      const image = readPng(join(carsDir, file));
      for (let i = 3; i < image.data.length; i += 4)
        expect(image.data[i] === 0 || image.data[i] === 255).toBe(true);
    }
  });
});

describe('effects strips', () => {
  it.each(Object.values(vfx.strips))(
    '$id matches its manifest and has no empty first frame',
    (strip) => {
      const ref = {
        file: strip.file,
        frameWidth: strip.frameWidth,
        frameHeight: strip.frameHeight,
        columns: strip.frames,
        rows: 1,
      };
      const image = expectSheet(vfxDir, ref);
      expect(frameIsEmpty(image, ref, 0, 0)).toBe(false);
      expect(strip.fps).toBeGreaterThan(0);
    },
  );
});

describe('terrain bake for Neon Cut', () => {
  it('covers the whole world with chunks, without gaps or overlaps', () => {
    expect(terrain.trackId).toBe(CITY_01.id);
    expect(terrain.worldWidth).toBe(CITY_01.worldWidth);
    expect(terrain.worldHeight).toBe(CITY_01.worldHeight);
    expect(terrain.ground).toHaveLength(terrain.cols * terrain.rows);
    let area = 0;
    for (const chunk of terrain.ground) {
      expect(chunk.x).toBe(chunk.col * terrain.chunkSize);
      expect(chunk.y).toBe(chunk.row * terrain.chunkSize);
      expect(chunk.x + chunk.w).toBeLessThanOrEqual(terrain.worldWidth);
      expect(chunk.y + chunk.h).toBeLessThanOrEqual(terrain.worldHeight);
      area += chunk.w * chunk.h;
      const image = readPng(join(mapDir, chunk.file));
      expect([image.width, image.height]).toEqual([chunk.w, chunk.h]);
    }
    expect(area).toBe(terrain.worldWidth * terrain.worldHeight);
  });

  it('ships every referenced overlay, animation and the minimap', () => {
    for (const overlay of terrain.overlays) {
      const image = readPng(join(mapDir, overlay.file));
      expect([image.width, image.height]).toEqual([overlay.w, overlay.h]);
    }
    for (const anim of terrain.animated) {
      const image = readPng(join(mapDir, anim.file));
      expect(image.width).toBe(anim.frameWidth * anim.frameCount);
      expect(image.height).toBe(anim.frameHeight);
    }
    expect(existsSync(join(mapDir, terrain.minimap.file))).toBe(true);
    expect(terrain.minimap.width * (1 / terrain.minimap.worldScale)).toBeCloseTo(
      terrain.worldWidth,
      -1,
    );
    // Section 12.10: at least three ambient loops and foreground framing per track.
    expect(terrain.animated.length).toBeGreaterThanOrEqual(3);
    expect(terrain.overlays.length).toBeGreaterThanOrEqual(4);
    expect(terrain.lights.length).toBeGreaterThan(50);
  });

  it('stays inside the first-play download budget (Section 2)', () => {
    let bytes = 0;
    for (const f of [...terrain.ground, ...terrain.overlays, ...terrain.animated])
      bytes += statSync(join(mapDir, f.file)).size;
    for (const c of Object.values(cars.chassis))
      for (const ref of [c.body, c.shadow, c.brakeLights, c.headlights])
        bytes += statSync(join(carsDir, ref.file)).size;
    expect(bytes).toBeLessThan(4 * 1024 * 1024);
  });
});
