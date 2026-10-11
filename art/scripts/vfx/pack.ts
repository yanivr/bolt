import type { VfxAnimManifest, VfxAtlasManifest } from '@bolt/shared';
import { PixelBuffer } from '../lib/pixels.js';
import type { FxStrip } from './kit.js';

/** Clear pixels kept between any two frames (Section 14.1). */
export const ATLAS_PADDING = 2;
const ATLAS_WIDTH = 1024;

/**
 * Packs strips into one sheet, shelf by shelf, tallest first. A strip's frames stay together
 * as a grid, so the manifest needs one rectangle rule per animation and not one per frame; a
 * strip wider than the sheet wraps onto further rows of its own block.
 */
export function packAtlas(
  strips: FxStrip[],
  file: string,
): { image: PixelBuffer; manifest: VfxAtlasManifest } {
  const seen = new Set<string>();
  for (const s of strips) {
    if (!/^[a-z0-9_]+$/.test(s.id)) throw new Error(`Bad effect id ${s.id}`);
    if (seen.has(s.id)) throw new Error(`Duplicate effect id ${s.id}`);
    seen.add(s.id);
    if (s.frames.length === 0) throw new Error(`Effect ${s.id} has no frames`);
    if (s.directions > 1 && s.frames.length % s.directions !== 0)
      throw new Error(`Effect ${s.id}: frames are not a multiple of its directions`);
  }
  for (const s of strips)
    if (s.fallback && !seen.has(s.fallback))
      throw new Error(`Effect ${s.id} falls back to missing ${s.fallback}`);

  const pad = ATLAS_PADDING;
  const blocks = strips.map((strip) => {
    const cell = strip.frameWidth + pad;
    const columns = Math.max(
      1,
      Math.min(strip.frames.length, Math.floor((ATLAS_WIDTH - pad) / cell)),
    );
    const rows = Math.ceil(strip.frames.length / columns);
    return { strip, columns, w: columns * cell, h: rows * (strip.frameHeight + pad), x: 0, y: 0 };
  });
  // Tallest first; ties by id, so the layout never depends on the order strips were written.
  const order = [...blocks].sort((a, b) => b.h - a.h || (a.strip.id < b.strip.id ? -1 : 1));
  let x = pad;
  let y = pad;
  let shelf = 0;
  for (const block of order) {
    if (x + block.w > ATLAS_WIDTH) {
      x = pad;
      y += shelf;
      shelf = 0;
    }
    block.x = x;
    block.y = y;
    x += block.w;
    shelf = Math.max(shelf, block.h);
  }
  const height = y + shelf;
  const image = new PixelBuffer(ATLAS_WIDTH, height);
  const anims: Record<string, VfxAnimManifest> = {};
  for (const block of blocks) {
    const s = block.strip;
    s.frames.forEach((frame, i) => {
      if (frame.width !== s.frameWidth || frame.height !== s.frameHeight)
        throw new Error(`Effect ${s.id}: frame ${i} is the wrong size`);
      image.copyFrom(
        frame,
        0,
        0,
        s.frameWidth,
        s.frameHeight,
        block.x + (i % block.columns) * (s.frameWidth + pad),
        block.y + Math.floor(i / block.columns) * (s.frameHeight + pad),
      );
    });
    anims[s.id] = {
      id: s.id,
      x: block.x,
      y: block.y,
      frameWidth: s.frameWidth,
      frameHeight: s.frameHeight,
      frames: s.frames.length,
      columns: block.columns,
      fps: s.fps,
      loop: s.loop,
      anchorX: s.anchorX,
      anchorY: s.anchorY,
      layer: s.layer,
      blend: s.blend,
      directions: s.directions,
      fallback: s.fallback,
    };
  }
  return {
    image,
    manifest: { version: 1, file, width: ATLAS_WIDTH, height, padding: pad, anims },
  };
}
