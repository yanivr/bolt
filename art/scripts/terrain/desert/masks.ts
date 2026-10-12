import { SURFACE_IDS, segmentDistance } from '@bolt/shared';
import type { SurfaceId, TrackRuntime } from '@bolt/shared';
import type { CorridorField } from '../field.js';
import { ZONE_PAVEMENT, ZONE_SHOULDER } from '../field.js';

/**
 * What the physics says about every world pixel of an open desert track, derived from the
 * same runtime the simulation uses. The desert painters read the world only through these
 * planes, so the picture cannot disagree with the car:
 *
 *  - `solid`: inside a wall capsule or an obstacle disc (what a car collides with).
 *  - `reach`: ground a car can actually get to: not solid and connected to the road. On these
 *    tracks that is the road, its shoulders and all the open sand. Anything raised that is drawn
 *    over a reachable pixel goes to an overlay above the cars; the ground layer may only carry
 *    raised art over unreachable ground (inside solids, or behind the boundary).
 *  - `surf`: the surface `groundAt` returns at the pixel centre (zone grid first, then the
 *    pavement's own surface), and `kind`: pavement, shoulder or off-road.
 *  - `hazard`: the area hazard index + 1 from the zone grid (soft sand, crosswind), 0 for none.
 */

export const SOLID_WALL = 1;
export const SOLID_OBSTACLE = 2;

export const K_OFFROAD = 0;
export const K_PAVEMENT = 1;
export const K_SHOULDER = 2;

export const S_SAND = 0;
export const S_ASPHALT = 1;
export const S_OTHER = 2;

export type Masks = {
  w: number;
  h: number;
  solid: Uint8Array;
  /** Index into `track.walls` owner list + 1 for wall pixels, obstacle index + 1 for obstacles. */
  owner: Int32Array;
  reach: Uint8Array;
  kind: Uint8Array;
  surf: Uint8Array;
  hazard: Uint8Array;
  /** Count of reachable pixels, for reports. */
  reachCount: number;
};

function surfCode(s: SurfaceId): number {
  return s === 'sand' ? S_SAND : s === 'asphalt' ? S_ASPHALT : S_OTHER;
}

export function buildMasks(track: TrackRuntime, field: CorridorField): Masks {
  const { w, h } = field;
  const n = w * h;
  const solid = new Uint8Array(n);
  const owner = new Int32Array(n);
  // Wall capsules, segment by segment over their bounding boxes.
  const d = track.walls.data;
  for (let k = 0; k < track.walls.count; k++) {
    const ax = d[k * 5]!;
    const ay = d[k * 5 + 1]!;
    const bx = d[k * 5 + 2]!;
    const by = d[k * 5 + 3]!;
    const r = d[k * 5 + 4]!;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1));
    const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r + 1));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 1));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r + 1));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (segmentDistance(x + 0.5, y + 0.5, ax, ay, bx, by) <= r) {
          solid[y * w + x] = SOLID_WALL;
          owner[y * w + x] = (track.walls.owner[k] ?? 0) + 1;
        }
      }
  }
  track.obstacles.forEach((o, k) => {
    const r = o.radius;
    for (let y = Math.max(0, Math.floor(o.y - r - 1)); y <= Math.min(h - 1, o.y + r + 1); y++)
      for (let x = Math.max(0, Math.floor(o.x - r - 1)); x <= Math.min(w - 1, o.x + r + 1); x++) {
        if ((x + 0.5 - o.x) ** 2 + (y + 0.5 - o.y) ** 2 <= r * r) {
          solid[y * w + x] = SOLID_OBSTACLE;
          owner[y * w + x] = k + 1;
        }
      }
  });

  // Reachable ground: flood from the drivable corridor through everything that is not solid.
  const reach = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let p = 0; p < n; p++) {
    if (field.edge[p]! <= 0 && !solid[p]) {
      reach[p] = 1;
      queue[tail++] = p;
    }
  }
  while (head < tail) {
    const p = queue[head++]!;
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0 && !reach[p - 1] && !solid[p - 1]) {
      reach[p - 1] = 1;
      queue[tail++] = p - 1;
    }
    if (x < w - 1 && !reach[p + 1] && !solid[p + 1]) {
      reach[p + 1] = 1;
      queue[tail++] = p + 1;
    }
    if (y > 0 && !reach[p - w] && !solid[p - w]) {
      reach[p - w] = 1;
      queue[tail++] = p - w;
    }
    if (y < h - 1 && !reach[p + w] && !solid[p + w]) {
      reach[p + w] = 1;
      queue[tail++] = p + w;
    }
  }

  // Surface exactly as `groundAt` computes it.
  const kind = new Uint8Array(n);
  const surf = new Uint8Array(n);
  const hazard = new Uint8Array(n);
  const off = surfCode(track.def.offroadSurface);
  const branchSurf = track.branches.map((b) => b.surface.map(surfCode));
  const shoulderSurf = track.branches.map((b) => surfCode(b.shoulderSurface));
  const zc = track.zoneCell;
  for (let y = 0; y < h; y++) {
    const zr = Math.floor((y + 0.5) / zc);
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const z = field.zone[p]!;
      let s = off;
      if (z === ZONE_PAVEMENT) {
        kind[p] = K_PAVEMENT;
        s = branchSurf[field.branch[p]!]![field.sample[p]!]!;
      } else if (z === ZONE_SHOULDER) {
        kind[p] = K_SHOULDER;
        s = shoulderSurf[field.branch[p]!]!;
      }
      const zcI = zr * track.zoneCols + Math.floor((x + 0.5) / zc);
      if (track.zoneSurface) {
        const v = track.zoneSurface[zcI]!;
        if (v > 0) s = surfCode(SURFACE_IDS[v - 1]!);
      }
      if (track.zoneHazard) hazard[p] = track.zoneHazard[zcI]!;
      surf[p] = s;
    }
  }
  let reachCount = 0;
  for (let p = 0; p < n; p++) reachCount += reach[p]!;
  return { w, h, solid, owner, reach, kind, surf, hazard, reachCount };
}

/**
 * Distance, in pixels, from every pixel to the nearest pixel where `src` is set (two-pass
 * chamfer, 3-4 weights divided by 3). Cheap and good enough for falloffs and margins.
 */
export function distanceTo(w: number, h: number, src: (p: number) => boolean): Float32Array {
  const INF = 1e9;
  const dist = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) dist[p] = src(p) ? 0 : INF;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let v = dist[p]!;
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, dist[p - 1]! + 3);
      if (y > 0) {
        v = Math.min(v, dist[p - w]! + 3);
        if (x > 0) v = Math.min(v, dist[p - w - 1]! + 4);
        if (x < w - 1) v = Math.min(v, dist[p - w + 1]! + 4);
      }
      dist[p] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      let v = dist[p]!;
      if (v === 0) continue;
      if (x < w - 1) v = Math.min(v, dist[p + 1]! + 3);
      if (y < h - 1) {
        v = Math.min(v, dist[p + w]! + 3);
        if (x < w - 1) v = Math.min(v, dist[p + w + 1]! + 4);
        if (x > 0) v = Math.min(v, dist[p + w - 1]! + 4);
      }
      dist[p] = v;
    }
  for (let p = 0; p < w * h; p++) dist[p] = dist[p]! / 3;
  return dist;
}
