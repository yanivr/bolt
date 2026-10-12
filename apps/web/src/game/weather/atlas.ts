import type { WeatherAtlasManifest, WeatherLayer } from '@bolt/shared';
import { WEATHER_LAYERS } from '@bolt/shared';

/**
 * The weather atlas as flat arrays, like the combat atlas (`vfx/atlas.ts`): an animation is a
 * small integer resolved once, a frame is `frameBase[anim] + index`, which is also its place
 * in the renderer's list of texture frames.
 */
export class WeatherAtlas {
  readonly names: string[] = [];
  readonly frameBase: Int32Array;
  readonly frames: Int16Array;
  /** Time frames per direction. */
  readonly timeFrames: Int16Array;
  readonly directions: Int16Array;
  readonly fps: Float32Array;
  readonly width: Int16Array;
  readonly height: Int16Array;
  readonly anchorX: Int16Array;
  readonly anchorY: Int16Array;
  readonly layer: Uint8Array;
  readonly additive: Uint8Array;
  readonly totalFrames: number;
  private readonly index = new Map<string, number>();

  constructor(readonly manifest: WeatherAtlasManifest) {
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
    this.additive = new Uint8Array(n);
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
      this.layer[i] = weatherLayerIndex(anim.layer);
      this.additive[i] = anim.blend === 'add' ? 1 : 0;
      base += anim.frames;
    });
    this.totalFrames = base;
  }

  /** Index of a named animation. A missing name is a build error, never a silent blank. */
  id(name: string): number {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`Weather animation "${name}" is not in the atlas`);
    return i;
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  /** First frame of the baked direction nearest a heading (0 up the screen, clockwise). */
  directionFrame(anim: number, headingRad: number): number {
    const dirs = this.directions[anim]!;
    if (dirs <= 1) return 0;
    const step = (Math.PI * 2) / dirs;
    const d = ((Math.round(headingRad / step) % dirs) + dirs) % dirs;
    return d * this.timeFrames[anim]!;
  }
}

export function weatherLayerIndex(layer: WeatherLayer): number {
  return WEATHER_LAYERS.indexOf(layer);
}

export const WL_WET = weatherLayerIndex('wet');
export const WL_SHINE = weatherLayerIndex('shine');
export const WL_GROUND = weatherLayerIndex('ground');
export const WL_KICK = weatherLayerIndex('kick');
export const WL_AIR = weatherLayerIndex('air');
export const WL_GLOW = weatherLayerIndex('glow');
export const WL_NEAR = weatherLayerIndex('near');
export const WL_SCREEN = weatherLayerIndex('screen');
export const WL_COUNT = WEATHER_LAYERS.length;
/** Layers drawn with additive blending. Every animation drawn on one must be baked additive. */
export const WL_ADDITIVE: readonly boolean[] = WEATHER_LAYERS.map(
  (l) => l === 'shine' || l === 'glow',
);
/** Layers above the cars: what could hide the road or a car, so the readability guard reads them. */
export const WL_OVER_CARS: readonly boolean[] = WEATHER_LAYERS.map(
  (l) => l === 'air' || l === 'glow' || l === 'near' || l === 'screen',
);

/** Every animation the runtime names. A strip in the atlas that is not here fails a test. */
export const WEATHER_ANIMS = [
  'rain_far',
  'rain_mid',
  'rain_near',
  'splash_ring',
  'splash_big',
  'splash_mud',
  'drip',
  'spray_puff',
  'spray_drops',
  'rooster',
  'track_wet',
  'track_snow',
  'track_sand',
  'track_mud',
  'refl_0',
  'refl_1',
  'refl_2',
  'refl_3',
  'refl_pool',
  'flake',
  'snow_kick',
  'ice_chip',
  'ice_glint',
  'fog_puff',
  'frost_top_0',
  'frost_bottom_0',
  'frost_left_0',
  'frost_right_0',
  'frost_top_1',
  'frost_bottom_1',
  'frost_left_1',
  'frost_right_1',
  'frost_corner_tl',
  'frost_corner_tr',
  'frost_corner_bl',
  'frost_corner_br',
  'sand_streak',
  'grit',
  'dust_band',
  'haze_0',
  'haze_1',
  'haze_2',
  'dust_plume',
  'dirt_puff',
  'mud_fleck',
  'gravel',
  'tumbleweed',
  'tumble_shadow',
  'dust_devil',
  'heat_shimmer',
  'leaf_green',
  'leaf_olive',
  'leaf_amber',
  'needle',
  'light_shaft_0',
  'light_shaft_1',
  'mote',
  'firefly',
  'mist_0',
  'mist_1',
  'steam_s',
  'steam_m',
  'steam_l',
  'smoke_wisp',
  'spark',
  'ember',
] as const;
export type WeatherAnimName = (typeof WEATHER_ANIMS)[number];
