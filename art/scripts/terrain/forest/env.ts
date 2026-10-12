import type { AnimatedArt, BakeContext, PreviewCarSpot, PreviewSpot } from '../biome.js';
import type { Canvas } from '../canvas.js';
import type { CorridorField } from '../field.js';
import { Scene } from '../oblique.js';
import { buildMaps } from './maps.js';
import type { NatureMaps } from './maps.js';

/**
 * Everything an open-track painter shares while it works: the bake context, the per-pixel maps,
 * the scene raised things are collected in, and the planes the light pass reads. The scene's
 * idea of drivable ground is the reachable ground (`maps.reach.drive`), not the corridor, so
 * nothing standing in the ground layer can hide a place a car can be.
 */

export type Env = {
  ctx: BakeContext;
  maps: NatureMaps;
  world: Canvas;
  scene: Scene;
  /** Ground shadow level per pixel (0 none, 1 light dapple, 2 canopy, 3 deep). */
  shadow: Uint8Array;
  /** Sunlit patches on the ground (light shafts, clearings). */
  sun: Uint8Array;
  animated: AnimatedArt[];
  previewSpots: PreviewSpot[];
  previewCars: PreviewCarSpot[];
  /** 0 dry to 1 standing water. */
  wet: number;
  rain: number;
  /** Shadow length per unit of height (the sun's elevation). */
  shadowK: number;
  log: string[];
};

export function createEnv(ctx: BakeContext, shadowK: number): Env {
  const maps = buildMaps(ctx);
  const { w, h } = maps;
  // The scene reads only `w`, `h` and `edge` from a field: hand it the reachable ground.
  const edge = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) edge[i] = maps.reach.drive[i] ? -1 : 1;
  const scene = new Scene({ w, h, edge } as unknown as CorridorField, []);
  return {
    ctx,
    maps,
    world: ctx.world,
    scene,
    shadow: new Uint8Array(w * h),
    sun: new Uint8Array(w * h),
    animated: [],
    previewSpots: [],
    previewCars: [],
    wet: ctx.preset.wetness,
    rain: ctx.preset.rainIntensity,
    shadowK,
    log: [],
  };
}

export function put(world: Canvas, i: number, c: number): void {
  const o = i * 4;
  const d = world.data;
  d[o] = (c >> 16) & 255;
  d[o + 1] = (c >> 8) & 255;
  d[o + 2] = c & 255;
  d[o + 3] = 255;
}

export function getc(world: Canvas, i: number): number {
  const o = i * 4;
  const d = world.data;
  return (d[o]! << 16) | (d[o + 1]! << 8) | d[o + 2]!;
}
