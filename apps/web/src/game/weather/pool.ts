import { WEATHER_LAYERS } from '@bolt/shared';
import type { WeatherAtlas } from './atlas.js';
import { WL_COUNT } from './atlas.js';

/**
 * Fixed stores for the weather layer, no allocation after construction (Section 13.2).
 *
 * `WeatherPool` holds the particles that have a life of their own: splashes, spray, dust,
 * marks, steam, embers. Each layer has a capacity and a decorative cap inside it, halved at
 * the low tier; when the cap is reached the oldest particle of that layer is recycled, and a
 * particle that would be born outside the view is not born. Nothing in it carries gameplay,
 * so all of it may be thinned (Section 19.5).
 *
 * `DrawList` is what the renderer copies each frame: every sprite to draw, per layer, already
 * on the pixel grid. It is rebuilt every frame from the pool, the field planes (rain, snow,
 * sand), the per-frame sprites (reflections, haze, frost) and is capped per layer too.
 */

/** Sprites the renderer creates per layer, in WEATHER_LAYERS order. */
export const DRAW_CAPACITY: readonly number[] = [288, 112, 896, 352, 896, 128, 256, 224];
/** Live particles per layer at high quality (low halves these). */
export const PARTICLE_CAP: readonly number[] = [256, 48, 160, 288, 160, 96, 16, 0];

export const PM_ONCE = 0;
export const PM_LOOP = 1;
export const PM_FIXED = 2;

export class WeatherPool {
  readonly size: number;
  readonly layerStart: number[] = [];
  readonly layerEnd: number[] = [];
  readonly active: Uint8Array;
  readonly anim: Int16Array;
  readonly mode: Uint8Array;
  readonly frame0: Int16Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly delay: Float32Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Height above the ground in pixels; drawn that much higher. */
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
  readonly tint: Uint32Array;
  readonly born: Uint32Array;
  readonly live: number[] = [];
  readonly peak: number[] = [];
  private readonly cursor: number[] = [];
  private serial = 1;
  low = false;
  recycled = 0;
  culled = 0;
  private x0 = -1e9;
  private y0 = -1e9;
  private x1 = 1e9;
  private y1 = 1e9;

  constructor(readonly atlas: WeatherAtlas) {
    let n = 0;
    for (let l = 0; l < WL_COUNT; l++) {
      this.layerStart.push(n);
      n += PARTICLE_CAP[l]!;
      this.layerEnd.push(n);
      this.live.push(0);
      this.peak.push(0);
      this.cursor.push(this.layerStart[l]!);
    }
    this.size = n;
    this.active = new Uint8Array(n);
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
    this.tint = new Uint32Array(n);
    this.born = new Uint32Array(n);
  }

  setView(x0: number, y0: number, x1: number, y1: number): void {
    this.x0 = x0;
    this.y0 = y0;
    this.x1 = x1;
    this.y1 = y1;
  }

  inView(x: number, y: number, margin: number): boolean {
    return (
      x > this.x0 - margin && x < this.x1 + margin && y > this.y0 - margin && y < this.y1 + margin
    );
  }

  /** Live particles allowed in a layer at the current tier. */
  cap(layer: number): number {
    const c = PARTICLE_CAP[layer]!;
    return this.low ? c >> 1 : c;
  }

  /**
   * A new particle of `anim` at a world point, on its own layer unless one is given, playing
   * once over its strip. Returns the slot, or -1 when it would start outside the view.
   */
  spawn(anim: number, x: number, y: number, layer = -1, margin = 40): number {
    if (!this.inView(x, y, margin)) {
      this.culled++;
      return -1;
    }
    const l = layer >= 0 ? layer : this.atlas.layer[anim]!;
    const start = this.layerStart[l]!;
    const end = this.layerEnd[l]!;
    if (end <= start) return -1;
    let slot = -1;
    if (this.live[l]! < this.cap(l)) {
      // A free slot, searched from the cursor so spawning stays O(1) in steady state.
      for (let k = 0, i = this.cursor[l]!; k < end - start; k++) {
        if (!this.active[i]) {
          slot = i;
          break;
        }
        i = i + 1 >= end ? start : i + 1;
      }
    }
    if (slot < 0) {
      // Full: the oldest particle in the layer gives way.
      let oldest = Infinity;
      for (let i = start; i < end; i++)
        if (this.active[i] && this.born[i]! < oldest) {
          oldest = this.born[i]!;
          slot = i;
        }
      if (slot < 0) return -1;
      this.recycled++;
      this.active[slot] = 0;
      this.live[l]!--;
    }
    this.cursor[l] = slot + 1 >= end ? start : slot + 1;
    this.active[slot] = 1;
    this.live[l]!++;
    if (this.live[l]! > this.peak[l]!) this.peak[l] = this.live[l]!;
    this.anim[slot] = anim;
    this.mode[slot] = PM_ONCE;
    this.frame0[slot] = 0;
    this.age[slot] = 0;
    this.life[slot] = this.atlas.timeFrames[anim]! / Math.max(1, this.atlas.fps[anim]!);
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
    this.born[slot] = this.serial++;
    return slot;
  }

  update(dt: number): void {
    for (let i = 0; i < this.size; i++) {
      if (!this.active[i]) continue;
      if (this.delay[i]! > 0) {
        this.delay[i]! -= dt;
        continue;
      }
      const age = (this.age[i]! += dt);
      if (age >= this.life[i]!) {
        this.active[i] = 0;
        for (let l = 0; l < WL_COUNT; l++)
          if (i < this.layerEnd[l]!) {
            this.live[l]!--;
            break;
          }
        continue;
      }
      const drag = this.drag[i]!;
      if (drag > 0) {
        const k = Math.exp(-drag * dt);
        this.vx[i]! *= k;
        this.vy[i]! *= k;
      }
      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
      if (this.gravity[i]! !== 0 || this.vz[i]! !== 0) {
        this.vz[i]! -= this.gravity[i]! * dt;
        let z = this.z[i]! + this.vz[i]! * dt;
        if (z < 0) {
          z = 0;
          // On the ground: bounce once or twice, then slide to a stop.
          this.vz[i] = -this.vz[i]! * this.bounce[i]!;
          this.vx[i]! *= 0.5;
          this.vy[i]! *= 0.5;
          if (this.vz[i]! < 12) this.vz[i] = 0;
          if (this.vz[i] === 0) this.gravity[i] = 0;
        }
        this.z[i] = z;
      }
    }
  }

  clear(): void {
    this.active.fill(0);
    for (let l = 0; l < WL_COUNT; l++) this.live[l] = 0;
  }

  count(): number {
    let n = 0;
    for (let l = 0; l < WL_COUNT; l++) n += this.live[l]!;
    return n;
  }

  /** The frame a live particle shows now, as a global atlas frame index. */
  frameOf(i: number): number {
    const a = this.anim[i]!;
    const atlas = this.atlas;
    const tf = atlas.timeFrames[a]!;
    const mode = this.mode[i]!;
    let f = 0;
    if (mode === PM_ONCE) f = Math.min(tf - 1, Math.floor(this.age[i]! * atlas.fps[a]!));
    else if (mode === PM_LOOP) f = Math.floor(this.age[i]! * atlas.fps[a]!) % tf;
    return atlas.frameBase[a]! + this.frame0[i]! + f;
  }

  /** Alpha now: its own, faded in four steps over the end of its life. */
  alphaOf(i: number): number {
    const fade = this.fade[i]!;
    const a = this.alpha[i]!;
    if (fade <= 0) return a;
    const left = this.life[i]! - this.age[i]!;
    if (left >= fade) return a;
    return a * (Math.ceil((left / fade) * 4) / 4);
  }
}

export class DrawList {
  readonly start: number[] = [];
  readonly capacity: number[] = [];
  readonly count: Int32Array;
  readonly frame: Int32Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly alpha: Float32Array;
  readonly tint: Uint32Array;
  readonly size: number;
  /** Sprites that did not fit their layer this frame, summed since the start. */
  dropped = 0;
  readonly peak: number[] = [];

  constructor() {
    let n = 0;
    for (let l = 0; l < WEATHER_LAYERS.length; l++) {
      this.start.push(n);
      this.capacity.push(DRAW_CAPACITY[l]!);
      this.peak.push(0);
      n += DRAW_CAPACITY[l]!;
    }
    this.size = n;
    this.count = new Int32Array(WEATHER_LAYERS.length);
    this.frame = new Int32Array(n);
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.tint = new Uint32Array(n);
  }

  begin(): void {
    this.count.fill(0);
  }

  /** Adds a sprite by its top-left corner, which the caller has put on the pixel grid. */
  push(
    layer: number,
    frame: number,
    x: number,
    y: number,
    alpha: number,
    tint = 0xffffff,
  ): boolean {
    if (alpha <= 0) return false;
    const n = this.count[layer]!;
    if (n >= this.capacity[layer]!) {
      this.dropped++;
      return false;
    }
    const i = this.start[layer]! + n;
    this.frame[i] = frame;
    this.x[i] = x;
    this.y[i] = y;
    this.alpha[i] = alpha;
    this.tint[i] = tint;
    this.count[layer] = n + 1;
    if (n + 1 > this.peak[layer]!) this.peak[layer] = n + 1;
    return true;
  }

  total(): number {
    let n = 0;
    for (let l = 0; l < this.count.length; l++) n += this.count[l]!;
    return n;
  }
}
