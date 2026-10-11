import { CAR_TILT, CAR_Z_SCALE, TAU } from '@bolt/shared';
import type { Model, Solid } from './model.js';
import { renderModel } from './model.js';
import { PixelBuffer } from './pixels.js';

/**
 * Catalog icons, rendered straight from a part's model at icon scale (never by shrinking a
 * sprite) and turned to a three-quarter pose so the shape reads.
 *
 * The icon is framed from what the camera actually sees. Every point of the model is turned
 * to the icon heading and lifted by the tilted camera, exactly as the renderer does, which
 * gives the true on-screen box of the drawing: a tall mast on a small base counts for its
 * whole height, and a long low barrel for its whole length. The model is then scaled so the
 * longer side of that box fills the tile, less a pixel of margin and a pixel of outline on
 * each side, and placed so the box is centred. (The earlier sizing took the ground radius
 * plus half the lift of the first solid found over each point. It undercounted tall parts,
 * which were cropped, and overcounted everything else, which left icons small in their tiles.)
 */

export const ICON_HEADING = (-3 * TAU) / 32;
/** Clear pixels kept between the drawing, outline included, and the edge of the tile. */
const ICON_MARGIN = 1;

type Box = { x0: number; y0: number; x1: number; y1: number };

function heightAt(solid: Solid, x: number, y: number, d: number): number {
  if (solid.height) return solid.height(x, y, d);
  const bevel = solid.bevel ?? 0;
  if (bevel <= 0) return solid.z1;
  const t = Math.max(0, Math.min(1, -d / bevel));
  const f = solid.profile === 'linear' ? t : Math.sqrt(1 - (1 - t) * (1 - t));
  return solid.z0 + (solid.z1 - solid.z0) * f;
}

/** The on-screen box of a model at a heading, in model units from its origin. */
export function screenBox(model: Model, heading: number, extent = 64, step = 0.5): Box {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  const lift = CAR_TILT * CAR_Z_SCALE;
  const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let y = -extent; y <= extent; y += step) {
    for (let x = -extent; x <= extent; x += step) {
      let top = -Infinity;
      let bottom = Infinity;
      for (const solid of model.solids) {
        const d = solid.shape(x, y);
        if (d > 0) continue;
        top = Math.max(top, heightAt(solid, x, y, d));
        // A part that rides on another shows no side below its floor.
        bottom = Math.min(bottom, solid.floor ?? 0);
      }
      if (top === -Infinity) continue;
      const sx = x * cos - y * sin;
      const sy = x * sin + y * cos;
      box.x0 = Math.min(box.x0, sx);
      box.x1 = Math.max(box.x1, sx);
      box.y0 = Math.min(box.y0, sy - lift * top);
      box.y1 = Math.max(box.y1, sy - lift * Math.max(0, bottom));
    }
  }
  if (box.x1 < box.x0) return { x0: -4, y0: -4, x1: 4, y1: 4 };
  return box;
}

/** A square icon of `size` pixels: the model as large as the tile allows, centred. */
export function renderIcon(model: Model, size: number): PixelBuffer {
  const box = screenBox(model, ICON_HEADING);
  // What the drawing may measure, outline included, on its longer side.
  const target = size - 2 * ICON_MARGIN;
  let scale = (target - 2) / Math.max(box.x1 - box.x0, box.y1 - box.y0, 1);
  // Rendered on a larger sheet about the centre of the box, then cut to the tile about the
  // centre of the pixels that were actually drawn. The estimate is within a pixel or so of
  // the drawing; one or two corrections land the longer side exactly on the target.
  const pad = 4;
  const sheet = size + 2 * pad;
  let image = new PixelBuffer(sheet, sheet);
  let drawn: ReturnType<PixelBuffer['bounds']> = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    image = renderModel(model, {
      heading: ICON_HEADING,
      width: sheet,
      height: sheet,
      tilt: CAR_TILT,
      zScale: CAR_Z_SCALE,
      scale,
      originX: sheet / 2 - ((box.x0 + box.x1) / 2) * scale,
      originY: sheet / 2 - ((box.y0 + box.y1) / 2) * scale,
    }).image;
    drawn = image.bounds();
    if (!drawn) break;
    const longer = Math.max(drawn.w, drawn.h);
    if (longer === target || longer === target - 1) break;
    scale *= (target - 0.5) / longer;
  }
  const out = new PixelBuffer(size, size);
  if (!drawn) return out;
  const left = Math.round(drawn.x + drawn.w / 2 - size / 2);
  const top = Math.round(drawn.y + drawn.h / 2 - size / 2);
  out.copyFrom(image, left, top, size, size, 0, 0);
  return out;
}
