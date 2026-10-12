import type { Color } from '../canvas.js';
import { mixc } from '../canvas.js';
import { fbm, rng, vnoise } from './noise.js';
import { NAT } from './palette.js';
import { SUN, Voxels, band, renderVoxels } from './voxel.js';
import type { Shading, VoxelSprite } from './voxel.js';

/**
 * Trees, the heroes of the forest and snow biomes. Each species is a recipe for a voxel model:
 * a trunk standing exactly on its collision disc (root flare to the obstacle's radius), limbs,
 * and a crown of big lobes covered in small leaf clumps. Every tree is built from its own seed,
 * so size, lean, crown shape and hue vary and no two trees are copies.
 */

export type Species = 'oak' | 'birch' | 'alder' | 'redwood' | 'pine' | 'fir' | 'reedbed';

export type TreeSpec = {
  species: Species;
  seed: number;
  /** The obstacle's collision radius: the trunk's root flare covers exactly this disc. */
  radius: number;
  /** Multiplies every height (to keep a crown off the pavement on the near side of a road). */
  heightScale?: number;
  /** Snow load from 0 (none) to 1 (heavy), for the snow biome. */
  snow?: number;
  /** Override the overall size multiplier of the crown. */
  crownScale?: number;
  /** An old oak with a hollow in its trunk, facing the camera. */
  hollow?: boolean;
};

export type Blob = { x: number; y: number; z: number; r: number };

export type TreeModel = {
  sprite: VoxelSprite;
  /** Crown lobes, for the ground shadow. */
  blobs: Blob[];
  trunkTop: number;
  /** Highest voxel. */
  top: number;
};

const M_LEAF = 1;
const M_BARK = 2;
const M_ROOT = 3;
const M_BIRCH = 4;
const M_HOLLOW = 5;
const M_SNOW = 6;
const M_DEADWOOD = 7;

const LEAF_STEPS = [0.2, 0.34, 0.48, 0.62, 0.76, 0.9];
const BARK_STEPS = [0.18, 0.34, 0.5, 0.68, 0.84];

/** Leaf ramp index from shading: lit clumps toward the upper left, hard self shadow. */
function leafTone(s: Shading, ramp: readonly Color[], bias: number, form: number): Color {
  let v = 0.1 + s.lambert * 0.5 + form * 0.5 + s.nz * 0.06 + bias;
  if (s.shadowed) v = v * 0.5 + 0.07;
  let k = band(v, LEAF_STEPS);
  // Clump variety: one clump in five a step lighter or darker.
  const t = s.tag & 15;
  if (t < 2) k++;
  else if (t > 13) k--;
  if (s.crease) k -= 2;
  if (s.rim) k = Math.min(k, 1);
  return ramp[Math.max(0, Math.min(ramp.length - 1, k))]!;
}

function barkTone(s: Shading, ramp: readonly Color[], fissure: boolean): Color {
  let v = 0.2 + s.lambert * 0.8 + (s.ny > 0.5 ? 0.12 : 0);
  if (s.shadowed) v = v * 0.45;
  let k = band(v, BARK_STEPS);
  if (fissure) k -= 1;
  if (s.rim) k = Math.min(k, 1);
  return ramp[Math.max(0, Math.min(ramp.length - 1, k))]!;
}

function snowTone(s: Shading): Color {
  let v = 0.2 + s.lambert * 0.85;
  if (s.shadowed) v *= 0.55;
  const k = band(v, [0.3, 0.5, 0.68, 0.84]);
  return SNOW_RAMP[Math.max(0, k - (s.crease ? 1 : 0))]!;
}

export const SNOW_RAMP: readonly Color[] = [
  0x8a94c0, 0xa6b2d6, 0xc4d0e8, 0xdde6f4, 0xf2f6fc,
].map((c) => c);

/**
 * Covers a lobe with leaf clumps: a solid core so nothing shows through, then small spheres on
 * the surface whose normals lean toward the lobe's own, so each clump catches the light on its
 * upper left and the lobe still reads as one mass.
 */
function lobe(
  v: Voxels,
  b: Blob,
  next: () => number,
  clump: number,
  squash: number,
  mat = M_LEAF,
): void {
  v.ellipsoid(b.x, b.y, b.z, b.r - clump * 0.6, b.r - clump * 0.6, (b.r - clump * 0.6) * squash, mat, {
    tag: 8,
  });
  const area = 4 * Math.PI * b.r * b.r;
  const count = Math.round((area / (clump * clump * 3.2)) * 1.0);
  for (let k = 0; k < count; k++) {
    // Uniform direction, biased upward (the underside of a crown is mostly hidden).
    const u = next() * 2 - 1;
    const th = next() * Math.PI * 2;
    let dz = u * 0.9 + 0.1;
    if (dz < -0.6) dz = -0.6;
    const rr = Math.sqrt(Math.max(0, 1 - dz * dz));
    const dx = rr * Math.cos(th);
    const dy = rr * Math.sin(th);
    const r = clump * (0.75 + next() * 0.55);
    const cx = b.x + dx * (b.r - r * 0.5);
    const cy = b.y + dy * (b.r - r * 0.5);
    const cz = b.z + dz * (b.r - r * 0.5) * squash;
    v.ellipsoid(cx, cy, cz, r, r, r * 0.9, mat, {
      tag: (next() * 16) | 0,
      bend: { x: dx, y: dy, z: dz * squash + 0.25, k: 0.45 },
    });
  }
}

function barkRough(seed: number, depth: number, period: number) {
  return (ang: number, z: number): number =>
    (vnoise(ang * period, z * 0.35, 1, seed) - 0.5) * depth;
}

function fissure(seed: number, period: number) {
  return (ang: number, z: number): number =>
    vnoise(ang * period + vnoise(z, 0, 9, seed + 3) * 1.5, z * 0.12, 1, seed + 1) < 0.3 ? 1 : 0;
}

/** Root flare: buttresses from the trunk out to the collision radius. */
function roots(
  v: Voxels,
  next: () => number,
  trunkR: number,
  radius: number,
  count: number,
  mat = M_ROOT,
): void {
  const a0 = next() * Math.PI * 2;
  for (let k = 0; k < count; k++) {
    const a = a0 + (k / count) * Math.PI * 2 + (next() - 0.5) * 0.6;
    const reach = radius - 1.5 - next() * 1.5;
    const r = Math.max(1.6, trunkR * (0.28 + next() * 0.12));
    v.capsule(
      Math.cos(a) * trunkR * 0.5,
      Math.sin(a) * trunkR * 0.5,
      trunkR * 0.7,
      Math.cos(a) * reach,
      Math.sin(a) * reach,
      0.5,
      r,
      mat,
      () => 0,
      false,
    );
  }
}

/**
 * Broadleaf crown: a dome of lobes around a centre, the largest on top, smaller ones hanging
 * at the sides. Returns the lobes.
 */
function crown(
  v: Voxels,
  next: () => number,
  cx: number,
  cy: number,
  cz: number,
  R: number,
  lobes: number,
  clump: number,
  squash: number,
): Blob[] {
  const out: Blob[] = [{ x: cx, y: cy, z: cz + R * 0.18, r: R * (0.62 + next() * 0.08) }];
  const a0 = next() * Math.PI * 2;
  for (let k = 0; k < lobes; k++) {
    const a = a0 + (k / lobes) * Math.PI * 2 + (next() - 0.5) * 0.7;
    const d = R * (0.45 + next() * 0.2);
    // Lobes on the near (south) side ride higher, so the trunk shows under the crown.
    const sy = Math.sin(a);
    out.push({
      x: cx + Math.cos(a) * d,
      y: cy + sy * d * 0.95,
      z: cz - R * 0.1 + Math.max(0, sy) * R * 0.22 + (next() - 0.4) * R * 0.3,
      r: R * (0.4 + next() * 0.16),
    });
  }
  for (const b of out) lobe(v, b, next, clump, squash);
  return out;
}

function limb(
  v: Voxels,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  r0: number,
): void {
  const n = 4;
  for (let k = 0; k < n; k++) {
    const t0 = k / n;
    const t1 = (k + 1) / n;
    const sag = Math.sin(t0 * Math.PI) * 2;
    const r = Math.max(1.1, r0 * (1 - t0 * 0.6));
    v.capsule(
      x0 + (x1 - x0) * t0,
      y0 + (y1 - y0) * t0,
      z0 + (z1 - z0) * t0 + sag,
      x0 + (x1 - x0) * t1,
      y0 + (y1 - y0) * t1,
      z0 + (z1 - z0) * t1 + Math.sin(t1 * Math.PI) * 2,
      r,
      M_BARK,
      () => 0,
      false,
    );
  }
}

function makeOak(spec: TreeSpec, next: () => number): Made {
  const hs = spec.heightScale ?? 1;
  const cs = spec.crownScale ?? 1;
  const R = (34 + next() * 16) * cs;
  const trunkR = spec.radius * (0.62 + next() * 0.08);
  const trunkH = (34 + next() * 16) * hs;
  const leanX = (next() - 0.5) * 6;
  const leanY = (next() - 0.5) * 6;
  const cz = trunkH + R * 0.62;
  const top = Math.ceil(cz + R * 0.9) + 4;
  const ext = Math.ceil(R * 1.35 + 8);
  const v = new Voxels(-ext + leanX, -ext + leanY, ext * 2, ext * 2, top);
  const rough = barkRough(spec.seed, 1.6, 2.2);
  v.column(
    0,
    trunkH + 4,
    (z) => {
      const t = z / trunkH;
      return { x: leanX * t * t, y: leanY * t * t, r: trunkR * (1 - t * 0.28) };
    },
    M_BARK,
    rough,
    fissure(spec.seed, 3),
  );
  roots(v, next, trunkR, spec.radius, 5 + ((next() * 3) | 0));
  if (spec.hollow) {
    for (let z = 2; z < 16; z++)
      for (let y = 0; y <= Math.ceil(trunkR) + 2; y++)
        for (let x = -5; x <= 5; x++) {
          const arch = Math.abs(x) < 5 - Math.max(0, z - 11);
          if (!arch || v.get(x, y, z) === 0) continue;
          if (y > trunkR - 2.5) v.clear(x, y, z);
          else if (y > trunkR * 0.2) v.put(x, y, z, M_HOLLOW, 0, 1, 0);
        }
  }
  // Limbs from the top of the trunk into the lobes.
  const blobs = crown(v, next, leanX, leanY, cz, R, 5 + ((next() * 3) | 0), 4.2, 0.78);
  for (const b of blobs.slice(1, 5))
    limb(v, leanX, leanY, trunkH - 2, b.x * 0.75 + leanX * 0.25, b.y * 0.75 + leanY * 0.25, b.z - b.r * 0.4, trunkR * 0.45);
  // An oak's crown is not closed: a gap or two shows the limbs inside.
  const gaps = (next() * 2) | 0;
  for (let k = 0; k < gaps; k++) {
    const b = blobs[1 + ((next() * (blobs.length - 1)) | 0)]!;
    for (let z = Math.floor(b.z - b.r); z < b.z + b.r * 0.2; z++)
      for (let y = Math.floor(b.y + b.r * 0.4); y < b.y + b.r; y++)
        for (let x = Math.floor(b.x - b.r * 0.25); x < b.x + b.r * 0.25; x++)
          if (v.get(x, y, z) === M_LEAF) v.clear(x, y, z);
  }
  const ramp = NAT.oak[(next() * NAT.oak.length) | 0]!;
  return { v, blobs, trunkTop: trunkH, ramp, form: domeForm(leanX, leanY, cz, 0.8) };
}

/** A clump of two to four slim white stems sharing the collision disc, light airy crowns. */
type Made = {
  v: Voxels;
  blobs: Blob[];
  trunkTop: number;
  ramp: readonly Color[];
  /** Crown-scale normal at a point: what the whole crown's form says the light should be. */
  form: (x: number, y: number, z: number) => [number, number, number];
};

function domeForm(cx: number, cy: number, cz: number, squash: number): Made['form'] {
  return (x, y, z) => [x - cx, y - cy, (z - cz) / squash];
}

/** A clump of two to four slim white stems sharing the collision disc, light airy crowns. */
function makeBirch(spec: TreeSpec, next: () => number): Made {
  const hs = spec.heightScale ?? 1;
  const cs = spec.crownScale ?? 1;
  const stems = 2 + ((next() * 3) | 0);
  const R = (22 + next() * 7) * cs;
  const H = (58 + next() * 20) * hs;
  const ext = Math.ceil(R * 1.8 + 22);
  const top = Math.ceil(H + R * 1.3) + 6;
  const v = new Voxels(-ext, -ext, ext * 2, ext * 2, top);
  const blobs: Blob[] = [];
  const a0 = next() * Math.PI * 2;
  for (let k = 0; k < stems; k++) {
    const a = a0 + (k / stems) * Math.PI * 2;
    const foot = spec.radius * 0.42;
    const fx = Math.cos(a) * foot;
    const fy = Math.sin(a) * foot;
    const lean = 0.1 + next() * 0.12;
    const h = H * (0.82 + next() * 0.24);
    const r = 2.6 + next() * 1.2;
    const tx = fx + Math.cos(a) * h * lean;
    const ty = fy + Math.sin(a) * h * lean;
    v.column(
      0,
      h,
      (z) => {
        const t = z / h;
        return { x: fx + (tx - fx) * t, y: fy + (ty - fy) * t, r: r * (1 - t * 0.45) };
      },
      M_BIRCH,
      undefined,
      (_ang, z) => (vnoise(z * 0.7, k * 7, 1.2, spec.seed + 5) < 0.3 ? 1 : 0),
    );
    // Crowns sit high and loose, offset outward, so the white stems show beneath.
    const b: Blob = {
      x: tx + Math.cos(a) * 3,
      y: ty + Math.sin(a) * 3,
      z: h - R * 0.1,
      r: R * (0.72 + next() * 0.22),
    };
    blobs.push(b);
    lobe(v, { ...b, z: b.z + b.r * 0.45, r: b.r * 0.66 }, next, 3, 1.05);
    lobe(v, b, next, 3, 0.85);
    const side = a + Math.PI / 2;
    lobe(v, { x: b.x + Math.cos(side) * b.r * 0.6, y: b.y + Math.sin(side) * b.r * 0.6, z: b.z - b.r * 0.2, r: b.r * 0.6 }, next, 3, 0.85);
    lobe(v, { x: b.x - Math.cos(side) * b.r * 0.55, y: b.y - Math.sin(side) * b.r * 0.55, z: b.z - b.r * 0.1, r: b.r * 0.55 }, next, 3, 0.85);
    // A few twigs and loose sprays below the crown.
    for (let j = 0; j < 2; j++) {
      const za = h * (0.55 + next() * 0.2);
      const t = za / h;
      const ox = fx + (tx - fx) * t;
      const oy = fy + (ty - fy) * t;
      const aa = a + (next() - 0.5) * 1.6;
      const sx = ox + Math.cos(aa) * R * 0.7;
      const sy = oy + Math.sin(aa) * R * 0.7;
      v.capsule(ox, oy, za, sx, sy, za + 6, 1, M_BIRCH, () => 0, false);
      lobe(v, { x: sx, y: sy, z: za + 7, r: 5 + next() * 2 }, next, 2.6, 0.8);
    }
  }
  roots(v, next, spec.radius * 0.5, spec.radius, 6, M_ROOT);
  const ramp = NAT.birch[(next() * NAT.birch.length) | 0]!;
  return { v, blobs, trunkTop: H * 0.6, ramp, form: domeForm(0, 0, H, 0.9) };
}

/** Alder by the water: a dark rounded crown on a short dark trunk. */
function makeAlder(spec: TreeSpec, next: () => number): Made {
  const r = makeOak({ ...spec, crownScale: (spec.crownScale ?? 1) * 0.8 }, next);
  return { ...r, ramp: NAT.alder[0]! };
}

/**
 * Coast redwood: a fluted red trunk with buttresses to the collision radius, bare for half its
 * height, then a narrow spire of flat drooping sprays in uneven tiers.
 */
function makeRedwood(spec: TreeSpec, next: () => number): Made {
  const hs = spec.heightScale ?? 1;
  const giant = spec.radius > 26;
  const trunkR = spec.radius * 0.74;
  const H = (giant ? 250 : 160 + next() * 60) * hs;
  const crownFrom = H * (giant ? 0.46 : 0.42 + next() * 0.1);
  const R = (giant ? 42 : 20 + next() * 8) * (spec.crownScale ?? 1);
  const ext = Math.ceil(Math.max(R * 1.25, spec.radius + 4) + 8);
  const top = Math.ceil(H + 10);
  const v = new Voxels(-ext, -ext, ext * 2, ext * 2, top);
  const flutes = barkRough(spec.seed, giant ? 3.2 : 2, giant ? 6 : 4);
  v.column(
    0,
    H,
    (z) => {
      const t = z / H;
      const flare = t < 0.08 ? (0.08 - t) * (giant ? 70 : 40) : 0;
      return { x: 0, y: 0, r: Math.max(2.2, trunkR * (1 - t * 0.82) + flare) };
    },
    M_BARK,
    flutes,
    (ang, z) => (vnoise(ang * (giant ? 9 : 6), z * 0.05, 1, spec.seed + 1) < 0.34 ? 1 : 0),
  );
  roots(v, next, trunkR, spec.radius, giant ? 10 : 7);
  const blobs: Blob[] = [];
  if ((spec.crownScale ?? 1) < 0.05) {
    // A topped spar: the crown cut off, a few stubs of limbs.
    for (let z = Math.floor(crownFrom); z < H; z++) for (let i = 0; i < v.nx * v.ny; i++) v.mat[z * v.nx * v.ny + i] = 0;
    for (let k = 0; k < 5; k++) {
      const z = crownFrom * (0.5 + next() * 0.45);
      const a = next() * Math.PI * 2;
      v.capsule(0, 0, z, Math.cos(a) * 9, Math.sin(a) * 9, z + 3, 1.4, M_BARK, () => 0, false);
    }
    const ramp = NAT.redwood[0]!;
    return { v, blobs, trunkTop: crownFrom, ramp, form: () => [0, 0, 1] };
  }
  const tiers = Math.round((H - crownFrom) / (giant ? 11 : 10));
  for (let k = 0; k < tiers; k++) {
    const t = k / Math.max(1, tiers - 1);
    const z = crownFrom + (H - crownFrom) * t * 0.94 + (next() - 0.5) * 3;
    const reach = R * Math.pow(1 - t * 0.85, 0.8) * (0.7 + next() * 0.45);
    const sprays = 3 + ((next() * 3) | 0);
    const a0 = next() * Math.PI * 2;
    for (let j = 0; j < sprays; j++) {
      const a = a0 + (j / sprays) * Math.PI * 2 + (next() - 0.5) * 0.8;
      const rr = Math.max(4, reach * 0.36);
      const bx = Math.cos(a) * (reach - rr * 0.6);
      const by = Math.sin(a) * (reach - rr * 0.6);
      // The branch to the spray, then a flat pad that droops at its tip.
      v.capsule(0, 0, z + 2, bx, by, z - 1, 1.3, M_BARK, () => 0, false);
      const b: Blob = { x: bx, y: by, z: z - 2, r: rr };
      lobe(v, b, next, 2.8, 0.42);
      blobs.push(b);
    }
  }
  const tip: Blob = { x: 0, y: 0, z: H - 5, r: 5 };
  lobe(v, tip, next, 2.6, 1.5);
  blobs.push(tip);
  const ramp = NAT.redwood[(next() * NAT.redwood.length) | 0]!;
  return {
    v,
    blobs,
    trunkTop: crownFrom,
    ramp,
    form: (x, y, z) => [x, y, ((z - crownFrom) / (H - crownFrom) - 0.2) * R * 0.9],
  };
}

/**
 * Pine or fir: stacked skirts of needles, widest at the bottom, each a shallow drooping cone
 * cut into branch tips; a fir carries snow on the top of every skirt.
 */
function makeConifer(spec: TreeSpec, next: () => number, fir: boolean): Made {
  const hs = spec.heightScale ?? 1;
  const H = (fir ? 92 + next() * 34 : 104 + next() * 40) * hs;
  const R = ((fir ? 30 : 26) + next() * 8) * (spec.crownScale ?? 1);
  const bare = H * (fir ? 0.16 : 0.26);
  const ext = Math.ceil(R * 1.3 + 8);
  const v = new Voxels(-ext, -ext, ext * 2, ext * 2, Math.ceil(H + 10));
  const trunkR = spec.radius * 0.42;
  v.column(
    0,
    H * 0.95,
    (z) => ({ x: 0, y: 0, r: Math.max(1.4, trunkR * (1 - (z / H) * 0.85)) }),
    M_BARK,
    barkRough(spec.seed, 1.1, 3),
    fissure(spec.seed, 4),
  );
  roots(v, next, trunkR, spec.radius, 5);
  const tiers = fir ? 6 + ((next() * 2) | 0) : 5 + ((next() * 2) | 0);
  const blobs: Blob[] = [];
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const z = bare + (H - bare) * Math.pow(t, 0.92) * 0.88;
    const r = R * (1 - t * 0.84) * (0.88 + next() * 0.24) + 3;
    const jag = spec.seed + k * 13;
    const teeth = 6 + ((next() * 4) | 0);
    const thick = r * 0.32 + 2.5;
    for (let y = Math.floor(-r - 2); y <= r + 2; y++)
      for (let x = Math.floor(-r - 2); x <= r + 2; x++) {
        const d = Math.hypot(x + 0.5, y + 0.5);
        if (d > r * 1.05) continue;
        const ang = Math.atan2(y + 0.5, x + 0.5);
        const phase = ang * teeth * 0.5 + jag;
        const tooth = 0.74 + 0.26 * Math.pow(Math.abs(Math.cos(phase)), 0.6);
        const rr = r * (tooth + (vnoise(ang * 6, k, 1, jag) - 0.5) * 0.14);
        if (d > rr) continue;
        const f = d / rr;
        const surf = z + r * 0.36 * (1 - f) - r * 0.32 * f * f;
        const under = surf - thick * (1 - f * 0.55);
        const nx = (x + 0.5) / (d || 1);
        const ny = (y + 0.5) / (d || 1);
        const slope = 0.25 + f * 0.75;
        // Each branch tip is one cluster of needles with its own tone.
        const branch = Math.floor(phase / Math.PI + 100) & 15;
        for (let zz = Math.ceil(under); zz <= Math.floor(surf); zz++) {
          const top = zz >= surf - 1.5;
          v.put(x, y, zz, M_LEAF, nx * slope, ny * slope, top ? 1 : 0.2, top ? branch : 15);
        }
      }
    blobs.push({ x: 0, y: 0, z, r: r * 0.9 });
  }
  // The leader.
  v.capsule(0, 0, H * 0.88, 0, 0, H + 2, 1.6, M_LEAF, () => 6, false);
  const load = spec.snow ?? 0;
  if (load > 0) {
    for (let z = v.nz - 2; z >= 1; z--)
      for (let iy = 0; iy < v.ny; iy++)
        for (let ix = 0; ix < v.nx; ix++) {
          const x = ix + v.x0;
          const y = iy + v.y0;
          if (v.get(x, y, z) !== M_LEAF || v.get(x, y, z + 1) !== 0) continue;
          const i = v.idx(x, y, z);
          const nz = v.nrm[i * 3 + 2]! / 127;
          const n = vnoise(x * 1.3, y * 1.3 + z * 2, 4, spec.seed + 77);
          const d = Math.hypot(x, y);
          if (nz > 0.86 - load * 0.12 && n < 0.16 + load * 0.36 && d > 2) {
            v.put(x, y, z + 1, M_SNOW, 0, 0, 1, 0);
            if (load > 0.6 && n < 0.12) v.put(x, y, z + 2, M_SNOW, 0, 0, 1, 0);
          }
        }
  }
  const ramp = NAT.pine[(next() * NAT.pine.length) | 0]!;
  return {
    v,
    blobs,
    trunkTop: bare,
    ramp,
    form: (x, y, z) => [x, y, (1 - (z - bare) / (H - bare)) * R * 0.25 + R * 0.35],
  };
}

function hash3(x: number, y: number, z: number, s: number): number {
  let h =
    (Math.imul(x | 0, 0x27d4eb2d) ^
      Math.imul(y | 0, 0x165667b1) ^
      Math.imul(z | 0, 0x1b873593) ^
      Math.imul(s | 0, 0x9e3779b1)) >>>
    0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
void hash3;

/** Builds and draws one tree. `keyY` is the world row of its base, for the depth plane. */
export function buildTree(spec: TreeSpec, keyY = 0): TreeModel {
  const next = rng(spec.seed * 2654435761 + 1);
  let made: Made;
  switch (spec.species) {
    case 'birch':
      made = makeBirch(spec, next);
      break;
    case 'alder':
      made = makeAlder(spec, next);
      break;
    case 'redwood':
      made = makeRedwood(spec, next);
      break;
    case 'pine':
      made = makeConifer(spec, next, false);
      break;
    case 'fir':
      made = makeConifer(spec, next, true);
      break;
    default:
      made = makeOak(spec, next);
  }
  const { v, ramp, form } = made;
  const bark =
    spec.species === 'redwood'
      ? NAT.barkRed
      : spec.species === 'pine' || spec.species === 'fir'
        ? NAT.barkPine
        : NAT.barkOak;
  const hueBias = (fbm(spec.seed, 0, 1, 3) - 0.5) * 0.06;
  const sprite = renderVoxels(
    v,
    (s) => {
      switch (s.mat) {
        case M_LEAF: {
          const [fx, fy, fz] = form(s.x, s.y, s.z);
          const l = Math.hypot(fx, fy, fz) || 1;
          const f = Math.max(0, (fx * SUN.x + fy * SUN.y + fz * SUN.z) / l);
          return leafTone(s, ramp, hueBias, f);
        }
        case M_SNOW:
          return snowTone(s);
        case M_BIRCH: {
          const c = barkTone(s, NAT.barkBirch, false);
          if (s.tag === 1) return mixc(NAT.barkBirch[0]!, NAT.ink, 0.3);
          return c;
        }
        case M_HOLLOW:
          return NAT.ink;
        case M_DEADWOOD:
          return barkTone(s, NAT.barkBirch, s.tag === 1);
        default:
          return barkTone(s, bark, s.tag === 1);
      }
    },
    {
      keyY,
      // Bark is shaded only by what is close to it, so a trunk under a crown keeps its form.
      shadowSteps: (m) => (m === M_LEAF || m === M_SNOW ? 48 : 10),
    },
  );
  let top = 0;
  for (let z = v.nz - 1; z >= 0 && top === 0; z--)
    for (let i = z * v.nx * v.ny; i < (z + 1) * v.nx * v.ny; i++)
      if (v.mat[i] !== 0) {
        top = z;
        break;
      }
  return { sprite, blobs: made.blobs, trunkTop: made.trunkTop, top };
}

export { M_HOLLOW, M_BARK, M_LEAF };
