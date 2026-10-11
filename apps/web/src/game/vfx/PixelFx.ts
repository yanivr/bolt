import { hash2 } from '@bolt/shared';
import { HEIGHT_LIFT } from './EffectPool.js';

/**
 * Pixel-perfect procedural effects (Section 13: "authored frame sequences or pixel-perfect
 * procedural elements"): sparks and other single-pixel particles, and the shapes that have to
 * fit the real geometry of an event and so cannot be a baked strip: beams, lightning, rings of
 * a given radius, cones, reticles, lock brackets, ropes.
 *
 * Everything is emitted as axis-aligned rectangles on whole world pixels through a `PixelSink`.
 * In the game the sink is a Phaser Graphics object; in tests it is a counter. Nothing here
 * allocates after construction.
 */
export interface PixelSink {
  rect(x: number, y: number, w: number, h: number, color: number, alpha: number): void;
}

// --- Palettes: hottest or brightest first; a particle walks its palette as it ages ---------------
export const PAL_SPARK = 0;
export const PAL_EMBER = 1;
export const PAL_STEEL = 2;
export const PAL_CYAN = 3;
export const PAL_VIOLET = 4;
export const PAL_ICE = 5;
export const PAL_MINT = 6;
export const PAL_OIL = 7;
export const PAL_FOAM = 8;
export const PAL_RUBBER = 9;
export const PAL_GOLD = 10;
export const PAL_DUST = 11;
export const PAL_AMBER = 12;
export const PAL_RED = 13;
export const PAL_WHITE = 14;

export const PALETTES: ReadonlyArray<readonly number[]> = [
  [0xffffff, 0xfff3b0, 0xffd35a, 0xff9a3c, 0xf0602c],
  [0xffd35a, 0xff9a3c, 0xf0602c, 0xc8322e, 0x7a2430],
  [0xffffff, 0xf2f4fa, 0xc4cad8, 0x8b93a8],
  [0xffffff, 0xc8fbff, 0x7fe9f5, 0x46d5e6, 0x2a8fc0],
  [0xffffff, 0xf3e4ff, 0xc9a4ff, 0x9a6cf0, 0x6d59a2],
  [0xffffff, 0xd8f6ff, 0x9fe8ff, 0x62b8e8],
  [0xffffff, 0xeafff4, 0xa8f5cf, 0x67dea7, 0x2f9e78],
  [0x232a4a, 0x161a30, 0x0d1020],
  [0xfffdf2, 0xf0ead6, 0xd4cdb4],
  [0x2e3448, 0x1b2134, 0x1b2134],
  [0xffffff, 0xfff3b0, 0xf6c35b, 0xe0a030],
  [0xeadab4, 0xc9ae80, 0x9c8562],
  [0xfff3b0, 0xffb454, 0xe08a2c],
  [0xffb0a0, 0xf46b58, 0xd83f49],
  [0xffffff, 0xf2f4fa, 0xdfe4ee],
];

export const PIXEL_CAPACITY = 448;

export const SHAPE_BEAM = 1;
export const SHAPE_BOLT = 2;
export const SHAPE_RING = 3;
export const SHAPE_SQUARE = 4;
export const SHAPE_CONE = 5;
export const SHAPE_RETICLE = 6;
export const SHAPE_DOTS = 7;
export const SHAPE_STRIPES = 8;
export const SHAPE_NEEDLE = 9;
export const SHAPE_CAPACITY = 64;

/** Which of the two sinks a shape or particle is drawn into. */
export const PLANE_GROUND = 0;
export const PLANE_AIR = 1;

export class PixelFx {
  // --- Particles ---
  readonly pActive = new Uint8Array(PIXEL_CAPACITY);
  readonly px = new Float32Array(PIXEL_CAPACITY);
  readonly py = new Float32Array(PIXEL_CAPACITY);
  readonly pz = new Float32Array(PIXEL_CAPACITY);
  readonly pvx = new Float32Array(PIXEL_CAPACITY);
  readonly pvy = new Float32Array(PIXEL_CAPACITY);
  readonly pvz = new Float32Array(PIXEL_CAPACITY);
  readonly pGravity = new Float32Array(PIXEL_CAPACITY);
  readonly pDrag = new Float32Array(PIXEL_CAPACITY);
  readonly pAge = new Float32Array(PIXEL_CAPACITY);
  readonly pLife = new Float32Array(PIXEL_CAPACITY);
  readonly pPalette = new Uint8Array(PIXEL_CAPACITY);
  /** Streak length in pixels, 1 to 3. */
  readonly pLength = new Uint8Array(PIXEL_CAPACITY);
  readonly pSize = new Uint8Array(PIXEL_CAPACITY);
  readonly pFollow = new Int8Array(PIXEL_CAPACITY);
  private pCursor = 0;
  pixelsLive = 0;
  pixelsPeak = 0;

  // --- Shapes ---
  readonly sKind = new Uint8Array(SHAPE_CAPACITY);
  readonly sPlane = new Uint8Array(SHAPE_CAPACITY);
  readonly sAge = new Float32Array(SHAPE_CAPACITY);
  readonly sLife = new Float32Array(SHAPE_CAPACITY);
  readonly sDelay = new Float32Array(SHAPE_CAPACITY);
  readonly sx0 = new Float32Array(SHAPE_CAPACITY);
  readonly sy0 = new Float32Array(SHAPE_CAPACITY);
  readonly sx1 = new Float32Array(SHAPE_CAPACITY);
  readonly sy1 = new Float32Array(SHAPE_CAPACITY);
  /** Shape-specific numbers: radii, half-angle, dash count. */
  readonly sA = new Float32Array(SHAPE_CAPACITY);
  readonly sB = new Float32Array(SHAPE_CAPACITY);
  readonly sC = new Float32Array(SHAPE_CAPACITY);
  readonly sPalette = new Uint8Array(SHAPE_CAPACITY);
  readonly sSeed = new Uint32Array(SHAPE_CAPACITY);
  /** Cars the two ends ride on, or -1 for a point in the world. */
  readonly sFollow0 = new Int8Array(SHAPE_CAPACITY);
  readonly sFollow1 = new Int8Array(SHAPE_CAPACITY);
  private sCursor = 0;
  shapesLive = 0;
  /** Halves particle counts, set with the pool's quality tier. */
  low = false;
  /** Rectangles drawn in the last `draw` calls, for the performance readout. */
  rects = 0;

  /** How many of `count` decorative particles to emit at the current quality. */
  scaled(count: number): number {
    return this.low ? Math.max(1, Math.ceil(count / 2)) : count;
  }

  /**
   * One pixel particle. `vz` and `gravity` are in height units, so a spark thrown up falls
   * back and can be seen to land (Section 13.2: gravitational fall and bounce).
   */
  pixel(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    palette: number,
    length = 1,
    vz = 0,
    gravity = 0,
    drag = 3,
    z = 0,
    follow = -1,
    size = 1,
  ): void {
    // Sparks are decoration: when the store is full the oldest is overwritten.
    const cap = this.low ? PIXEL_CAPACITY >> 1 : PIXEL_CAPACITY;
    let i = this.pCursor;
    for (let n = 0; n < cap; n++) {
      if (!this.pActive[i]) break;
      i = i + 1 >= cap ? 0 : i + 1;
    }
    this.pCursor = i + 1 >= cap ? 0 : i + 1;
    if (!this.pActive[i]) this.pixelsLive++;
    this.pActive[i] = 1;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.pvx[i] = vx;
    this.pvy[i] = vy;
    this.pvz[i] = vz;
    this.pGravity[i] = gravity;
    this.pDrag[i] = drag;
    this.pAge[i] = 0;
    this.pLife[i] = life;
    this.pPalette[i] = palette;
    this.pLength[i] = length;
    this.pSize[i] = size;
    this.pFollow[i] = follow;
    if (this.pixelsLive > this.pixelsPeak) this.pixelsPeak = this.pixelsLive;
  }

  /** Starts a shape and returns its slot; set the `s*` fields it needs right after. */
  shape(kind: number, plane: number, life: number, palette: number, seed = 1): number {
    let i = this.sCursor;
    let found = -1;
    for (let n = 0; n < SHAPE_CAPACITY; n++) {
      if (!this.sKind[i]) {
        found = i;
        break;
      }
      i = i + 1 >= SHAPE_CAPACITY ? 0 : i + 1;
    }
    if (found < 0) {
      // All in use: the one nearest its end gives way.
      let best = -1;
      for (let k = 0; k < SHAPE_CAPACITY; k++) {
        const left = this.sLife[k]! - this.sAge[k]!;
        if (best < 0 || left < this.sLife[best]! - this.sAge[best]!) best = k;
      }
      found = best;
    } else this.shapesLive++;
    this.sCursor = found + 1 >= SHAPE_CAPACITY ? 0 : found + 1;
    this.sKind[found] = kind;
    this.sPlane[found] = plane;
    this.sAge[found] = 0;
    this.sLife[found] = life;
    this.sDelay[found] = 0;
    this.sPalette[found] = palette;
    this.sSeed[found] = seed >>> 0;
    this.sx0[found] = 0;
    this.sy0[found] = 0;
    this.sx1[found] = 0;
    this.sy1[found] = 0;
    this.sA[found] = 0;
    this.sB[found] = 0;
    this.sC[found] = 0;
    this.sFollow0[found] = -1;
    this.sFollow1[found] = -1;
    return found;
  }

  endShape(slot: number): void {
    if (slot >= 0 && this.sKind[slot]) {
      this.sKind[slot] = 0;
      this.shapesLive--;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < PIXEL_CAPACITY; i++) {
      if (!this.pActive[i]) continue;
      const age = (this.pAge[i]! += dt);
      if (age >= this.pLife[i]!) {
        this.pActive[i] = 0;
        this.pixelsLive--;
        continue;
      }
      const damp = Math.exp(-this.pDrag[i]! * dt);
      this.pvx[i]! *= damp;
      this.pvy[i]! *= damp;
      this.px[i]! += this.pvx[i]! * dt;
      this.py[i]! += this.pvy[i]! * dt;
      const g = this.pGravity[i]!;
      if (g !== 0) {
        this.pvz[i]! -= g * dt;
        let z = this.pz[i]! + this.pvz[i]! * dt;
        if (z < 0) {
          // One bounce at a third of the speed, then it skitters along the road.
          z = -z * 0.35;
          this.pvz[i] = -this.pvz[i]! * 0.35;
          this.pvx[i]! *= 0.6;
          this.pvy[i]! *= 0.6;
          if (this.pvz[i]! < 12) {
            this.pvz[i] = 0;
            this.pGravity[i] = 0;
            z = 0;
          }
        }
        this.pz[i] = z;
      }
    }
    for (let i = 0; i < SHAPE_CAPACITY; i++) {
      if (!this.sKind[i]) continue;
      if (this.sDelay[i]! > 0) {
        this.sDelay[i]! -= dt;
        continue;
      }
      if ((this.sAge[i]! += dt) >= this.sLife[i]!) {
        this.sKind[i] = 0;
        this.shapesLive--;
      }
    }
  }

  clear(): void {
    this.pActive.fill(0);
    this.sKind.fill(0);
    this.pixelsLive = 0;
    this.shapesLive = 0;
  }

  /** Draws the particles and shapes of one plane. */
  draw(sink: PixelSink, plane: number, carX: ArrayLike<number>, carY: ArrayLike<number>): void {
    if (plane === PLANE_AIR) {
      for (let i = 0; i < PIXEL_CAPACITY; i++) {
        if (!this.pActive[i]) continue;
        const pal = PALETTES[this.pPalette[i]!]!;
        const k = this.pAge[i]! / this.pLife[i]!;
        const color = pal[Math.min(pal.length - 1, Math.floor(k * pal.length))]!;
        let x = this.px[i]!;
        let y = this.py[i]! - this.pz[i]! * HEIGHT_LIFT;
        const follow = this.pFollow[i]!;
        if (follow >= 0) {
          x += carX[follow]!;
          y += carY[follow]!;
        }
        const size = this.pSize[i]!;
        x = Math.floor(x);
        y = Math.floor(y);
        sink.rect(x, y, size, size, color, 1);
        this.rects++;
        const len = this.pLength[i]!;
        if (len > 1) {
          // The streak trails behind along the velocity, one pixel a step, on the pixel grid.
          const vx = this.pvx[i]!;
          const vy = this.pvy[i]! - this.pvz[i]! * HEIGHT_LIFT;
          const m = Math.max(Math.abs(vx), Math.abs(vy), 1e-6);
          const tail = pal[Math.min(pal.length - 1, Math.floor(k * pal.length) + 1)]!;
          for (let s = 1; s < len; s++) {
            sink.rect(
              Math.floor(x - (vx / m) * s + 0.5),
              Math.floor(y - (vy / m) * s + 0.5),
              1,
              1,
              tail,
              1,
            );
            this.rects++;
          }
        }
      }
    }
    for (let i = 0; i < SHAPE_CAPACITY; i++) {
      const kind = this.sKind[i]!;
      if (!kind || this.sPlane[i] !== plane || this.sDelay[i]! > 0) continue;
      let x0 = this.sx0[i]!;
      let y0 = this.sy0[i]!;
      let x1 = this.sx1[i]!;
      let y1 = this.sy1[i]!;
      const f0 = this.sFollow0[i]!;
      const f1 = this.sFollow1[i]!;
      if (f0 >= 0) {
        x0 += carX[f0]!;
        y0 += carY[f0]!;
      }
      if (f1 >= 0) {
        x1 += carX[f1]!;
        y1 += carY[f1]!;
      }
      const t = this.sAge[i]! / this.sLife[i]!;
      const pal = PALETTES[this.sPalette[i]!]!;
      switch (kind) {
        case SHAPE_BEAM:
          this.rects += drawBeam(sink, x0, y0, x1, y1, t, pal, this.sA[i]!);
          break;
        case SHAPE_BOLT:
          this.rects += drawBolt(
            sink,
            x0,
            y0,
            x1,
            y1,
            // The bolt is redrawn on a new path every 50 ms: it snaps, it does not slide.
            this.sSeed[i]! + Math.floor(this.sAge[i]! / 0.05),
            pal,
            t,
            this.sA[i]!,
          );
          break;
        case SHAPE_RING:
          this.rects += drawRing(
            sink,
            x0,
            y0,
            this.sA[i]! + (this.sB[i]! - this.sA[i]!) * easeOut(t),
            // `sx1` is unused by a ring, so it carries an optional fixed thickness.
            x1 > 0 ? x1 : t < 0.5 ? 2 : 1,
            pal[Math.min(pal.length - 1, Math.floor(t * pal.length))]!,
            this.sC[i]!,
            0.72 - t * 0.3,
            this.sSeed[i]! * 0.13 + t * 0.05,
            1,
          );
          break;
        case SHAPE_SQUARE:
          this.rects += drawSquare(
            sink,
            x0,
            y0,
            this.sA[i]! + (this.sB[i]! - this.sA[i]!) * easeOut(t),
            pal[Math.min(pal.length - 1, Math.floor(t * pal.length))]!,
          );
          break;
        case SHAPE_CONE:
          this.rects += drawCone(
            sink,
            x0,
            y0,
            this.sA[i]!,
            this.sB[i]!,
            this.sC[i]!,
            t,
            pal,
            this.sSeed[i]!,
          );
          break;
        case SHAPE_RETICLE:
          this.rects += drawReticle(sink, x0, y0, this.sA[i]!, t, pal, this.sAge[i]!);
          break;
        case SHAPE_DOTS:
          this.rects += drawRing(
            sink,
            x0,
            y0,
            this.sA[i]!,
            1,
            pal[1]!,
            Math.max(8, Math.round(this.sA[i]! * 0.8)),
            0.5,
            this.sAge[i]! * 0.2,
            1,
          );
          break;
        case SHAPE_STRIPES:
          this.rects += drawStripes(sink, x0, y0, x1, y1, t, pal);
          break;
        case SHAPE_NEEDLE:
          this.rects += drawNeedle(sink, x0, y0, x1, y1, t, pal);
          break;
        default:
          break;
      }
    }
  }
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** A pixel line as horizontal or vertical runs. Returns the number of rectangles drawn. */
export function drawLine(
  sink: PixelSink,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: number,
  alpha = 1,
  dash = 0,
  gap = 0,
  phase = 0,
): number {
  let ax = Math.round(x0);
  let ay = Math.round(y0);
  const bx = Math.round(x1);
  const by = Math.round(y1);
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  let n = 0;
  let step = Math.floor(phase);
  const period = dash + gap;
  // Runs along the major axis are merged into one rectangle each.
  let runX = ax;
  let runY = ay;
  let runLen = 0;
  const horizontal = dx >= -dy;
  for (let guard = 0; guard < 2048; guard++) {
    const on = period <= 0 || ((step % period) + period) % period < dash;
    if (on) {
      if (runLen === 0) {
        runX = ax;
        runY = ay;
      }
      runLen++;
    }
    const last = ax === bx && ay === by;
    const e2 = 2 * err;
    let nx = ax;
    let ny = ay;
    if (!last) {
      if (e2 >= dy) {
        err += dy;
        nx += sx;
      }
      if (e2 <= dx) {
        err += dx;
        ny += sy;
      }
    }
    const turns = horizontal ? ny !== ay : nx !== ax;
    if (runLen > 0 && (last || turns || !on)) {
      if (horizontal) sink.rect(sx > 0 ? runX : runX - runLen + 1, runY, runLen, 1, color, alpha);
      else sink.rect(runX, sy > 0 ? runY : runY - runLen + 1, 1, runLen, color, alpha);
      n++;
      runLen = 0;
    }
    if (last) break;
    ax = nx;
    ay = ny;
    step++;
  }
  return n;
}

/**
 * The railgun's slug: a white needle with a cyan fringe for the first frames, then a line of
 * cyan dashes that thin out. `width` is the fringe in pixels.
 */
function drawBeam(
  sink: PixelSink,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  t: number,
  pal: readonly number[],
  width: number,
): number {
  let n = 0;
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = -(y1 - y0) / len;
  const ny = (x1 - x0) / len;
  if (t < 0.3) {
    for (let w = 1; w <= width; w++) {
      n += drawLine(sink, x0 + nx * w, y0 + ny * w, x1 + nx * w, y1 + ny * w, pal[2]!, 1);
      n += drawLine(sink, x0 - nx * w, y0 - ny * w, x1 - nx * w, y1 - ny * w, pal[2]!, 1);
    }
    n += drawLine(sink, x0, y0, x1, y1, pal[0]!, 1);
  } else if (t < 0.6) {
    n += drawLine(sink, x0, y0, x1, y1, pal[1]!, 1);
  } else {
    const stage = t < 0.8 ? 0 : 1;
    n += drawLine(
      sink,
      x0,
      y0,
      x1,
      y1,
      pal[3 + stage] ?? pal[pal.length - 1]!,
      1,
      stage ? 2 : 5,
      stage ? 6 : 3,
      t * 40,
    );
  }
  return n;
}

/** A needle-thin slash across the struck panel with a tick across it. */
function drawNeedle(
  sink: PixelSink,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  t: number,
  pal: readonly number[],
): number {
  const shrink = t < 0.4 ? 0 : (t - 0.4) / 0.6;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const hx = ((x1 - x0) / 2) * (1 - shrink);
  const hy = ((y1 - y0) / 2) * (1 - shrink);
  let n = drawLine(sink, mx - hx, my - hy, mx + hx, my + hy, pal[t < 0.3 ? 0 : 2]!, 1);
  if (t < 0.5)
    n += drawLine(sink, mx - hy * 0.35, my + hx * 0.35, mx + hy * 0.35, my - hx * 0.35, pal[1]!, 1);
  return n;
}

/**
 * Lightning between two points: a jagged path on the pixel grid with one fork. `spread` is how
 * far the path may stray from the straight line, in pixels.
 */
export function drawBolt(
  sink: PixelSink,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  seed: number,
  pal: readonly number[],
  t: number,
  spread: number,
): number {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1) return 0;
  const segments = Math.max(2, Math.min(24, Math.round(len / 7)));
  const nx = -(y1 - y0) / len;
  const ny = (x1 - x0) / len;
  const core = pal[t < 0.5 ? 0 : 1]!;
  const fringe = pal[t < 0.5 ? 2 : 3]!;
  let n = 0;
  let px = x0;
  let py = y0;
  for (let s = 1; s <= segments; s++) {
    const k = s / segments;
    // Offsets are widest mid-way and zero at the ends, so the bolt lands exactly on its target.
    const off =
      s === segments ? 0 : (hash2(s, seed, 17) - 0.5) * 2 * spread * Math.sin(k * Math.PI);
    const qx = Math.round(x0 + (x1 - x0) * k + nx * off);
    const qy = Math.round(y0 + (y1 - y0) * k + ny * off);
    n += drawLine(sink, px, py + 1, qx, qy + 1, fringe, 1);
    n += drawLine(sink, px, py, qx, qy, core, 1);
    if (s === Math.floor(segments * 0.45) && len > 24) {
      // The fork leaves at an angle and dies in the air.
      const side = hash2(seed, 3, 19) < 0.5 ? -1 : 1;
      const fx = qx + (x1 - x0) * 0.18 + nx * side * len * 0.16;
      const fy = qy + (y1 - y0) * 0.18 + ny * side * len * 0.16;
      const mx = Math.round((qx + fx) / 2 + nx * side * 3);
      const my = Math.round((qy + fy) / 2 + ny * side * 3);
      n += drawLine(sink, qx, qy, mx, my, fringe, 1);
      n += drawLine(sink, mx, my, fx, fy, fringe, 1);
    }
    px = qx;
    py = qy;
  }
  return n;
}

/**
 * A pixel ring. With `dashes` it is broken into that many arcs, each `fill` (0 to 1) drawn:
 * the broken sectors of a shockwave, the segments of a shield, the dots of a landing marker.
 * `squash` flattens it vertically for rings that lie around a tall object.
 */
export function drawRing(
  sink: PixelSink,
  cx: number,
  cy: number,
  radius: number,
  thickness: number,
  color: number,
  dashes: number,
  fill: number,
  phase: number,
  squash: number,
  alpha = 1,
): number {
  if (radius < 1) return 0;
  let n = 0;
  const ry = radius * squash;
  const x0 = Math.round(cx);
  const y0 = Math.round(cy);
  const top = Math.ceil(ry);
  for (let dy = -top; dy <= top; dy++) {
    const v = dy / Math.max(1e-6, ry);
    if (Math.abs(v) > 1) continue;
    const outer = Math.sqrt(1 - v * v) * radius;
    const inner = radius - thickness;
    const vi = dy / Math.max(1e-6, (inner > 0 ? inner : 0) * squash);
    const hole = inner > 0 && Math.abs(vi) < 1 ? Math.sqrt(1 - vi * vi) * inner : 0;
    const from = Math.round(hole);
    const to = Math.round(outer);
    if (to < from) continue;
    for (let side = -1; side <= 1; side += 2) {
      // One run a side per row, split where a gap between dashes falls.
      let runStart = -1;
      for (let dx = from; dx <= to + 1; dx++) {
        let on = dx <= to;
        if (on && dashes > 0) {
          const a = (Math.atan2(v, (side * dx) / radius) / (Math.PI * 2) + 2 + phase) % 1;
          on = (a * dashes) % 1 <= fill;
        }
        if (on && runStart < 0) runStart = dx;
        else if (!on && runStart >= 0) {
          const w = dx - runStart;
          sink.rect(side > 0 ? x0 + runStart : x0 - dx + 1, y0 + dy, w, 1, color, alpha);
          n++;
          runStart = -1;
        }
      }
      if (from === 0 && to === 0) break;
    }
  }
  return n;
}

/** The concentric square pulse of a railgun strike. */
function drawSquare(sink: PixelSink, cx: number, cy: number, half: number, color: number): number {
  const x = Math.round(cx);
  const y = Math.round(cy);
  const h = Math.round(half);
  if (h < 1) return 0;
  sink.rect(x - h, y - h, h * 2 + 1, 1, color, 1);
  sink.rect(x - h, y + h, h * 2 + 1, 1, color, 1);
  sink.rect(x - h, y - h + 1, 1, h * 2 - 1, color, 1);
  sink.rect(x + h, y - h + 1, 1, h * 2 - 1, color, 1);
  return 4;
}

/** The air cannon's pressure wave: three broken arcs running out along a cone. */
function drawCone(
  sink: PixelSink,
  x: number,
  y: number,
  dir: number,
  half: number,
  range: number,
  t: number,
  pal: readonly number[],
  seed: number,
): number {
  let n = 0;
  const ox = Math.round(x);
  const oy = Math.round(y);
  for (let band = 0; band < 3; band++) {
    const k = t * 1.25 - band * 0.16;
    if (k <= 0 || k >= 1) continue;
    const r = range * easeOut(k);
    const color = pal[Math.min(pal.length - 1, band + (k > 0.6 ? 1 : 0))]!;
    // Step along the arc a pixel at a time; skip some so the wave is made of fragments.
    const steps = Math.max(6, Math.round(r * half * 2));
    for (let s = 0; s <= steps; s++) {
      if (hash2(s, band + seed, Math.floor(t * 12)) < 0.28 + k * 0.4) continue;
      const a = dir - half + (s / steps) * half * 2;
      sink.rect(
        ox + Math.round(Math.sin(a) * r),
        oy + Math.round(-Math.cos(a) * r),
        band === 0 ? 2 : 1,
        band === 0 ? 2 : 1,
        color,
        1,
      );
      n++;
    }
  }
  return n;
}

/**
 * The mortar's reticle: an outer ring of segments that go out one by one as the shell falls,
 * so the ring is also the countdown, around a pulsing inner mark and a cross.
 */
function drawReticle(
  sink: PixelSink,
  cx: number,
  cy: number,
  radius: number,
  t: number,
  pal: readonly number[],
  age: number,
): number {
  let n = 0;
  const x = Math.round(cx);
  const y = Math.round(cy);
  const segments = 12;
  const left = Math.ceil((1 - t) * segments);
  const hot = t > 0.7 ? pal[0]! : pal[1]!;
  // Each remaining segment is drawn as its own short arc.
  for (let s = 0; s < left; s++) {
    const a0 = (s / segments) * Math.PI * 2 - Math.PI / 2;
    const a1 = a0 + ((Math.PI * 2) / segments) * 0.62;
    const steps = Math.max(3, Math.round(radius * (a1 - a0)));
    for (let k = 0; k <= steps; k++) {
      const a = a0 + ((a1 - a0) * k) / steps;
      sink.rect(
        x + Math.round(Math.cos(a) * radius),
        y + Math.round(Math.sin(a) * radius),
        2,
        2,
        hot,
        1,
      );
      n++;
    }
  }
  // The inner ring closes in on the centre as the shell arrives.
  const inner = Math.max(4, radius * (0.82 - t * 0.6));
  n += drawRing(sink, x, y, inner, 1, pal[2]!, 8, 0.5, age * 0.6, 1);
  const blink = Math.floor(age * (t > 0.7 ? 12 : 5)) % 2 === 0;
  if (blink) {
    sink.rect(x - 4, y, 9, 1, pal[0]!, 1);
    sink.rect(x, y - 4, 1, 9, pal[0]!, 1);
    n += 2;
  }
  return n;
}

/** Shock stripes of a hammer blow: three short bars across the direction of the knock. */
function drawStripes(
  sink: PixelSink,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  t: number,
  pal: readonly number[],
): number {
  let n = 0;
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  for (let s = 0; s < 3; s++) {
    const k = t * 1.3 - s * 0.14;
    if (k <= 0 || k >= 1) continue;
    const d = len * easeOut(k);
    const half = (9 - s * 2) * (1 - k * 0.5);
    const cx = x0 + ux * d;
    const cy = y0 + uy * d;
    n += drawLine(
      sink,
      cx - uy * half,
      cy + ux * half,
      cx + uy * half,
      cy - ux * half,
      pal[Math.min(pal.length - 1, s + (k > 0.5 ? 1 : 0))]!,
      1,
    );
  }
  return n;
}

/** Corner brackets around a point: the lock a seeker holds on a car. */
export function drawBrackets(
  sink: PixelSink,
  cx: number,
  cy: number,
  half: number,
  arm: number,
  color: number,
): number {
  const x = Math.round(cx);
  const y = Math.round(cy);
  const h = Math.round(half);
  for (let sx = -1; sx <= 1; sx += 2)
    for (let sy = -1; sy <= 1; sy += 2) {
      const px = x + sx * h;
      const py = y + sy * h;
      sink.rect(sx > 0 ? px - arm + 1 : px, py, arm, 1, color, 1);
      sink.rect(px, sy > 0 ? py - arm + 1 : py, 1, arm, color, 1);
    }
  return 8;
}

/**
 * A rope between two points that sags by `slack` pixels at its middle, drawn in alternating
 * light and dark links so it reads as braided cable and not as a beam.
 */
export function drawRope(
  sink: PixelSink,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  slack: number,
  light: number,
  dark: number,
): number {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const segments = Math.max(1, Math.min(16, Math.round(len / 10)));
  let n = 0;
  let px = x0;
  let py = y0;
  for (let s = 1; s <= segments; s++) {
    const k = s / segments;
    const qx = x0 + (x1 - x0) * k;
    const qy = y0 + (y1 - y0) * k + Math.sin(k * Math.PI) * slack;
    n += drawLine(sink, px, py + 1, qx, qy + 1, dark, 1);
    n += drawLine(sink, px, py, qx, qy, light, 1);
    n += drawLine(sink, px, py, qx, qy, dark, 1, 1, 3, s);
    px = qx;
    py = qy;
  }
  return n;
}
