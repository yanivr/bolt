import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PixelBuffer, readPng, writePng } from '../lib/pixels.js';
import type { PreviewSpot } from './biome.js';
import type { Canvas } from './canvas.js';

/** Review sheets. Never shipped; they exist so the art can be inspected crop by crop. */

export function downscale(src: Canvas, factor: number): PixelBuffer {
  const w = Math.floor(src.w / factor);
  const h = Math.floor(src.h / factor);
  const out = new PixelBuffer(w, h);
  const n = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let yy = 0; yy < factor; yy++) {
        for (let xx = 0; xx < factor; xx++) {
          const i = ((y * factor + yy) * src.w + x * factor + xx) * 4;
          r += src.data[i]!;
          g += src.data[i + 1]!;
          b += src.data[i + 2]!;
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = Math.round(r / n);
      out.data[o + 1] = Math.round(g / n);
      out.data[o + 2] = Math.round(b / n);
      out.data[o + 3] = 255;
    }
  }
  return out;
}

export function cropView(
  src: Canvas,
  cx: number,
  cy: number,
  vw: number,
  vh: number,
  scale: number,
): PixelBuffer {
  const x = Math.max(0, Math.min(src.w - vw, Math.round(cx - vw / 2)));
  const y = Math.max(0, Math.min(src.h - vh, Math.round(cy - vh / 2)));
  const view = new PixelBuffer(vw, vh);
  view.copyFrom(src.buf, x, y, vw, vh, 0, 0);
  return view.scaled(scale);
}

/** Lays loose sprites out on one sheet, upscaled, over a neutral night backing. */
export function writeSheet(path: string, items: readonly PixelBuffer[], scale: number): void {
  const gap = 6;
  let w = 0;
  let h = gap;
  for (const it of items) {
    w = Math.max(w, it.width * scale + gap * 2);
    h += it.height * scale + gap;
  }
  const sheet = new PixelBuffer(Math.max(1, w), Math.max(1, h));
  sheet.fill([54, 62, 83, 255]);
  let y = gap;
  for (const it of items) {
    sheet.blit(it.scaled(scale), gap, y);
    y += it.height * scale + gap;
  }
  writePng(path, sheet);
}

export type GameSpot = {
  name: string;
  x: number;
  y: number;
  /** World position and heading frame (0 to 63, clockwise from north) of a car to drop in. */
  car?: { x: number; y: number; heading: number };
};

/** The window the game shows at once, in world pixels. */
const GAME_W = 900;
const GAME_H = 420;
const CAR_CELL = 96;
const CAR_COLUMNS = 8;

export function writePreviews(
  dir: string,
  ground: Canvas,
  composite: Canvas,
  spots: readonly PreviewSpot[],
  plainNames: readonly string[],
  gameSpots: readonly GameSpot[],
  carSheet: string | null,
): string[] {
  const written: string[] = [];
  writePng(join(dir, 'overview.png'), downscale(composite, 4));
  written.push('overview.png');
  for (const spot of spots) {
    const file = `crop_${spot.name}.png`;
    writePng(join(dir, file), cropView(composite, spot.x, spot.y, 640, 360, 2));
    written.push(file);
    if (plainNames.includes(spot.name)) {
      const plain = `crop_${spot.name}_no_overlays.png`;
      writePng(join(dir, plain), cropView(ground, spot.x, spot.y, 640, 360, 2));
      written.push(plain);
    }
  }
  // Crops the size of the real game view. A car goes between the ground and the overlays,
  // exactly where the client draws it, so scale and occlusion can be judged.
  const sheet = carSheet ? readPng(carSheet) : null;
  for (const spot of gameSpots) {
    const x0 = Math.max(0, Math.min(ground.w - GAME_W, Math.round(spot.x - GAME_W / 2)));
    const y0 = Math.max(0, Math.min(ground.h - GAME_H, Math.round(spot.y - GAME_H / 2)));
    const view = new PixelBuffer(GAME_W, GAME_H);
    if (spot.car && sheet) {
      view.copyFrom(ground.buf, x0, y0, GAME_W, GAME_H, 0, 0);
      const { x, y, heading } = spot.car;
      const cx = Math.round(x - x0);
      const cy = Math.round(y - y0);
      // Ground shadow first, offset like the client's.
      const cell = new PixelBuffer(CAR_CELL, CAR_CELL);
      cell.copyFrom(
        sheet,
        (heading % CAR_COLUMNS) * CAR_CELL,
        Math.floor(heading / CAR_COLUMNS) * CAR_CELL,
        CAR_CELL,
        CAR_CELL,
        0,
        0,
      );
      for (let yy = 0; yy < CAR_CELL; yy++)
        for (let xx = 0; xx < CAR_CELL; xx++)
          if (cell.alphaAt(xx, yy) !== 0)
            view.blend(cx - CAR_CELL / 2 + xx + 2, cy - CAR_CELL / 2 + yy + 3, [10, 12, 26, 110]);
      view.blit(cell, cx - CAR_CELL / 2, cy - CAR_CELL / 2);
      // Then whatever the composite adds on top of the ground: overlays and upper loops.
      for (let yy = 0; yy < GAME_H; yy++) {
        for (let xx = 0; xx < GAME_W; xx++) {
          const g = ((y0 + yy) * ground.w + x0 + xx) * 4;
          if (
            composite.data[g] !== ground.data[g] ||
            composite.data[g + 1] !== ground.data[g + 1] ||
            composite.data[g + 2] !== ground.data[g + 2]
          )
            view.set(xx, yy, [
              composite.data[g]!,
              composite.data[g + 1]!,
              composite.data[g + 2]!,
              255,
            ]);
        }
      }
    } else view.copyFrom(composite.buf, x0, y0, GAME_W, GAME_H, 0, 0);
    const file = `game_${spot.name}${spot.car && sheet ? '_car' : ''}.png`;
    const shot = view.scaled(2);
    writePng(join(dir, file), shot);
    written.push(file);
    // A kept copy of the same shot from before a rework goes side by side with the new one.
    const before = join(dir, `before_${file}`);
    if (existsSync(before)) {
      const old = readPng(before);
      const gap = 8;
      const pair = new PixelBuffer(Math.max(old.width, shot.width), old.height + gap + shot.height);
      pair.fill([16, 19, 31, 255]);
      pair.blit(old, 0, 0);
      pair.blit(shot, 0, old.height + gap);
      const name = `compare_${spot.name}.png`;
      writePng(join(dir, name), pair);
      written.push(name);
    }
  }
  return written;
}
