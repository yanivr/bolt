import { hash2 } from '@bolt/shared';
import type { Color } from '../canvas.js';
import { F_EMISSIVE } from '../canvas.js';
import { vnoise } from './noise.js';
import { NAT, darken, lighten } from './palette.js';
import { Voxels, band, renderVoxels } from './voxel.js';
import type { Shading, VoxelSprite } from './voxel.js';

/**
 * Buildings and machines for the nature biomes, modelled as voxels so they share the view and
 * the light of the trees: a mill house with its waterwheel, a bridge portal, a treehouse, a
 * sawmill, a crane, a log cabin, a lookout tower, snow guns and lift pylons. Materials are
 * shaded from fixed ramps and textured from the voxel position (boards, courses, shingles).
 */

export const MAT = {
  stone: 1,
  boards: 2,
  shingle: 3,
  beam: 4,
  window: 5,
  metal: 6,
  door: 7,
  wheel: 8,
  foam: 9,
  snow: 10,
  red: 11,
  yellow: 12,
  logs: 13,
  dark: 14,
  glass: 15,
  rust: 16,
  orange: 17,
  roofTin: 18,
  lamp: 19,
  white: 20,
} as const;

const S5 = [0.22, 0.42, 0.62, 0.82];

function ramp5(c: Color): Color[] {
  return [darken(c, 0.55), darken(c, 0.3), c, lighten(c, 0.18), lighten(c, 0.36)];
}

const RAMPS: Record<number, Color[]> = {
  [MAT.stone]: [NAT.stoneDeep, NAT.stoneDark, NAT.stone, NAT.stoneLight, NAT.stoneHi],
  [MAT.boards]: [NAT.woodDeep, NAT.woodDark, NAT.wood, NAT.woodLight, NAT.woodHi],
  [MAT.shingle]: [NAT.roofSlateDark, darken(NAT.roofSlate, 0.15), NAT.roofSlate, NAT.roofSlateLight, lighten(NAT.roofSlateLight, 0.2)],
  [MAT.beam]: [NAT.woodDeep, NAT.woodDeep, NAT.woodDark, NAT.wood, NAT.woodLight],
  [MAT.metal]: [NAT.steelDark, NAT.steelDark, NAT.steel, NAT.steelLight, NAT.steelHi],
  [MAT.door]: [NAT.woodDeep, NAT.woodDeep, NAT.woodDark, NAT.wood, NAT.wood],
  [MAT.wheel]: [NAT.woodDeep, NAT.woodDark, NAT.wood, NAT.woodLight, NAT.woodHi],
  [MAT.red]: ramp5(NAT.red),
  [MAT.yellow]: ramp5(NAT.yellow),
  [MAT.orange]: ramp5(NAT.orange),
  [MAT.logs]: [NAT.barkOak[0]!, NAT.barkOak[1]!, NAT.barkOak[2]!, NAT.barkOak[3]!, NAT.barkOak[4]!],
  [MAT.dark]: [NAT.ink, NAT.ink, NAT.woodDeep, NAT.woodDeep, NAT.woodDark],
  [MAT.rust]: ramp5(NAT.rust),
  [MAT.roofTin]: ramp5(0x6e7a80),
  [MAT.white]: ramp5(0xd8d8d0),
  [MAT.snow]: [0x8e9ac4, 0xaab6da, 0xc8d4ec, 0xe2eaf6, 0xf6f9fd],
};

export type Look = {
  /** Per material, an override ramp. */
  ramps?: Partial<Record<number, Color[]>>;
  /** Snow cover on upward faces, 0 to 1. */
  snow?: number;
  /** Lit windows (warm glow) instead of dark glass. */
  litWindows?: boolean;
};

export function shadeStructure(s: Shading, look: Look): Color | null {
  if (s.mat === MAT.foam) return s.lambert > 0.3 ? NAT.waterSpark : NAT.foam;
  if (s.mat === MAT.window) {
    if (look.litWindows) return s.tag === 1 ? NAT.windowMid : NAT.windowWarm;
    return s.tag === 1 ? NAT.woodDeep : NAT.windowDim;
  }
  if (s.mat === MAT.lamp) return s.tag === 1 ? NAT.red : 0xffe08a;
  if (s.mat === MAT.glass) return s.lambert > 0.5 ? 0x9cc4d4 : 0x4e7088;
  const r = look.ramps?.[s.mat] ?? RAMPS[s.mat] ?? RAMPS[MAT.boards]!;
  // Faces the camera sees from the south take sky light even out of the sun.
  let v = 0.2 + s.lambert * 0.8 + (s.ny > 0.5 ? 0.16 : 0);
  if (s.shadowed) v = v * 0.55;
  let k = band(v, S5);
  // Texture from position.
  if (s.mat === MAT.boards && s.tag === 1) k -= 1;
  if (s.mat === MAT.stone && s.tag === 1) k -= 1;
  if (s.mat === MAT.shingle && s.tag === 1) k -= 1;
  if (s.mat === MAT.logs && s.tag === 1) k = Math.max(k, 3);
  if (s.crease) k -= 1;
  if (s.rim) k = Math.min(k, 1);
  if ((look.snow ?? 0) > 0 && s.nz > 0.55 && s.mat !== MAT.window) {
    const sr = RAMPS[MAT.snow]!;
    if (vnoise(s.x, s.y, 3, 5) < 0.3 + (look.snow ?? 0) * 0.7) return sr[Math.max(1, Math.min(4, band(v, S5) + 1))]!;
  }
  return r[Math.max(0, Math.min(r.length - 1, k))]!;
}

/** Board texture tag: vertical boards on walls, a dark joint every few voxels. */
const boardsX = (every: number) => (x: number, y: number, z: number): number =>
  ((x + 400) % every === 0 || (y + 400) % every === 0) && z % 9 !== 0 ? 1 : 0;
const courses = (x: number, y: number, z: number): number =>
  z % 4 === 0 || (((x + y + (Math.floor(z / 4) % 2) * 3) % 7) === 0) ? 1 : 0;
const shingles = (x: number, y: number, z: number): number =>
  (z + (x & 1)) % 3 === 0 || hash2(x >> 2, z, 9) < 0.08 ? 1 : 0;

/** Windows and a door cut into the south face of a box. */
function southOpenings(
  v: Voxels,
  x0: number,
  x1: number,
  y1: number,
  z0: number,
  z1: number,
  windows: number,
  door: boolean,
): void {
  const span = x1 - x0;
  for (let k = 0; k < windows; k++) {
    const cx = Math.round(x0 + ((k + 1) / (windows + 1)) * span);
    const wz = z0 + Math.round((z1 - z0) * 0.4);
    for (let z = wz; z < wz + 7; z++)
      for (let x = cx - 3; x <= cx + 3; x++) {
        const frame = x === cx - 3 || x === cx + 3 || z === wz || z === wz + 6 || x === cx;
        v.put(x, y1 - 1, z, MAT.window, 0, 1, 0, frame ? 1 : 0);
      }
  }
  if (door) {
    const dx = Math.round(x0 + span * 0.78);
    for (let z = z0; z < z0 + 12; z++) for (let x = dx - 3; x <= dx + 3; x++) v.put(x, y1 - 1, z, MAT.door, 0, 1, 0, x === dx ? 1 : 0);
  }
}

/**
 * Mill house: a stone ground floor rising from the water, whitewashed timber framing above,
 * a mossy slate roof with a chimney, small-paned windows facing the camera.
 */
export function millHouse(w: number, d: number, keyY: number): VoxelSprite {
  const v = new Voxels(-4, -4, w + 10, d + 10, 82);
  v.box(0, 0, 0, w, d, 15, MAT.stone, courses);
  v.box(0, 0, 15, w, d, 44, MAT.white, (x, y, z) => (z % 7 === 0 ? 1 : 0));
  // Timber frame: posts every 14, a sill, a girt and the eaves beam.
  for (let x = 0; x < w; x += 14) v.box(x, d - 1, 15, x + 2, d, 44, MAT.beam);
  v.box(w - 2, d - 1, 15, w, d, 44, MAT.beam);
  for (const z of [15, 29, 42]) v.box(0, d - 1, z, w, d, z + 2, MAT.beam);
  for (let y = 0; y < d; y += 12) v.box(0, y, 15, 1, y + 2, 44, MAT.beam);
  southOpenings(v, 0, w, d, 30, 42, 4, false);
  southOpenings(v, 0, w, d, 15, 29, 3, false);
  // The loading door, high up, and the stone stair down to the boardwalk.
  for (let z = 17; z < 28; z++) for (let x = 6; x < 13; x++) v.put(x, d - 1, z, MAT.door, 0, 1, 0, x === 9 ? 1 : 0);
  v.gable(-4, -4, w + 4, d + 4, 44, 22, true, MAT.shingle, shingles);
  v.box(w - 18, Math.floor(d / 2) - 3, 44, w - 11, Math.floor(d / 2) + 4, 74, MAT.stone, courses);
  const moss = [NAT.mossDeep, NAT.roofMoss, NAT.mossLight, NAT.mossHi, NAT.mossHi];
  return renderVoxels(
    v,
    (s) => {
      if (s.mat === MAT.shingle && vnoise(s.x, s.y + s.z, 6, 31) > 0.66) {
        const k = Math.max(0, Math.min(4, Math.round(s.lambert * 4 - (s.shadowed ? 2 : 0))));
        return moss[k]!;
      }
      return shadeStructure(s, { ramps: { [MAT.white]: [0x6e6a64, 0x9a968c, 0xc6c0b2, 0xe0dacb, 0xf0ebdd] } });
    },
    { keyY, creaseDepth: 2 },
  );
}

/** A small rowboat, moored. */
export function rowboat(len: number, keyY: number): VoxelSprite {
  const v = new Voxels(-len / 2 - 2, -6, len + 4, 12, 8);
  v.ellipsoid(0, 0, 3, len / 2, 5, 4, MAT.boards, { tag: 0 });
  for (let z = 3; z < 8; z++) for (let y = -6; y < 6; y++) for (let x = -len / 2; x < len / 2; x++) {
    if (v.get(x, y, z) === 0) continue;
    const inner = Math.hypot((x + 0.5) / (len / 2 - 1.6), (y + 0.5) / 3.4) < 1;
    if (inner) v.put(x, y, Math.min(z, 4), MAT.beam, 0, 0, 1, 0);
    if (inner && z > 4) v.clear(x, y, z);
  }
  for (const x of [-3, 3]) v.box(x, -3, 4, x + 2, 4, 5, MAT.boards, () => 1);
  return renderVoxels(v, (s) => shadeStructure(s, { ramps: { [MAT.boards]: [0x2e2a2c, 0x4a3a32, 0x7a4a36, 0x9a5e40, 0xb4764e] } }), { keyY, creaseDepth: 2 });
}

/**
 * Undershot waterwheel, axle running north and south, so its face is toward the camera.
 * `phase` from 0 to 1 turns it by one paddle spacing (a seamless loop).
 */
export function waterWheel(radius: number, width: number, phase: number, keyY: number): VoxelSprite {
  const R = radius;
  const v = new Voxels(-R - 3, -2, R * 2 + 6, width + 4, R * 2 + 6);
  const cz = R + 1;
  const paddles = 12;
  const rot = (phase * Math.PI * 2) / paddles;
  // Rims: two rings at the faces.
  for (const y of [0, width - 1])
    for (let a = 0; a < 96; a++) {
      const t = (a / 96) * Math.PI * 2;
      const t2 = ((a + 1) / 96) * Math.PI * 2;
      v.capsule(Math.cos(t) * (R - 2), y, cz + Math.sin(t) * (R - 2), Math.cos(t2) * (R - 2), y, cz + Math.sin(t2) * (R - 2), 1.3, MAT.wheel);
    }
  for (let k = 0; k < paddles; k++) {
    const t = rot + (k / paddles) * Math.PI * 2;
    // Spokes on the near face.
    if (k % 2 === 0) v.capsule(0, width - 1, cz, Math.cos(t) * (R - 2), width - 1, cz + Math.sin(t) * (R - 2), 1, MAT.beam);
    // Paddle boards across the rims.
    const px = Math.cos(t) * (R - 1);
    const pz = cz + Math.sin(t) * (R - 1);
    v.capsule(px, 0, pz, px, width - 1, pz, 1.4, MAT.boards, () => 0);
    v.capsule(px * 0.86, 0, cz + (pz - cz) * 0.86, px * 0.86, width - 1, cz + (pz - cz) * 0.86, 1.2, MAT.boards, () => 1);
  }
  v.capsule(0, -1, cz, 0, width + 1, cz, 2.2, MAT.metal);
  // Foam where the paddles meet the water.
  for (let x = -R + 2; x < R - 2; x++)
    for (let y = -1; y < width + 2; y++) if (hash2(x, y, Math.floor(phase * 8)) < 0.45) v.put(x, y, 1, MAT.foam, 0, 0, 1);
  return renderVoxels(v, (s) => shadeStructure(s, {}), { keyY, creaseDepth: 2 });
}

/**
 * Timber portal over a road running east and west: two posts standing on the bridge rails at
 * `yN` and `yS` (relative to the anchor), a beam across with a name board under it.
 */
export function bridgePortal(yN: number, yS: number, height: number, keyY: number): VoxelSprite {
  const v = new Voxels(-6, yN - 6, 14, yS - yN + 12, height + 10);
  for (const y of [yN, yS]) {
    v.box(-2, y - 2, 0, 3, y + 3, height, MAT.beam, (x, yy, z) => (z % 12 === 0 ? 1 : 0));
    // Knee braces.
    const dir = y === yN ? 1 : -1;
    for (let t = 0; t < 10; t++) v.box(-1, y + dir * t, height - 10 + t, 2, y + dir * t + 1, height - 9 + t, MAT.beam);
  }
  v.box(-3, yN - 4, height, 4, yS + 5, height + 5, MAT.boards, (x, y) => ((y + 400) % 6 === 0 ? 1 : 0));
  v.box(-3, yN - 4, height + 5, 4, yS + 5, height + 6, MAT.shingle);
  return renderVoxels(v, (s) => shadeStructure(s, {}), { keyY, creaseDepth: 2 });
}

/** A ranger's lookout hut on a platform among the branches, with a ladder down the trunk. */
export function treehouse(platformZ: number, trunkR: number, keyY: number): VoxelSprite {
  const W = 26;
  const D = 20;
  const v = new Voxels(-W / 2 - 4, -D / 2 - 6, W + 8, D + 14, platformZ + 40);
  // Platform with a rail.
  v.box(-W / 2 - 2, -D / 2 - 2, platformZ, W / 2 + 2, D / 2 + 4, platformZ + 2, MAT.boards, (x) => ((x + 400) % 3 === 0 ? 1 : 0));
  for (let x = -W / 2 - 2; x < W / 2 + 2; x += 4) v.box(x, D / 2 + 3, platformZ + 2, x + 1, D / 2 + 4, platformZ + 8, MAT.beam);
  v.box(-W / 2 - 2, D / 2 + 3, platformZ + 7, W / 2 + 2, D / 2 + 4, platformZ + 8, MAT.beam);
  // Hut.
  v.box(-W / 2 + 2, -D / 2, platformZ + 2, W / 2 - 2, D / 2 - 2, platformZ + 18, MAT.boards, boardsX(3));
  southOpenings(v, -W / 2 + 2, W / 2 - 2, D / 2 - 2, platformZ + 2, platformZ + 18, 1, true);
  v.gable(-W / 2, -D / 2 - 2, W / 2, D / 2, platformZ + 18, 9, true, MAT.shingle, shingles);
  // Ladder down the south side of the trunk.
  for (const x of [-3, 3]) v.box(x, trunkR, 0, x + 1, trunkR + 1, platformZ, MAT.beam);
  for (let z = 3; z < platformZ; z += 4) v.box(-3, trunkR, z, 4, trunkR + 1, z + 1, MAT.boards);
  return renderVoxels(v, (s) => shadeStructure(s, {}), { keyY, creaseDepth: 2 });
}

/**
 * Fire lookout: a timber cab with windows all round on four thin trestle legs. The legs are
 * thin furniture (like a sign's posts), not colliders; the cab is above car height.
 */
export function lookoutTower(height: number, keyY: number): VoxelSprite {
  const B = 22;
  const T = 14;
  const cab = 16;
  const v = new Voxels(-B / 2 - 4, -B / 2 - 4, B + 8, B + 8, height + cab + 14);
  const leg = (sx: number, sy: number): void => {
    for (let z = 0; z < height; z++) {
      const f = z / height;
      const hw = B / 2 + (T / 2 - B / 2) * f;
      v.put(Math.round(sx * hw), Math.round(sy * hw), z, MAT.beam, sx, sy, 0);
    }
  };
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) leg(sx, sy);
  // Cross bracing on the faces, every storey.
  for (let z0 = 0; z0 < height - 4; z0 += 14)
    for (let t = 0; t < 14; t++) {
      const z = z0 + t;
      const f = z / height;
      const hw = Math.round(B / 2 + (T / 2 - B / 2) * f);
      const u = Math.round(-hw + (2 * hw * t) / 14);
      v.put(u, hw, z, MAT.beam, 0, 1, 0);
      v.put(-u, hw, z, MAT.beam, 0, 1, 0);
      v.put(-hw, u, z, MAT.beam, -1, 0, 0);
    }
  const h0 = height;
  v.box(-cab / 2 - 2, -cab / 2 - 2, h0, cab / 2 + 2, cab / 2 + 2, h0 + 2, MAT.boards);
  v.box(-cab / 2, -cab / 2, h0 + 2, cab / 2, cab / 2, h0 + cab - 4, MAT.boards, (x, y, z) =>
    z > h0 + 5 && z < h0 + cab - 6 && (x + 400) % 4 !== 0 && (y + 400) % 4 !== 0 ? 2 : 0,
  );
  // Windows: the tagged band.
  for (let z = h0 + 6; z < h0 + cab - 6; z++)
    for (let x = -cab / 2 + 1; x < cab / 2 - 1; x++) {
      if ((x + 400) % 4 === 0) continue;
      v.put(x, cab / 2 - 1, z, MAT.window, 0, 1, 0, 0);
      v.put(-cab / 2, x, z, MAT.window, -1, 0, 0, 0);
    }
  // Hipped roof.
  for (let k = 0; k < 8; k++) v.box(-cab / 2 - 3 + k, -cab / 2 - 3 + k, h0 + cab - 4 + k, cab / 2 + 3 - k, cab / 2 + 3 - k, h0 + cab - 3 + k, MAT.shingle, shingles);
  return renderVoxels(v, (s) => shadeStructure(s, {}), { keyY, creaseDepth: 2 });
}

/** The rigging at the top of a high-lead spar: a block, a guy ring and a pulley. */
export function sparTop(top: number, keyY: number): VoxelSprite {
  const v = new Voxels(-8, -8, 16, 16, top + 10);
  for (let a = 0; a < 24; a++) {
    const t = (a / 24) * Math.PI * 2;
    v.put(Math.round(Math.cos(t) * 5), Math.round(Math.sin(t) * 5), top - 4, MAT.metal, Math.cos(t), Math.sin(t), 0);
  }
  v.box(2, 3, top - 12, 6, 6, top - 5, MAT.metal);
  v.box(3, 5, top - 16, 5, 7, top - 12, MAT.dark);
  return renderVoxels(v, (s) => shadeStructure(s, {}), { keyY, creaseDepth: 2 });
}

export { F_EMISSIVE };

/** A snow-making gun: a fan barrel on a post, painted yellow, a lamp on top. */
export function snowGun(postH: number, facing: number, keyY: number): VoxelSprite {
  const v = new Voxels(-14, -14, 28, 28, postH + 16);
  v.box(-1, -1, 0, 1, 1, postH, MAT.metal);
  // Barrel: a short fat cylinder aimed across the road.
  const fx = Math.cos(facing);
  const fy = Math.sin(facing);
  v.capsule(-fx * 6, -fy * 6, postH + 4, fx * 6, fy * 6, postH + 7, 6, MAT.yellow);
  v.capsule(fx * 6, fy * 6, postH + 7, fx * 8, fy * 8, postH + 7.5, 4.6, MAT.dark);
  // A tripod foot.
  for (const a of [0.4, 2.5, 4.6]) v.capsule(0, 0, 8, Math.cos(a) * 7, Math.sin(a) * 4, 0, 0.8, MAT.metal);
  v.box(-1, -1, postH + 10, 1, 1, postH + 12, MAT.lamp, () => 1);
  return renderVoxels(v, (s) => shadeStructure(s, { snow: 0.4 }), { keyY, creaseDepth: 2 });
}

/** Orange plow marker pole with black bands. Thin furniture. */
export function markerPole(h: number, keyY: number): VoxelSprite {
  const v = new Voxels(-2, -2, 4, 4, h + 2);
  for (let z = 0; z < h; z++) v.put(0, 0, z, z % 10 < 2 ? MAT.dark : MAT.orange, -0.6, 0.6, 0.2);
  return renderVoxels(v, (s) => shadeStructure(s, {}), { keyY });
}

/** A log warming hut with lit windows, sized to stand on a snow bank's footprint. */
export function warmingHut(w: number, d: number, keyY: number): VoxelSprite {
  const v = new Voxels(-4, -4, w + 8, d + 8, 48);
  v.box(0, 0, 0, w, d, 18, MAT.logs, (_x, _y, z) => (z % 3 === 0 ? 1 : 0));
  southOpenings(v, 0, w, d, 2, 16, 2, true);
  v.gable(-3, -3, w + 3, d + 3, 18, 10, true, MAT.shingle, shingles);
  v.box(w - 9, 2, 18, w - 5, 6, 34, MAT.stone, courses);
  return renderVoxels(v, (s) => shadeStructure(s, { snow: 0.9, litWindows: true }), { keyY, creaseDepth: 2 });
}

/** A relay mast: a tapering lattice with dish antennas and a red light. Thin furniture. */
export function relayMast(height: number, keyY: number): VoxelSprite {
  const v = new Voxels(-12, -12, 24, 24, height + 6);
  for (let z = 0; z < height; z++) {
    const hw = Math.round(6 - (z / height) * 4);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) v.put(sx * hw, sy * hw, z, MAT.red, sx, sy, 0);
    if (z % 8 < 1) for (let t = -hw; t <= hw; t++) v.put(t, hw, z, MAT.white, 0, 1, 0);
    if (z % 8 === 4) for (let t = -hw; t <= hw; t++) v.put(t, hw, z, MAT.red, 0, 1, 0);
  }
  for (const [z, a] of [[height * 0.6, 0.8], [height * 0.78, -2.2]] as const) {
    const cx = Math.cos(a) * 6;
    const cy = Math.sin(a) * 6;
    v.ellipsoid(cx, cy, z, 5, 5, 5, MAT.white, { bend: { x: Math.cos(a), y: Math.sin(a), z: 0, k: 0.7 } });
  }
  v.box(-1, -1, height, 1, 1, height + 2, MAT.lamp, () => 1);
  return renderVoxels(v, (s) => shadeStructure(s, { snow: 0.3 }), { keyY, creaseDepth: 2 });
}

/** A chairlift pylon: a steel column and a cross arm carrying two sheaves. Thin furniture. */
export function liftPylon(height: number, keyY: number): VoxelSprite {
  const v = new Voxels(-18, -6, 36, 12, height + 8);
  v.box(-1, -1, 0, 2, 2, height, MAT.metal);
  v.box(-14, -1, height, 15, 2, height + 2, MAT.metal);
  for (const x of [-12, 12]) v.box(x - 1, -2, height - 3, x + 2, 3, height, MAT.dark);
  return renderVoxels(v, (s) => shadeStructure(s, { snow: 0.5 }), { keyY, creaseDepth: 2 });
}
