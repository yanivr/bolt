import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getWeatherPreset } from '@bolt/content';
import { buildTrack, hashString } from '@bolt/shared';
import type {
  TerrainAnimatedProp,
  TerrainManifest,
  TerrainOverlay,
  TrackDefinition,
} from '@bolt/shared';
import { writePng } from '../lib/pixels.js';
import type { PixelBuffer } from '../lib/pixels.js';
import type { BiomeChecks, BiomeModule } from './biome.js';
import { Canvas, col } from './canvas.js';
import { reduceColors, writeChunks } from './chunks.js';
import { CITY_BIOME } from './city/index.js';
import { buildCorridorField } from './field.js';
import { drawMinimap } from './minimap.js';
import { writePreviews, writeSheet } from './preview.js';

/**
 * Terrain baker entry point. Generic steps live in this folder; each biome contributes a
 * painter under its own subfolder. Output is fully determined by the track definition and the
 * preset id, so two bakes are byte-identical.
 */

export const CHUNK_SIZE = 512;

/**
 * Biome modules, one per biome (docs/TRACK_API.md, "Adding a biome"). City is the only one so
 * far; the desert, forest, snow and industrial tracks race in the client's layout view until
 * their module lands here.
 */
const BIOMES: Partial<Record<string, BiomeModule>> = {
  [CITY_BIOME.biome]: CITY_BIOME,
};

export function biomeModule(biome: string): BiomeModule | undefined {
  return BIOMES[biome];
}

export type BakeOptions = {
  def: TrackDefinition;
  presetId: string;
  outDir: string;
  previewDir?: string;
  /** Heading sheet of a car body, composited into two previews for scale. Never shipped. */
  previewCarSheet?: string;
};

export type BakeReport = {
  manifest: TerrainManifest;
  bytes: { ground: number; overlays: number; animated: number; minimap: number; manifest: number };
  reducedChunks: number;
  truecolorChunks: number;
  maxChunkColors: number;
  checks: BiomeChecks;
  previews: string[];
};

function cleanDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.png') || name === 'manifest.json') rmSync(join(dir, name));
  }
}

export function bakeTerrainWithReport(opts: BakeOptions): BakeReport {
  const { def, presetId, outDir } = opts;
  const module = biomeModule(def.biome);
  if (!module)
    throw new Error(
      `No terrain module for biome ${def.biome}: add one to BIOMES (docs/TRACK_API.md, "Adding a biome")`,
    );
  if (!module.presets.includes(presetId))
    throw new Error(`The ${def.biome} module does not paint ${presetId} yet`);
  if (!def.weatherPresetIds.includes(presetId))
    throw new Error(`${def.id} does not publish the weather ${presetId}`);
  const preset = getWeatherPreset(presetId);
  if (!preset) throw new Error(`No weather preset ${presetId}`);
  const track = buildTrack(def);
  const field = buildCorridorField(track);
  const world = Canvas.world(def.worldWidth, def.worldHeight);
  const out = module.paint({
    def,
    track,
    field,
    presetId,
    preset,
    world,
    seed: hashString(`${def.id}:${presetId}`),
  });

  cleanDir(outDir);
  const ground = writeChunks(world, CHUNK_SIZE, outDir);

  const overlays: TerrainOverlay[] = [];
  const overlaySprites: PixelBuffer[] = [];
  const animSprites: PixelBuffer[] = [];
  let overlayBytes = 0;
  const composite = opts.previewDir ? world.crop(0, 0, world.w, world.h) : null;
  const overlayPlaced: Array<{ buf: PixelBuffer; x: number; y: number }> = [];
  for (const art of out.overlays) {
    const b = art.canvas.buf.bounds();
    if (!b) continue;
    const cropped = art.canvas.crop(b.x, b.y, b.w, b.h);
    reduceColors(cropped.buf, 256);
    const file = `over_${art.id}.png`;
    overlayBytes += writePng(join(outDir, file), cropped.buf);
    overlaySprites.push(cropped.buf);
    overlays.push({
      id: art.id,
      kind: art.kind,
      file,
      x: art.x + b.x,
      y: art.y + b.y,
      w: b.w,
      h: b.h,
      fadeNearPlayer: art.fadeNearPlayer,
    });
    overlayPlaced.push({ buf: cropped.buf, x: art.x + b.x, y: art.y + b.y });
  }

  const animated: TerrainAnimatedProp[] = [];
  let animatedBytes = 0;
  for (const art of out.animated) {
    const first = art.frames[0];
    if (!first) continue;
    const strip = new Canvas(first.w * art.frames.length, first.h);
    art.frames.forEach((frame, k) =>
      strip.buf.copyFrom(frame.buf, 0, 0, first.w, first.h, k * first.w, 0),
    );
    reduceColors(strip.buf, 256);
    const file = `anim_${art.id}.png`;
    animatedBytes += writePng(join(outDir, file), strip.buf);
    animSprites.push(strip.buf);
    // Loops above the cars are part of the picture only through their first frame.
    if (art.above) composite?.buf.blit(first.buf, art.x, art.y);
    animated.push({
      id: art.id,
      kind: art.kind,
      file,
      x: art.x,
      y: art.y,
      frameWidth: first.w,
      frameHeight: first.h,
      frameCount: art.frames.length,
      fps: art.fps,
      above: art.above,
      blend: art.blend,
    });
  }

  // The client draws overlays over everything else in the world.
  for (const o of overlayPlaced) composite?.buf.blit(o.buf, o.x, o.y);

  const mini = drawMinimap(track, 240, {
    road: col('#F5EED9'),
    shortcut: col('#F6C35B'),
    start: col('#F46B58'),
    outline: col('#151C2C'),
  });
  const minimapBytes = writePng(join(outDir, 'minimap.png'), mini.canvas.buf);

  const manifest: TerrainManifest = {
    version: 1,
    trackId: def.id,
    presetId,
    worldWidth: def.worldWidth,
    worldHeight: def.worldHeight,
    chunkSize: CHUNK_SIZE,
    cols: Math.ceil(def.worldWidth / CHUNK_SIZE),
    rows: Math.ceil(def.worldHeight / CHUNK_SIZE),
    ground: ground.chunks,
    overlays,
    animated,
    lights: out.lights,
    minimap: {
      file: 'minimap.png',
      width: mini.canvas.w,
      height: mini.canvas.h,
      worldScale: mini.worldScale,
    },
  };
  const json = `${JSON.stringify(manifest, null, 1)}\n`;
  writeFileSync(join(outDir, 'manifest.json'), json);

  let previews: string[] = [];
  if (opts.previewDir && composite) {
    mkdirSync(opts.previewDir, { recursive: true });
    previews = writePreviews(
      opts.previewDir,
      world,
      composite,
      out.previewSpots,
      out.previewPlain ?? [],
      out.previewCars ?? [],
      opts.previewCarSheet ?? null,
    );
    writeSheet(join(opts.previewDir, 'sheet_overlays.png'), overlaySprites, 2);
    writeSheet(join(opts.previewDir, 'sheet_animated.png'), animSprites, 4);
    writeSheet(join(opts.previewDir, 'sheet_minimap.png'), [mini.canvas.buf], 4);
    previews.push('sheet_overlays.png', 'sheet_animated.png', 'sheet_minimap.png');
  }

  return {
    manifest,
    bytes: {
      ground: ground.bytes,
      overlays: overlayBytes,
      animated: animatedBytes,
      minimap: minimapBytes,
      manifest: Buffer.byteLength(json),
    },
    reducedChunks: ground.reduced,
    truecolorChunks: ground.truecolor,
    maxChunkColors: ground.maxColors,
    checks: out.checks,
    previews,
  };
}

export function bakeTerrain(opts: BakeOptions): TerrainManifest {
  return bakeTerrainWithReport(opts).manifest;
}
