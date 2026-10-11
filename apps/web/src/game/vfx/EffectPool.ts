import { CAR_TILT, CAR_Z_SCALE } from '@bolt/shared';
import type { FxAtlas } from './atlas.js';
import { LAYER_COUNT } from './atlas.js';

/**
 * Pooled effect sprites (Section 13.2): fixed capacity per layer, struct-of-arrays state, no
 * allocation after construction. It knows nothing about Phaser; the renderer reads `frameOut`,
 * `drawX`, `drawY`, `drawAlpha` and `tint` for each live slot and nothing else.
 *
 * Two kinds of sprite share a layer:
 * - decorative ones (`spawn`) live for a fixed time. When their share of the layer is used up
 *   the oldest is recycled, and one that starts outside the view is not created at all;
 * - pinned ones (`pin`) belong to a projectile, a hazard or a marker and live until `release`.
 *   They are never recycled or culled: a gameplay object is never dropped to save frame time
 *   (Section 19.5). Each layer is sized so every pinned sprite the simulation can ask for fits.
 */

/** Screen pixels a point rises per unit of height: the same tilt the car sprites are baked with. */
export const HEIGHT_LIFT = CAR_TILT * CAR_Z_SCALE;

export type PoolQuality = 'high' | 'low';

/** Sprites per layer, in VFX_LAYERS order: decal, glow, ground, smoke, body, fire, flash, mark. */
export const LAYER_CAPACITY: readonly number[] = [96, 40, 640, 192, 352, 608, 256, 48];
/** Most decorative sprites alive per layer at high quality; low quality halves these. */
export const DECOR_CAP: readonly number[] = [96, 32, 128, 160, 224, 128, 192, 32];

export const MODE_ONCE = 0;
export const MODE_LOOP = 1;
export const MODE_FIXED = 2;
export const MODE_STRETCH = 3;

const F_ACTIVE = 1;
const F_PINNED = 2;
const F_GROUND_STOP = 4;

export class EffectPool {
  readonly size: number;
  readonly layerStart: number[] = [];
  readonly layerEnd: number[] = [];
  readonly flags: Uint8Array;
  readonly anim: Int16Array;
  readonly mode: Uint8Array;
  /** Fixed frame, or first frame of the direction being shown. */
  readonly frame0: Int16Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  /** Seconds of delay before the sprite appears and its clock starts. */
  readonly delay: Float32Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Height above the road, authored units. Lifts the sprite on screen; the ground is 0. */
  readonly z: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly gravity: Float32Array;
  readonly drag: Float32Array;
  readonly bounce: Float32Array;
  readonly alpha: Float32Array;
  /** Seconds at the end of its life over which it fades, in four steps. */
  readonly fade: Float32Array;
  readonly fps: Float32Array;
  readonly tint: Uint32Array;
  /** Car whose drawn position is added to x and y, or -1. */
  readonly follow: Int8Array;
  readonly born: Uint32Array;
  // --- What the renderer reads ---
  readonly frameOut: Int32Array;
  readonly drawX: Float32Array;
  readonly drawY: Float32Array;
  readonly drawAlpha: Float32Array;
  readonly shown: Uint8Array;

  quality: PoolQuality = 'high';
  /** Live sprites per layer, and the most seen since the last `resetStats`. */
  readonly live: number[] = [];
  readonly peak: number[] = [];
  private readonly decorLive: number[] = [];
  private readonly cursor: number[] = [];
  recycled = 0;
  culled = 0;
  refused = 0;
  private serial = 1;
  private viewX0 = -1e9;
  private viewY0 = -1e9;
  private viewX1 = 1e9;
  private viewY1 = 1e9;

  constructor(readonly atlas: FxAtlas) {
    let n = 0;
    for (let l = 0; l < LAYER_COUNT; l++) {
      this.layerStart.push(n);
      n += LAYER_CAPACITY[l]!;
      this.layerEnd.push(n);
      this.live.push(0);
      this.peak.push(0);
      this.decorLive.push(0);
      this.cursor.push(this.layerStart[l]!);
    }
    this.size = n;
    this.flags = new Uint8Array(n);
    this.anim = new Int16Array(n);
    this.mode = new Uint8Array(n);
    this.frame0 = new Int16Array(n);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.delay = new Float32Array(n);
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.z = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.gravity = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.bounce = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.fade = new Float32Array(n);
    this.fps = new Float32Array(n);
    this.tint = new Uint32Array(n);
    this.follow = new Int8Array(n);
    this.born = new Uint32Array(n);
    this.frameOut = new Int32Array(n);
    this.drawX = new Float32Array(n);
    this.drawY = new Float32Array(n);
    this.drawAlpha = new Float32Array(n);
    this.shown = new Uint8Array(n);
  }

  /** The visible world rectangle, for culling. */
  setView(x0: number, y0: number, x1: number, y1: number): void {
    this.viewX0 = x0;
    this.viewY0 = y0;
    this.viewX1 = x1;
    this.viewY1 = y1;
  }

  inView(x: number, y: number, margin: number): boolean {
    return (
      x >= this.viewX0 - margin &&
      x <= this.viewX1 + margin &&
      y >= this.viewY0 - margin &&
      y <= this.viewY1 + margin
    );
  }

  decorCap(layer: number): number {
    const cap = DECOR_CAP[layer]!;
    return this.quality === 'low' ? cap >> 1 : cap;
  }

  /** How many of `count` decorative particles to emit at the current quality (at least one). */
  scaled(count: number): number {
    return this.quality === 'low' ? Math.max(1, Math.ceil(count / 2)) : count;
  }

  private take(layer: number, pinned: boolean): number {
    const start = this.layerStart[layer]!;
    const end = this.layerEnd[layer]!;
    const flags = this.flags;
    let c = this.cursor[layer]!;
    const span = end - start;
    if (pinned || this.decorLive[layer]! < this.decorCap(layer)) {
      for (let i = 0; i < span; i++) {
        if (!(flags[c]! & F_ACTIVE)) {
          this.cursor[layer] = c + 1 >= end ? start : c + 1;
          return c;
        }
        c = c + 1 >= end ? start : c + 1;
      }
    }
    // Nothing free (or the decorative share is spent): the oldest decorative sprite gives way.
    let oldest = -1;
    let oldestBorn = 0xffffffff;
    for (let i = start; i < end; i++) {
      const f = flags[i]!;
      if (f & F_ACTIVE && !(f & F_PINNED) && this.born[i]! < oldestBorn) {
        oldestBorn = this.born[i]!;
        oldest = i;
      }
    }
    if (oldest >= 0) {
      this.kill(oldest);
      this.recycled++;
    } else this.refused++;
    return oldest;
  }

  private init(
    slot: number,
    layer: number,
    anim: number,
    x: number,
    y: number,
    pinned: boolean,
  ): void {
    const a = this.atlas;
    this.flags[slot] = F_ACTIVE | (pinned ? F_PINNED : 0);
    this.anim[slot] = anim;
    this.mode[slot] = a.loop[anim] ? MODE_LOOP : MODE_ONCE;
    this.frame0[slot] = 0;
    this.age[slot] = 0;
    this.fps[slot] = a.fps[anim]!;
    this.life[slot] = pinned ? Infinity : a.timeFrames[anim]! / a.fps[anim]!;
    this.delay[slot] = 0;
    this.x[slot] = x;
    this.y[slot] = y;
    this.z[slot] = 0;
    this.vx[slot] = 0;
    this.vy[slot] = 0;
    this.vz[slot] = 0;
    this.gravity[slot] = 0;
    this.drag[slot] = 0;
    this.bounce[slot] = 0;
    this.alpha[slot] = 1;
    this.fade[slot] = 0;
    this.tint[slot] = 0xffffff;
    this.follow[slot] = -1;
    this.born[slot] = this.serial++;
    this.shown[slot] = 0;
    this.drawAlpha[slot] = 0;
    this.live[layer]!++;
    if (!pinned) this.decorLive[layer]!++;
    if (this.live[layer]! > this.peak[layer]!) this.peak[layer] = this.live[layer]!;
  }

  /**
   * Starts a decorative sprite and returns its slot, or -1 when it was culled. Set any of the
   * slot's fields (velocity, height, tint, mode) right after the call.
   */
  spawn(anim: number, x: number, y: number, layer = -1, cull = true): number {
    if (cull && !this.inView(x, y, 96)) {
      this.culled++;
      return -1;
    }
    const l = layer < 0 ? this.atlas.layer[anim]! : layer;
    const slot = this.take(l, false);
    if (slot < 0) return -1;
    this.init(slot, l, anim, x, y, false);
    return slot;
  }

  /** Starts a sprite that lives until `release`. Returns -1 only if the layer is all pinned. */
  pin(anim: number, x: number, y: number, layer = -1): number {
    const l = layer < 0 ? this.atlas.layer[anim]! : layer;
    const slot = this.take(l, true);
    if (slot < 0) return -1;
    this.init(slot, l, anim, x, y, true);
    return slot;
  }

  release(slot: number): void {
    if (slot >= 0 && this.flags[slot]! & F_ACTIVE) this.kill(slot);
  }

  /** Lets a pinned sprite finish as a decorative one over `seconds` (a fade-out). */
  retire(slot: number, seconds: number): void {
    if (slot < 0 || !(this.flags[slot]! & F_ACTIVE) || !(this.flags[slot]! & F_PINNED)) return;
    const layer = this.layerOf(slot);
    this.flags[slot] = F_ACTIVE;
    this.decorLive[layer]!++;
    this.life[slot] = this.age[slot]! + seconds;
    this.fade[slot] = seconds;
  }

  isLive(slot: number): boolean {
    return slot >= 0 && (this.flags[slot]! & F_ACTIVE) !== 0;
  }

  /** A fragment that stops dead where it lands, instead of bouncing for ever. */
  stopOnGround(slot: number): void {
    this.flags[slot]! |= F_GROUND_STOP;
  }

  /** Points a directional sprite along a heading (radians, 0 up, clockwise). */
  aim(slot: number, headingRad: number): void {
    const anim = this.anim[slot]!;
    this.frame0[slot] = this.atlas.direction(anim, headingRad) * this.atlas.timeFrames[anim]!;
  }

  layerOf(slot: number): number {
    for (let l = 0; l < LAYER_COUNT; l++) if (slot < this.layerEnd[l]!) return l;
    return LAYER_COUNT - 1;
  }

  private kill(slot: number): void {
    const layer = this.layerOf(slot);
    if (!(this.flags[slot]! & F_PINNED)) this.decorLive[layer]!--;
    this.flags[slot] = 0;
    this.shown[slot] = 0;
    this.live[layer]!--;
  }

  /**
   * Advances every live sprite and works out what the renderer should draw. `carX`, `carY` are
   * the drawn positions of the cars that `follow` refers to.
   */
  update(dt: number, carX: ArrayLike<number>, carY: ArrayLike<number>): void {
    const a = this.atlas;
    const flags = this.flags;
    for (let i = 0; i < this.size; i++) {
      const f = flags[i]!;
      if (!(f & F_ACTIVE)) continue;
      if (this.delay[i]! > 0) {
        this.delay[i]! -= dt;
        this.shown[i] = 0;
        continue;
      }
      const age = (this.age[i]! += dt);
      const life = this.life[i]!;
      if (age >= life) {
        this.kill(i);
        continue;
      }
      const drag = this.drag[i]!;
      if (drag > 0) {
        const damp = Math.exp(-drag * dt);
        this.vx[i]! *= damp;
        this.vy[i]! *= damp;
      }
      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
      const g = this.gravity[i]!;
      if (g !== 0 || this.vz[i] !== 0) {
        this.vz[i]! -= g * dt;
        let z = this.z[i]! + this.vz[i]! * dt;
        if (z < 0 && g > 0) {
          const b = this.bounce[i]!;
          if (b > 0 && this.vz[i]! < -22 && !(f & F_GROUND_STOP)) {
            z = -z * b;
            this.vz[i] = -this.vz[i]! * b;
            this.vx[i]! *= 0.6;
            this.vy[i]! *= 0.6;
          } else {
            // It has landed: it lies where it fell (fragments rolling to a stop on the road).
            z = 0;
            this.vz[i] = 0;
            this.gravity[i] = 0;
            this.vx[i]! *= 0.25;
            this.vy[i]! *= 0.25;
            this.drag[i] = 6;
            if (this.mode[i] === MODE_LOOP) {
              this.mode[i] = MODE_FIXED;
              this.frame0[i] = this.frameOut[i]! - a.frameBase[this.anim[i]!]!;
            }
          }
        }
        this.z[i] = z;
      }

      const anim = this.anim[i]!;
      const frames = a.timeFrames[anim]!;
      let frame: number;
      switch (this.mode[i]) {
        case MODE_ONCE:
          frame = Math.min(frames - 1, Math.floor(age * this.fps[i]!));
          break;
        case MODE_LOOP:
          frame = Math.floor(age * this.fps[i]!) % frames;
          break;
        case MODE_STRETCH:
          frame = Math.min(frames - 1, Math.floor((age / life) * frames));
          break;
        default:
          frame = 0;
      }
      this.frameOut[i] = a.frameBase[anim]! + this.frame0[i]! + frame;

      let alpha = this.alpha[i]!;
      const fade = this.fade[i]!;
      if (fade > 0 && life - age < fade) alpha *= Math.ceil(((life - age) / fade) * 4) / 4;
      this.drawAlpha[i] = alpha;
      let x = this.x[i]!;
      let y = this.y[i]! - this.z[i]! * HEIGHT_LIFT;
      const follow = this.follow[i]!;
      if (follow >= 0) {
        x += carX[follow]!;
        y += carY[follow]!;
      }
      this.drawX[i] = x - a.anchorX[anim]!;
      this.drawY[i] = y - a.anchorY[anim]!;
      const w = a.width[anim]!;
      const h = a.height[anim]!;
      this.shown[i] =
        alpha > 0 &&
        x + w > this.viewX0 &&
        x - w < this.viewX1 &&
        y + h > this.viewY0 &&
        y - h < this.viewY1
          ? 1
          : 0;
    }
  }

  /** Total live sprites. */
  count(): number {
    let n = 0;
    for (let l = 0; l < LAYER_COUNT; l++) n += this.live[l]!;
    return n;
  }

  /** Live decorative sprites in a layer, or in all of them. */
  decorCount(layer = -1): number {
    if (layer >= 0) return this.decorLive[layer]!;
    let n = 0;
    for (let l = 0; l < LAYER_COUNT; l++) n += this.decorLive[l]!;
    return n;
  }

  resetStats(): void {
    for (let l = 0; l < LAYER_COUNT; l++) this.peak[l] = this.live[l]!;
    this.recycled = 0;
    this.culled = 0;
    this.refused = 0;
  }

  clear(): void {
    this.flags.fill(0);
    this.shown.fill(0);
    for (let l = 0; l < LAYER_COUNT; l++) {
      this.live[l] = 0;
      this.decorLive[l] = 0;
      this.cursor[l] = this.layerStart[l]!;
    }
  }
}
