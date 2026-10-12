import { Canvas } from '../canvas.js';
import type { Color } from '../canvas.js';
import { LEAN_RUN, TILT } from '../oblique.js';

/**
 * A small voxel modeller for the nature biomes. Trees, rocks, log piles, houses, a waterwheel
 * or a snow gun are built as solids in a grid of one-world-pixel voxels around their ground
 * anchor, then drawn in exactly the view the rest of the terrain uses: a point `z` up is drawn
 * `TILT * z` pixels up the screen and leans one pixel east for every `LEAN_RUN` of rise, so a
 * canopy, a trunk and a gable all show the same three planes as the city's buildings.
 *
 * Drawing splats the surface voxels front to back through a depth buffer, then shades every
 * visible pixel from its stored normal against the fixed upper-left sun, with a hard self
 * shadow found by marching toward the light. Shading is quantized by the caller's palette, so
 * the result is crisp pixel clusters, never a gradient.
 */

/** Screen east shift per unit of height, and screen rise per unit of height. */
const A = TILT / LEAN_RUN;
const B = TILT;

/** Sun direction (toward the light): from the upper left and above. */
const LX = -0.55;
const LY = -0.55;
const LZ = 0.63;
const LN = Math.hypot(LX, LY, LZ);
export const SUN = { x: LX / LN, y: LY / LN, z: LZ / LN };

export class Voxels {
  readonly x0: number;
  readonly y0: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly mat: Uint8Array;
  /** Normal per voxel, three signed bytes. */
  readonly nrm: Int8Array;
  /** Free per-voxel byte for the palette (a clump hash, a plank index). */
  readonly tag: Uint8Array;

  /** A grid covering x in [x0, x0 + nx), y in [y0, y0 + ny), z in [0, nz), relative to the anchor. */
  constructor(x0: number, y0: number, nx: number, ny: number, nz: number) {
    this.x0 = Math.floor(x0);
    this.y0 = Math.floor(y0);
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    const n = nx * ny * nz;
    this.mat = new Uint8Array(n);
    this.nrm = new Int8Array(n * 3);
    this.tag = new Uint8Array(n);
  }

  idx(x: number, y: number, z: number): number {
    const ix = x - this.x0;
    const iy = y - this.y0;
    if (ix < 0 || iy < 0 || z < 0 || ix >= this.nx || iy >= this.ny || z >= this.nz) return -1;
    return (z * this.ny + iy) * this.nx + ix;
  }

  get(x: number, y: number, z: number): number {
    const i = this.idx(x, y, z);
    return i < 0 ? 0 : this.mat[i]!;
  }

  put(
    x: number,
    y: number,
    z: number,
    mat: number,
    nx: number,
    ny: number,
    nz: number,
    tag = 0,
    over = true,
  ): void {
    const i = this.idx(x, y, z);
    if (i < 0) return;
    if (!over && this.mat[i] !== 0) return;
    this.mat[i] = mat;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    this.nrm[i * 3] = Math.round((nx / l) * 127);
    this.nrm[i * 3 + 1] = Math.round((ny / l) * 127);
    this.nrm[i * 3 + 2] = Math.round((nz / l) * 127);
    this.tag[i] = tag;
  }

  clear(x: number, y: number, z: number): void {
    const i = this.idx(x, y, z);
    if (i >= 0) this.mat[i] = 0;
  }

  /**
   * Ellipsoid with radii (rx, ry, rz). `bump` returns a radius multiplier for a direction (for
   * lumpy foliage); `normal` may bend the stored normal (toward a parent blob, say).
   */
  ellipsoid(
    cx: number,
    cy: number,
    cz: number,
    rx: number,
    ry: number,
    rz: number,
    mat: number,
    opts: {
      tag?: number;
      over?: boolean;
      bump?: (dx: number, dy: number, dz: number) => number;
      bend?: { x: number; y: number; z: number; k: number };
    } = {},
  ): void {
    const m = opts.bump ? 1.35 : 1;
    const irx = 1 / rx;
    const iry = 1 / ry;
    const irz = 1 / rz;
    const bump = opts.bump;
    const bend = opts.bend;
    const tag = opts.tag ?? 0;
    const over = opts.over ?? true;
    for (let z = Math.floor(cz - rz * m); z <= Math.ceil(cz + rz * m); z++) {
      const dz = (z + 0.5 - cz) * irz;
      for (let y = Math.floor(cy - ry * m); y <= Math.ceil(cy + ry * m); y++) {
        const dy = (y + 0.5 - cy) * iry;
        const dyz = dy * dy + dz * dz;
        if (!bump && dyz > 1) continue;
        for (let x = Math.floor(cx - rx * m); x <= Math.ceil(cx + rx * m); x++) {
          const dx = (x + 0.5 - cx) * irx;
          const d2 = dx * dx + dyz;
          if (!bump) {
            if (d2 > 1) continue;
          } else {
            if (d2 > m * m) continue;
            const d = Math.sqrt(d2) || 1;
            const lim = bump(dx / d, dy / d, dz / d);
            if (d2 > lim * lim) continue;
          }
          let nx = dx * irx;
          let ny = dy * iry;
          let nz = dz * irz;
          if (bend) {
            const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            nx = (nx / l) * (1 - bend.k) + bend.x * bend.k;
            ny = (ny / l) * (1 - bend.k) + bend.y * bend.k;
            nz = (nz / l) * (1 - bend.k) + bend.z * bend.k;
          }
          this.put(x, y, z, mat, nx, ny, nz, tag, over);
        }
      }
    }
  }

  /**
   * Upright column from z0 to z1 whose radius and centre may change with height: `at(z)`
   * gives { x, y, r }. The normal is radial. `rough(angle, z)` adds to the radius (bark).
   */
  column(
    z0: number,
    z1: number,
    at: (z: number) => { x: number; y: number; r: number },
    mat: number,
    rough?: (angle: number, z: number) => number,
    tag?: (angle: number, z: number) => number,
  ): void {
    for (let z = Math.floor(z0); z < Math.ceil(z1); z++) {
      const c = at(z + 0.5);
      const R = c.r + 2;
      for (let y = Math.floor(c.y - R); y <= Math.ceil(c.y + R); y++)
        for (let x = Math.floor(c.x - R); x <= Math.ceil(c.x + R); x++) {
          const dx = x + 0.5 - c.x;
          const dy = y + 0.5 - c.y;
          const ang = Math.atan2(dy, dx);
          const r = c.r + (rough ? rough(ang, z) : 0);
          if (dx * dx + dy * dy > r * r) continue;
          this.put(x, y, z, mat, dx, dy, 0, tag ? tag(ang, z) : 0);
        }
    }
  }

  /** A capsule between two points, normal pointing away from its axis. */
  capsule(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    r: number,
    mat: number,
    tag: (t: number, ang: number) => number = () => 0,
    over = true,
  ): void {
    const ex = bx - ax;
    const ey = by - ay;
    const ez = bz - az;
    const l2 = ex * ex + ey * ey + ez * ez || 1;
    for (let z = Math.floor(Math.min(az, bz) - r); z <= Math.ceil(Math.max(az, bz) + r); z++)
      for (let y = Math.floor(Math.min(ay, by) - r); y <= Math.ceil(Math.max(ay, by) + r); y++)
        for (let x = Math.floor(Math.min(ax, bx) - r); x <= Math.ceil(Math.max(ax, bx) + r); x++) {
          const px = x + 0.5 - ax;
          const py = y + 0.5 - ay;
          const pz = z + 0.5 - az;
          const t = Math.max(0, Math.min(1, (px * ex + py * ey + pz * ez) / l2));
          const dx = px - ex * t;
          const dy = py - ey * t;
          const dz = pz - ez * t;
          if (dx * dx + dy * dy + dz * dz > r * r) continue;
          this.put(x, y, z, mat, dx, dy, dz, tag(t, Math.atan2(dz, dy)), over);
        }
  }

  /** Axis-aligned box [x0, x1) x [y0, y1) x [z0, z1) with face normals. */
  box(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    mat: number,
    tag: (x: number, y: number, z: number) => number = () => 0,
  ): void {
    for (let z = z0; z < z1; z++)
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          let nx = 0;
          let ny = 0;
          let nz = 0;
          if (z === z1 - 1) nz = 1;
          else if (y === y1 - 1) ny = 1;
          else if (x === x0) nx = -1;
          else if (y === y0) ny = -1;
          else if (x === x1 - 1) nx = 1;
          else nz = 1;
          this.put(x, y, z, mat, nx, ny, nz, tag(x, y, z));
        }
  }

  /**
   * A gabled roof over [x0, x1) x [y0, y1) from height z0, ridge running along x (east-west)
   * or along y, rising `rise` voxels. Overhang is the caller's business (pass a larger box).
   */
  gable(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    z0: number,
    rise: number,
    alongX: boolean,
    mat: number,
    tag: (x: number, y: number, z: number) => number = () => 0,
  ): void {
    const span = alongX ? y1 - y0 : x1 - x0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const u = alongX ? y - y0 : x - x0;
        const fromEdge = Math.min(u + 0.5, span - u - 0.5);
        const top = z0 + Math.round((fromEdge / (span / 2)) * rise);
        const side = u + 0.5 < span / 2 ? -1 : 1;
        for (let z = z0; z <= top; z++) {
          const nA = side * (rise / (span / 2));
          this.put(
            x,
            y,
            z,
            mat,
            alongX ? 0 : nA,
            alongX ? nA : 0,
            1,
            tag(x, y, z),
          );
        }
      }
  }
}

export type Shading = {
  mat: number;
  tag: number;
  /** Unit normal. */
  nx: number;
  ny: number;
  nz: number;
  /** Lambert term against the sun, 0 to 1. */
  lambert: number;
  /** True when something in the model stands between this point and the sun. */
  shadowed: boolean;
  /** Voxel position, relative to the anchor. */
  x: number;
  y: number;
  z: number;
  /** True when a nearer surface borders this pixel (a crevice between clumps). */
  crease: boolean;
  /** True on the silhouette toward the lower right. */
  rim: boolean;
};

export type VoxelSprite = {
  canvas: Canvas;
  /** Canvas pixel of the anchor (world ground point 0, 0). */
  ax: number;
  ay: number;
  /** Per canvas pixel, the height of the visible surface (-1 empty). */
  height: Int16Array;
};

/**
 * Draws the model. `shade` turns a visible point into a color, or null to leave the pixel
 * empty. The canvas has a depth plane keyed by the world row of the ground under each point,
 * so it stacks correctly with the rest of the scene.
 */
export function renderVoxels(
  v: Voxels,
  shade: (s: Shading) => Color | null,
  opts: { shadowSteps?: number | ((mat: number) => number); creaseDepth?: number; keyY?: number } = {},
): VoxelSprite {
  const { nx, ny, nz, x0, y0, mat } = v;
  // Screen bounds.
  const sx0 = x0;
  const sx1 = x0 + nx + Math.ceil(nz * A) + 1;
  const sy0 = y0 - Math.ceil(nz * B) - 1;
  const sy1 = y0 + ny + 1;
  const W = sx1 - sx0;
  const H = sy1 - sy0;
  const depth = new Float32Array(W * H).fill(-1e9);
  const hit = new Int32Array(W * H).fill(-1);
  const plane = nx * ny;
  for (let z = 0; z < nz; z++)
    for (let iy = 0; iy < ny; iy++)
      for (let ix = 0; ix < nx; ix++) {
        const i = z * plane + iy * nx + ix;
        if (mat[i] === 0) continue;
        // Surface voxels only: something empty above, south or west (what the camera sees).
        const up = z + 1 < nz ? mat[i + plane] : 0;
        const south = iy + 1 < ny ? mat[i + nx] : 0;
        const west = ix > 0 ? mat[i - 1] : 0;
        const east = ix + 1 < nx ? mat[i + 1] : 0;
        const north = iy > 0 ? mat[i - nx] : 0;
        if (up && south && west && east && north) continue;
        const x = ix + x0;
        const y = iy + y0;
        const cd = -A * x + B * y + z;
        const px = Math.floor(x + 0.5 + (z + 0.5) * A) - sx0;
        const top = Math.floor(y - (z + 1) * B) - sy0;
        const bot = Math.floor(y + 1 - z * B) - sy0;
        for (let py = top; py < Math.max(top + 1, bot); py++) {
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          const p = py * W + px;
          if (cd > depth[p]!) {
            depth[p] = cd;
            hit[p] = i;
          }
        }
      }
  const cv = Canvas.solid(W, H);
  const height = new Int16Array(W * H).fill(-1);
  const stepsOf = opts.shadowSteps ?? 48;
  const creaseD = opts.creaseDepth ?? 3;
  const s: Shading = {
    mat: 0,
    tag: 0,
    nx: 0,
    ny: 0,
    nz: 0,
    lambert: 0,
    shadowed: false,
    x: 0,
    y: 0,
    z: 0,
    crease: false,
    rim: false,
  };
  for (let py = 0; py < H; py++)
    for (let px = 0; px < W; px++) {
      const p = py * W + px;
      const i = hit[p]!;
      if (i < 0) continue;
      const z = Math.floor(i / plane);
      const iy = Math.floor((i - z * plane) / nx);
      const ix = i - z * plane - iy * nx;
      s.mat = mat[i]!;
      s.tag = v.tag[i]!;
      s.nx = v.nrm[i * 3]! / 127;
      s.ny = v.nrm[i * 3 + 1]! / 127;
      s.nz = v.nrm[i * 3 + 2]! / 127;
      s.lambert = Math.max(0, s.nx * SUN.x + s.ny * SUN.y + s.nz * SUN.z);
      s.x = ix + x0;
      s.y = iy + y0;
      s.z = z;
      // March toward the sun through the model.
      let shadowed = false;
      const steps = typeof stepsOf === 'number' ? stepsOf : stepsOf(s.mat);
      if (s.lambert > 0) {
        for (let k = 2; k < steps; k++) {
          const qx = Math.floor(ix + 0.5 + SUN.x * k);
          const qy = Math.floor(iy + 0.5 + SUN.y * k);
          const qz = Math.floor(z + 0.5 + SUN.z * k);
          if (qx < 0 || qy < 0 || qx >= nx || qy >= ny || qz >= nz) break;
          if (mat[(qz * ny + qy) * nx + qx] !== 0) {
            shadowed = true;
            break;
          }
        }
      }
      s.shadowed = shadowed;
      const d = depth[p]!;
      s.crease = false;
      for (const q of [p - 1, p - W, p + 1, p + W]) {
        if (q < 0 || q >= W * H) continue;
        if (hit[q]! >= 0 && depth[q]! > d + creaseD) s.crease = true;
      }
      s.rim = (px + 1 < W && hit[p + 1]! < 0) || (py + 1 < H && hit[p + W]! < 0);
      const c = shade(s);
      if (c === null) continue;
      cv.curKey = Math.min(32767, Math.max(-32767, s.y + (opts.keyY ?? 0)));
      cv.set(px, py, c);
      height[p] = z;
    }
  return { canvas: cv, ax: -sx0, ay: -sy0, height };
}

/** Quantizes a light value into a ramp index with fixed thresholds. */
export function band(value: number, steps: readonly number[]): number {
  let k = 0;
  while (k < steps.length && value > steps[k]!) k++;
  return k;
}
