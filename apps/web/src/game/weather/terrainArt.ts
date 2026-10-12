import type Phaser from 'phaser';
import type { TerrainAnimatedProp } from '@bolt/shared';
import { coverageFromRgba } from './overlayFade.js';
import type { OverlayCoverage } from './overlayFade.js';

/**
 * Two things the client does with the baked terrain beyond drawing it, kept out of the scene:
 * reading where an overlay's pixels are (for the fade, `overlayFade.ts`) and playing the
 * loops that follow a hazard's timetable from the race clock.
 */

/**
 * The coverage of an overlay texture, read once from its source image. Null when the image
 * cannot be read (the fade then falls back to the overlay's box).
 */
export function coverageOfTexture(scene: Phaser.Scene, key: string): OverlayCoverage | null {
  try {
    if (!scene.textures.exists(key)) return null;
    const src = scene.textures.get(key).getSourceImage() as CanvasImageSource & {
      width: number;
      height: number;
    };
    const w = src.width;
    const h = src.height;
    if (!w || !h) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(src, 0, 0);
    return coverageFromRgba(ctx.getImageData(0, 0, w, h).data, w, h);
  } catch {
    return null;
  }
}

/** Prefix of a loop that follows a hazard's timetable (ART_GUIDE, "Timetable loops"). */
export const TIMETABLE_PREFIX = 'timetable:';

export function isTimetableLoop(anim: Pick<TerrainAnimatedProp, 'kind'>): boolean {
  return anim.kind.startsWith(TIMETABLE_PREFIX);
}

/**
 * The frame of a timetable loop at a race time: frame `k` shows `[k / fps, (k + 1) / fps)`
 * from GO, modulo the loop's length (one period of the hazard). Frame 0 before GO, where the
 * race clock reads 0, as the physics' does.
 */
export function timetableFrame(
  anim: Pick<TerrainAnimatedProp, 'frameCount' | 'fps'>,
  raceSeconds: number,
): number {
  if (!(raceSeconds > 0) || anim.frameCount <= 0 || anim.fps <= 0) return 0;
  const period = anim.frameCount / anim.fps;
  const t = raceSeconds - Math.floor(raceSeconds / period) * period;
  return Math.min(anim.frameCount - 1, Math.max(0, Math.floor(t * anim.fps + 1e-9)));
}
