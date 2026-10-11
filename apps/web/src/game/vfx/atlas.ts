import type { VfxAtlasManifest, VfxLayer } from '@bolt/shared';
import { VFX_LAYERS } from '@bolt/shared';

/**
 * The effects atlas as flat arrays, so the hot loops index numbers and never look a name up.
 * Animations are addressed by a small integer (`id(name)`, resolved once when a recipe is
 * built); a frame by `frameBase[anim] + index`, which is also its place in the renderer's list
 * of texture frames.
 */
export class FxAtlas {
  readonly names: string[] = [];
  readonly frameBase: Int32Array;
  readonly frames: Int16Array;
  /** Time frames per direction: `frames / directions`. */
  readonly timeFrames: Int16Array;
  readonly directions: Int16Array;
  readonly fps: Float32Array;
  readonly width: Int16Array;
  readonly height: Int16Array;
  readonly anchorX: Int16Array;
  readonly anchorY: Int16Array;
  readonly layer: Uint8Array;
  readonly loop: Uint8Array;
  /** Animation drawn in its place under reduced flashes, or -1. */
  readonly fallback: Int16Array;
  readonly totalFrames: number;
  private readonly index = new Map<string, number>();

  constructor(readonly manifest: VfxAtlasManifest) {
    const anims = Object.values(manifest.anims);
    const n = anims.length;
    this.frameBase = new Int32Array(n);
    this.frames = new Int16Array(n);
    this.timeFrames = new Int16Array(n);
    this.directions = new Int16Array(n);
    this.fps = new Float32Array(n);
    this.width = new Int16Array(n);
    this.height = new Int16Array(n);
    this.anchorX = new Int16Array(n);
    this.anchorY = new Int16Array(n);
    this.layer = new Uint8Array(n);
    this.loop = new Uint8Array(n);
    this.fallback = new Int16Array(n).fill(-1);
    let base = 0;
    anims.forEach((anim, i) => {
      this.names.push(anim.id);
      this.index.set(anim.id, i);
      this.frameBase[i] = base;
      this.frames[i] = anim.frames;
      this.directions[i] = Math.max(1, anim.directions);
      this.timeFrames[i] = Math.max(1, Math.floor(anim.frames / Math.max(1, anim.directions)));
      this.fps[i] = anim.fps;
      this.width[i] = anim.frameWidth;
      this.height[i] = anim.frameHeight;
      this.anchorX[i] = anim.anchorX;
      this.anchorY[i] = anim.anchorY;
      this.layer[i] = layerIndex(anim.layer);
      this.loop[i] = anim.loop ? 1 : 0;
      base += anim.frames;
    });
    anims.forEach((anim, i) => {
      if (anim.fallback) this.fallback[i] = this.id(anim.fallback);
    });
    this.totalFrames = base;
  }

  /** Index of a named animation. A missing name is a build error, never a silent blank. */
  id(name: string): number {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`Effect animation "${name}" is not in the atlas`);
    return i;
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  /** Heading in radians to the nearest baked direction of an animation. */
  direction(anim: number, headingRad: number): number {
    const dirs = this.directions[anim]!;
    const step = (Math.PI * 2) / dirs;
    return ((Math.round(headingRad / step) % dirs) + dirs) % dirs;
  }
}

export function layerIndex(layer: VfxLayer): number {
  return VFX_LAYERS.indexOf(layer);
}

export const LAYER_DECAL = layerIndex('decal');
export const LAYER_GLOW = layerIndex('glow');
export const LAYER_GROUND = layerIndex('ground');
export const LAYER_SMOKE = layerIndex('smoke');
export const LAYER_BODY = layerIndex('body');
export const LAYER_FIRE = layerIndex('fire');
export const LAYER_FLASH = layerIndex('flash');
/** Markers and icons: drawn last, with ordinary blending, so their dark outlines survive. */
export const LAYER_MARK = layerIndex('mark');
export const LAYER_COUNT = VFX_LAYERS.length;
