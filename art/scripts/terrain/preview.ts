import { join } from 'node:path';
import { PixelBuffer, writePng } from '../lib/pixels.js';
import type { PreviewSpot } from './biome.js';
import type { Canvas } from './canvas.js';
import { col } from './canvas.js';

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

/** A stand-in racer, used in exactly one preview to judge scale and contrast. */
export function drawStandInCar(cv: Canvas, cx: number, cy: number, horizontal: boolean): void {
  const w = horizontal ? 58 : 34;
  const h = horizontal ? 34 : 58;
  const x = Math.round(cx - w / 2);
  const y = Math.round(cy - h / 2);
  cv.rect(x - 1, y - 1, w + 2, h + 2, col('#10131F'));
  cv.rect(x, y, w, h, col('#46D5E6'));
  cv.rect(x + 2, y + 2, w - 4, h - 4, col('#2A9FB4'));
  if (horizontal) cv.rect(x + 12, y + 6, 14, h - 12, col('#151C2C'));
  else cv.rect(x + 6, y + 12, w - 12, 14, col('#151C2C'));
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

export function writePreviews(
  dir: string,
  ground: Canvas,
  composite: Canvas,
  spots: readonly PreviewSpot[],
  plainNames: readonly string[],
  carSpot: { x: number; y: number; horizontal: boolean } | null,
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
  if (carSpot) {
    const x = Math.round(carSpot.x - 320);
    const y = Math.round(carSpot.y - 180);
    const view = ground.crop(x, y, 640, 360);
    drawStandInCar(view, 320, 180, carSpot.horizontal);
    drawStandInCar(
      view,
      320 + (carSpot.horizontal ? 90 : 60),
      180 + (carSpot.horizontal ? 60 : 90),
      carSpot.horizontal,
    );
    writePng(join(dir, 'scale_check_car.png'), view.buf.scaled(2));
    written.push('scale_check_car.png');
  }
  return written;
}
