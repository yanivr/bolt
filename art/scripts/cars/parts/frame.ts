import { CAR_TILT, CAR_Z_SCALE } from '@bolt/shared';
import { renderModel } from '../../lib/model.js';
import type { RGBA } from '../../lib/pixels.js';
import { PixelBuffer, hex } from '../../lib/pixels.js';
import { PAINTS, PAINT_KEY, PAINT_OUTLINE_KEY } from '../materials.js';
import type { PartArt } from '../types.js';

/**
 * How a mounted part's frame is drawn, shared by the baker and the review sheets so that a
 * preview is the pixels the game gets.
 *
 * A part has to stand off the bodywork under it, whatever the paint. Two things do that here,
 * on top of the lighter metal in `materials.ts`:
 *
 * - an outline in one near-black cool color all the way round, where a chassis takes a
 *   selective outline in the color family of each panel;
 * - a contact shadow: the part's footprint on the surface it stands on, pushed down and to
 *   the right, away from the upper-left key light, and drawn only where the part itself is
 *   not. It is a one pixel dark rim outside the outline on those two sides. Part sheets hold
 *   fully opaque or fully clear pixels only, so the shadow is an opaque dark navy, a step
 *   lighter than the outline: it reads as shade on any of the four paints and disappears into
 *   glass and tires.
 *
 * Baking the shadow into the sheet keeps the compositor single and cheap: `layoutCar` draws
 * one sprite per part, as before.
 */

export const PART_OUTLINE: RGBA = hex('#0a0d18');
export const PART_CONTACT: RGBA = hex('#1b2134');

// The runtime paint swap matches exact colors, so neither may be a paint color.
{
  const taken = new Set(
    [
      PAINT_OUTLINE_KEY,
      ...PAINT_KEY,
      ...Object.values(PAINTS).flatMap((p) => [p.outline, ...p.ramp]),
    ].map((c) => c.toLowerCase()),
  );
  for (const c of [PART_OUTLINE, PART_CONTACT]) {
    const h = `#${[c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    if (taken.has(h)) throw new Error(`Part outline color ${h} is a paint color`);
  }
}

/** How far the contact shadow falls from the footprint, in pixels right and down. */
const CONTACT_REACH = 2;

/** One heading frame of a mounted part, exactly as it is baked. */
export function renderPartFrame(art: PartArt, heading: number): PixelBuffer {
  const result = renderModel(art.model, {
    heading,
    width: art.cell,
    height: art.cell,
    tilt: CAR_TILT,
    zScale: CAR_Z_SCALE,
    outlineColor: PART_OUTLINE,
  });
  const { image, footprint } = result;
  const w = image.width;
  const h = image.height;
  const stands = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && footprint[y * w + x] === 1;
  const out = new PixelBuffer(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (image.alphaAt(x, y) !== 0) continue;
      // The corner step and the two beside it: a shadow one pixel wide outside the outline.
      if (
        stands(x - CONTACT_REACH, y - CONTACT_REACH) ||
        stands(x - CONTACT_REACH, y - CONTACT_REACH + 1) ||
        stands(x - CONTACT_REACH + 1, y - CONTACT_REACH)
      )
        out.set(x, y, PART_CONTACT);
    }
  }
  out.blit(image, 0, 0);
  return out;
}
