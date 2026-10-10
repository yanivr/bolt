import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CHASSIS, CITY_01, ENGINES, PAINTS, TIRES } from '@bolt/content';
import type { CarAtlasManifest, SpriteSheetRef, TerrainManifest, VfxManifest } from '@bolt/shared';
import { CAR_HEADINGS, WHEEL_HEADINGS } from '@bolt/shared';
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

describe('car atlases match the catalog', () => {
  it('has sprites for every shipped chassis, engine, wheel kit and paint', () => {
    for (const id of Object.keys(CHASSIS)) expect(cars.chassis[id], id).toBeDefined();
    for (const id of Object.keys(ENGINES)) expect(cars.engines[id], id).toBeDefined();
    for (const id of Object.keys(TIRES)) expect(cars.wheels[id], id).toBeDefined();
    for (const id of Object.keys(PAINTS)) expect(cars.paints[id], id).toBeDefined();
  });

  it.each(Object.values(cars.chassis))(
    '$id has sixteen non-empty heading frames in every layer',
    (entry) => {
      for (const ref of [entry.body, entry.shadow, entry.brakeLights, entry.headlights]) {
        expect(ref.columns).toBe(CAR_HEADINGS);
        const image = expectSheet(carsDir, ref);
        for (let h = 0; h < CAR_HEADINGS; h++) expect(frameIsEmpty(image, ref, h, 0)).toBe(false);
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
        for (let i = 0; i < fw; i++) {
          expect(image.alphaAt(h * fw + i, 0)).toBe(0);
          expect(image.alphaAt(h * fw + i, fh - 1)).toBe(0);
        }
        for (let j = 0; j < fh; j++) {
          expect(image.alphaAt(h * fw, j)).toBe(0);
          expect(image.alphaAt(h * fw + fw - 1, j)).toBe(0);
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
      expect(e.sheet.columns).toBe(CAR_HEADINGS);
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
