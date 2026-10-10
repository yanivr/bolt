import { Canvas, F_EMISSIVE, F_WASH } from '../canvas.js';
import type { Color } from '../canvas.js';
import { LEAN_RUN, leanOf } from '../oblique.js';
import type { Scene, Standing } from '../oblique.js';
import { castShade } from './palette.js';

/**
 * Solid masses in the leaning oblique view. A mass is a box on a rectangular footprint. Its
 * roof is drawn `r` rows up the screen and `leanOf(r)` columns east of its footprint, its south
 * wall is sheared to follow, and its west wall shows as the slanted strip between the two.
 * Several masses share one canvas with a depth plane, so a tower hides the roof behind it and a
 * wing tucks under the main block without any drawing order to get right.
 */

export type Mass = {
  /** World footprint. */
  x: number;
  y: number;
  w: number;
  d: number;
  /** Screen rise of the roof. */
  r: number;
  /** Rise of whatever hides the foot of the south wall: it is drawn from here up. */
  base: number;
  /** The same for the west wall, when it differs. */
  wbase?: number;
};

/** Rows of a wall, counted from the ground, that take street light. */
const WASH_ROWS = 9;

export class Solid {
  readonly cv: Canvas;
  /** World position of the canvas origin. */
  readonly ox: number;
  readonly oy: number;
  private baseY = -1;

  /** `head` is the room kept above every roof for things that stand on it. */
  constructor(
    private readonly scene: Scene,
    masses: readonly Mass[],
    head: number,
    pad = 0,
  ) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const m of masses) {
      x0 = Math.min(x0, m.x);
      x1 = Math.max(x1, m.x + m.w + leanOf(m.r + head));
      y0 = Math.min(y0, m.y - m.r - head);
      y1 = Math.max(y1, m.y + m.d);
    }
    this.ox = x0 - pad;
    this.oy = y0;
    this.cv = Canvas.solid(x1 - x0 + 1 + pad * 2, y1 - y0);
  }

  /** Canvas position of the roof point above footprint pixel (lx, ly) of a mass. */
  roofX(m: Mass, lx: number): number {
    return m.x - this.ox + lx + leanOf(m.r);
  }

  roofY(m: Mass, ly: number): number {
    return m.y - this.oy + ly - m.r;
  }

  /** World row whose depth key a thing standing on roof row `ly` of a mass should use. */
  roofKey(m: Mass, ly: number): number {
    return m.y + ly;
  }

  /**
   * Paints a roof from a per-pixel texture. Wherever a taller mass to the north-west throws its
   * shadow across the roof, the texture takes a hard step down.
   */
  roof(m: Mass, tex: (lx: number, ly: number) => Color): void {
    const { cv, scene } = this;
    const sx = this.roofX(m, 0);
    const sy = this.roofY(m, 0);
    cv.curFlags = 0;
    for (let ly = 0; ly < m.d; ly++) {
      cv.curKey = m.y + ly;
      for (let lx = 0; lx < m.w; lx++) {
        let c = tex(lx, ly);
        if (scene.shaded(m.x + lx, m.y + ly, m.r)) c = castShade(c);
        cv.set(sx + lx, sy + ly, c);
      }
    }
    this.baseY = Math.max(this.baseY, m.y + m.d - 1);
  }

  /**
   * Paints a roof that is not flat. `extra` is how far each roof point stands above the eaves;
   * the surface is drawn point by point at its true height, so a slope toward the viewer
   * stretches, one away from the viewer closes up, and the ridge leans east like everything
   * else. The triangles of wall under the slopes are filled with `southWall` and `westWall`.
   */
  roofShaped(
    m: Mass,
    extra: (lx: number, ly: number) => number,
    tex: (lx: number, ly: number) => Color,
    southWall: Color,
    westWall: Color,
  ): void {
    const { cv, scene } = this;
    cv.curFlags = 0;
    const foot = m.y + m.d - 1;
    const bx = m.x - this.ox;
    // Gable on the south wall.
    cv.curKey = foot;
    for (let lx = 0; lx < m.w; lx++) {
      const e = extra(lx, m.d - 1);
      for (let v = m.r; v < m.r + e; v++) {
        const sx = bx + lx + leanOf(v);
        cv.set(sx, foot - v - this.oy, southWall);
        cv.set(sx + 1, foot - v - this.oy, southWall);
      }
    }
    // Gable on the west wall.
    for (let ly = 0; ly < m.d; ly++) {
      const e = extra(0, ly);
      cv.curKey = m.y + ly;
      for (let v = m.r; v < m.r + e; v++) {
        cv.set(bx + leanOf(v), m.y + ly - v - this.oy, westWall);
        cv.set(bx + leanOf(v), m.y + ly - v - 1 - this.oy, westWall);
      }
    }
    for (let ly = 0; ly < m.d; ly++) {
      const gy = m.y + ly;
      cv.curKey = gy;
      for (let lx = 0; lx < m.w; lx++) {
        const e = extra(lx, ly);
        const hgt = m.r + e;
        let c = tex(lx, ly);
        if (scene.shaded(m.x + lx, gy, hgt)) c = castShade(c);
        const sx = bx + lx + leanOf(hgt);
        const sy = gy - hgt - this.oy;
        cv.set(sx, sy, c);
        // Close the seams the lean and a slope toward the viewer would leave open.
        cv.set(sx + 1, sy, c);
        if (ly + 1 < m.d) {
          const below = gy + 1 - (m.r + extra(lx, ly + 1)) - this.oy;
          for (let yy = sy + 1; yy < below; yy++) {
            cv.set(sx, yy, c);
            cv.set(sx + 1, yy, c);
          }
        }
      }
    }
    this.baseY = Math.max(this.baseY, foot);
  }

  /** Paints a roof from finished art `m.w` by `m.d` pixels, keeping its self-lit pixels. */
  roofArt(m: Mass, art: Canvas, ax = 0, ay = 0): void {
    const { cv, scene } = this;
    const sx = this.roofX(m, 0);
    const sy = this.roofY(m, 0);
    for (let ly = 0; ly < m.d; ly++) {
      cv.curKey = m.y + ly;
      for (let lx = 0; lx < m.w; lx++) {
        if (art.alpha(ax + lx, ay + ly) === 0) continue;
        const lit = art.flags
          ? (art.flags[(ay + ly) * art.w + ax + lx]! & F_EMISSIVE) !== 0
          : false;
        let c = art.get(ax + lx, ay + ly);
        if (!lit && scene.shaded(m.x + lx, m.y + ly, m.r)) c = castShade(c);
        cv.curFlags = lit ? F_EMISSIVE : 0;
        cv.set(sx + lx, sy + ly, c);
      }
    }
    cv.curFlags = 0;
    this.baseY = Math.max(this.baseY, m.y + m.d - 1);
  }

  /**
   * Paints the west wall. `tex` is asked for the color `v` rows above the ground and `u` pixels
   * south of the wall's north corner; a negative result is a self-lit color.
   */
  west(m: Mass, tex: (u: number, v: number) => number): void {
    const { cv, scene } = this;
    const span = leanOf(m.r);
    const from = m.wbase ?? m.base;
    for (let j = leanOf(from); j < span; j++) {
      const v = Math.min(m.r - 1, j * LEAN_RUN + 1);
      const sx = m.x - this.ox + j;
      const wash = from === 0 && v < WASH_ROWS ? F_WASH : 0;
      for (let gy = m.y - 1; gy < m.y + m.d; gy++) {
        const u = Math.max(0, gy - m.y);
        let c = tex(u, v);
        cv.curKey = Math.max(m.y, gy);
        if (c < 0) {
          cv.curFlags = F_EMISSIVE;
          c = -c;
        } else {
          cv.curFlags = wash;
          if (scene.shaded(m.x - 1, gy, v)) c = castShade(c);
        }
        cv.set(sx, gy - v - this.oy, c);
      }
    }
    cv.curFlags = 0;
  }

  /**
   * Shears finished wall art onto the south wall. The art is `m.w` wide and `m.r - m.base`
   * tall, top row first.
   */
  south(m: Mass, art: Canvas, ax = 0, ay = 0): void {
    const { cv } = this;
    const rows = m.r - m.base;
    const foot = m.y + m.d - 1;
    cv.curKey = foot;
    for (let ly = 0; ly < rows; ly++) {
      const v = m.r - 1 - ly;
      const sx = m.x - this.ox + leanOf(v);
      const sy = foot - v - this.oy;
      const wash = m.base === 0 && v < WASH_ROWS ? F_WASH : 0;
      for (let lx = 0; lx < m.w; lx++) {
        if (art.alpha(ax + lx, ay + ly) === 0) continue;
        const lit = art.flags
          ? (art.flags[(ay + ly) * art.w + ax + lx]! & F_EMISSIVE) !== 0
          : false;
        cv.curFlags = lit ? F_EMISSIVE : wash;
        cv.set(sx + lx, sy, art.get(ax + lx, ay + ly));
      }
    }
    cv.curFlags = 0;
    this.baseY = Math.max(this.baseY, foot);
  }

  /**
   * Hangs an upright board on the south wall: signs and marquees stay square to the screen so
   * their lettering is not sheared. (lx, ly) is the board's top-left corner in wall art
   * coordinates. Returns its canvas position.
   */
  decal(m: Mass, lx: number, ly: number, art: Canvas): { x: number; y: number } {
    const { cv } = this;
    const vTop = m.r - 1 - ly;
    const vMid = Math.max(0, vTop - (art.h >> 1));
    const x = m.x - this.ox + lx + leanOf(vMid);
    const y = m.y + m.d - 1 - vTop - this.oy;
    cv.curKey = m.y + m.d - 1;
    for (let yy = 0; yy < art.h; yy++) {
      for (let xx = 0; xx < art.w; xx++) {
        const a = art.alpha(xx, yy);
        if (a === 0) continue;
        const lit = art.flags ? (art.flags[yy * art.w + xx]! & F_EMISSIVE) !== 0 : false;
        cv.curFlags = lit ? F_EMISSIVE : 0;
        cv.set(x + xx, y + yy, art.get(xx, yy));
      }
    }
    cv.curFlags = 0;
    return { x, y };
  }

  /**
   * Runs `fn` with the canvas keyed to a thing standing on roof row `ly` of a mass, so taller
   * masses in front of it still hide it.
   */
  onRoof(m: Mass, ly: number, fn: () => void): void {
    const prev = this.cv.curKey;
    this.cv.curKey = m.y + ly;
    fn();
    this.cv.curKey = prev;
  }

  /** The finished solid as a standing item. */
  item(): Standing {
    return { art: this.cv, x: this.ox, y: this.oy, baseY: this.baseY };
  }
}

/**
 * Stands a box whose art was painted flat: the roof in the top `rect.h` rows of `flat`, the
 * south wall in the `r` rows below it. The box is registered as a solid at once and composed,
 * with its lean, its west wall and the shadows that fall on it, when the scene resolves.
 * `after` may add upright things to the finished solid.
 */
export function standFlat(
  scene: Scene,
  flat: Canvas,
  rect: { x: number; y: number; w: number; h: number },
  r: number,
  west: (u: number, v: number) => number,
  head = 0,
  after?: (solid: Solid, m: Mass) => void,
): void {
  scene.solid(rect.x, rect.y, rect.w, rect.h, r);
  scene.later(() => {
    const m: Mass = { x: rect.x, y: rect.y, w: rect.w, d: rect.h, r, base: 0 };
    const solid = new Solid(scene, [m], head);
    solid.roofArt(m, flat);
    solid.west(m, west);
    solid.south(m, flat, 0, rect.h);
    if (after) after(solid, m);
    scene.add(solid.item());
  });
}

/** Plain west wall: a lit plane with a dark plinth, a cornice, and a course every few rows. */
export function plainWest(
  wall: Color,
  alt: Color,
  low: Color,
  cap: Color,
  rise: number,
  every = 6,
): (u: number, v: number) => number {
  return (_u, v) => (v <= 1 ? low : v >= rise - 3 ? cap : v % every === 0 ? alt : wall);
}
