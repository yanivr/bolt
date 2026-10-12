import { hash2 } from '@bolt/shared';
import { Canvas, KEY_NONE } from '../canvas.js';
import type { OverlayTag, Standing } from '../oblique.js';
import { distanceField } from './edt.js';
import type { Env } from './env.js';
import { K_PAVE } from './maps.js';
import { vnoise } from './noise.js';
import { buildTree } from './trees.js';
import type { Blob, TreeModel, TreeSpec } from './trees.js';
import type { VoxelSprite } from './voxel.js';

/**
 * Standing things on an open track. Whatever part of a model covers ground a car can reach
 * goes to a foreground overlay (drawn above the cars, faded when the local car is near); the
 * rest, which stands on the model's own solid footprint, stays in the ground layer. Overlays
 * are grouped in small tiles near the road, so the client fades only the trees around the car,
 * and in large tiles far from it, so a course ships tens of overlay files, not hundreds.
 */

const NEAR_TILE = 176;
const FAR_TILE = 640;

let paveDepthCache: { env: Env; depth: Float32Array } | null = null;

/** Per pixel: how far inside the pavement it lies (0 outside it). */
export function paveDepth(env: Env): Float32Array {
  if (paveDepthCache?.env === env) return paveDepthCache.depth;
  const { w, h, kind } = env.maps;
  const notPave = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) notPave[i] = kind[i] === K_PAVE ? 0 : 1;
  const depth = distanceField(notPave, w, h, 400);
  paveDepthCache = { env, depth };
  return depth;
}

/** The overlay a thing standing at (gx, gy) belongs to. */
export function overlayTag(env: Env, gx: number, gy: number, kind: string): OverlayTag {
  const { w } = env.maps;
  const near = env.maps.roadDist[Math.round(gy) * w + Math.round(gx)]! < 140;
  const t = near ? NEAR_TILE : FAR_TILE;
  const id = `${kind}_${near ? 'n' : 'f'}_${Math.floor(gx / t)}_${Math.floor(gy / t)}`;
  return { id, kind, fade: true };
}

/** Deepest a sprite placed at (x, y) reaches into the pavement, in pixels. */
export function pavementCover(env: Env, art: Canvas, x: number, y: number): number {
  const depth = paveDepth(env);
  const { w, h } = env.maps;
  let worst = 0;
  for (let yy = 0; yy < art.h; yy++) {
    const wy = y + yy;
    if (wy < 0 || wy >= h) continue;
    for (let xx = 0; xx < art.w; xx++) {
      if (art.data[(yy * art.w + xx) * 4 + 3] === 0) continue;
      const wx = x + xx;
      if (wx < 0 || wx >= w) continue;
      const d = depth[wy * w + wx]!;
      if (d > worst) worst = d;
    }
  }
  return worst;
}

/** Stands a drawn model on ground point (gx, gy), splitting it between ground and overlay. */
export function standSprite(env: Env, sp: VoxelSprite, gx: number, gy: number, kind: string, tag?: OverlayTag): boolean {
  const item: Standing = { art: sp.canvas, x: gx - sp.ax, y: gy - sp.ay, baseY: gy };
  return env.scene.addSplit(item, tag ?? overlayTag(env, gx, gy, kind));
}

/**
 * Casts a crown's shadow on the ground: each lobe's disc moved down-sun by its height, with a
 * ragged, dappled edge, and the trunk's shadow as a band toward the south-east.
 */
export function castTreeShadow(env: Env, gx: number, gy: number, blobs: readonly Blob[], trunkTop: number, trunkR: number, seed: number): void {
  const { w, h } = env.maps;
  const K = env.shadowK;
  const sh = env.shadow;
  for (const b of blobs) {
    const cx = gx + b.x + b.z * K;
    const cy = gy + b.y + b.z * K;
    const r = b.r * 0.95;
    for (let y = Math.floor(cy - r - 3); y <= cy + r + 3; y++)
      for (let x = Math.floor(cx - r - 3); x <= cx + r + 3; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const d = Math.hypot(x - cx, y - cy) / r;
        const n = vnoise(x, y, 5, seed) - 0.5;
        if (d + n * 0.35 > 1) continue;
        const i = y * w + x;
        // Sun flecks: small holes in the shadow where light gets through.
        const fleck = vnoise(x, y, 4, seed + 1) > 0.8 - (1 - d) * 0.1;
        const lvl = fleck ? 1 : d < 0.7 ? 2 : 2;
        if (sh[i]! < lvl) sh[i] = lvl;
      }
  }
  // Trunk.
  const len = trunkTop * K;
  for (let t = 0; t < len; t += 0.7) {
    const cx = gx + t;
    const cy = gy + t;
    const r = trunkR * (1 - (t / len) * 0.4);
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r * r) continue;
        const i = y * w + x;
        sh[i] = 3;
      }
  }
}

const modelCache = new Map<string, { model: TreeModel; keyY: number }>();

/**
 * A tree model, built once per recipe and re-keyed for where it stands. Only the background
 * woods (where nobody looks closely) share recipes; every obstacle tree is its own.
 */
export function cachedTree(spec: TreeSpec, keyY: number): TreeModel {
  const key = JSON.stringify(spec);
  let hit = modelCache.get(key);
  if (!hit) {
    hit = { model: buildTree(spec, 0), keyY: 0 };
    modelCache.set(key, hit);
  }
  const src = hit.model.sprite.canvas;
  const cv = Canvas.solid(src.w, src.h);
  cv.data.set(src.data);
  if (src.flags && cv.flags) cv.flags.set(src.flags);
  if (src.keys && cv.keys)
    for (let i = 0; i < src.keys.length; i++) cv.keys[i] = src.keys[i] === KEY_NONE ? KEY_NONE : src.keys[i]! + keyY;
  return { ...hit.model, sprite: { ...hit.model.sprite, canvas: cv } };
}

export type PlacedTree = { model: TreeModel; spec: TreeSpec; x: number; y: number; scale: number };

/**
 * Plants a tree on an obstacle. The tree is built at full height, then at shorter heights
 * until its picture leaves the racing surface readable: no more than `maxCover` pixels into
 * the pavement (the near side of a road, where a tall crown would lie across it on screen).
 */
let planted = 0;
let plantMs = 0;
export function plantStats(): string {
  return `${planted} trees drawn in ${(plantMs / 1000).toFixed(1)} s`;
}

export function plantTree(env: Env, spec: TreeSpec, x: number, y: number, maxCover = 10, shared = false): PlacedTree {
  const t0 = performance.now();
  // Build at full height; if the crown lies across the pavement, estimate the height that
  // clears it from how far it reaches in, and try again (twice at most, then a fallback).
  let scale = 1;
  let model: TreeModel | null = null;
  let used = 1;
  for (let attempt = 0; attempt < 4; attempt++) {
    const sp = { ...spec, heightScale: (spec.heightScale ?? 1) * scale };
    const m = shared ? cachedTree(sp, y) : buildTree(sp, y);
    const cover = pavementCover(env, m.sprite.canvas, x - m.sprite.ax, y - m.sprite.ay);
    model = m;
    used = scale;
    if (cover <= maxCover) break;
    const rise = Math.max(20, m.top * 0.62);
    const next = attempt === 2 ? 0.3 : scale * Math.max(0.3, (rise - (cover - maxCover) - 6) / rise);
    if (next >= scale - 0.02) {
      scale = scale * 0.8;
      continue;
    }
    scale = next;
  }
  const m = model!;
  standSprite(env, m.sprite, x, y, 'canopy');
  castTreeShadow(env, x, y, m.blobs, m.trunkTop, spec.radius * 0.6, spec.seed);
  planted++;
  plantMs += performance.now() - t0;
  if (planted % 50 === 0) console.log(`  ... ${plantStats()}`);
  return { model: m, spec, x, y, scale: used };
}

/** A stable per-obstacle seed. */
export function seedOf(id: string, x: number, y: number): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) ^ Math.floor(hash2(x, y, 7) * 1e9)) >>> 0;
}
