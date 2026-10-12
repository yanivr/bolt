import { TRACK_LIMITS, segmentDistance } from '@bolt/shared';
import type { TrackRuntime } from '@bolt/shared';
import { distanceField } from './edt.js';

/**
 * Where a car can be on an open track. Off-road ground on an open map is drivable (slow, never
 * an invisible wall), so "drivable" is not the corridor: it is every pixel a car's body can
 * cover, which is every pixel within a car's radius of a point its centre can reach from the
 * road without touching a wall or an obstacle. The same capsules and discs the physics pushes
 * against are rasterized here, at one world pixel, so anything drawn standing on ground a car
 * can reach is known before it is drawn.
 */

export type Reach = {
  w: number;
  h: number;
  /** 1 inside a wall capsule or an obstacle disc (the physics' solids). */
  solid: Uint8Array;
  /** Which solid: wall index + 1, or obstacle index + 1 + walls (0 none). */
  solidId: Int32Array;
  /** 1 where a car's centre can get to from the road. */
  center: Uint8Array;
  /** 1 where any part of a car can be: within `carRadius` of a reachable centre. */
  drive: Uint8Array;
  /** Distance in pixels to the nearest drivable pixel (0 on drivable ground), capped. */
  toDrive: Float32Array;
};

const SOLID_PAD = 0.5;

/** Stamps a capsule or disc, growing it by `grow`, into `mask` (and its id into `ids`). */
function stamp(
  mask: Uint8Array,
  ids: Int32Array | null,
  w: number,
  h: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
  id: number,
): void {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r + 1));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 1));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r + 1));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (segmentDistance(x + 0.5, y + 0.5, ax, ay, bx, by) < r) {
        mask[y * w + x] = 1;
        if (ids && ids[y * w + x] === 0) ids[y * w + x] = id;
      }
}

export function computeReach(track: TrackRuntime): Reach {
  const w = track.def.worldWidth;
  const h = track.def.worldHeight;
  const n = w * h;
  const solid = new Uint8Array(n);
  const solidId = new Int32Array(n);
  const blocked = new Uint8Array(n);
  const car = TRACK_LIMITS.carRadius;
  const d = track.walls.data;
  for (let k = 0; k < track.walls.count; k++) {
    const [ax, ay, bx, by, r] = [d[k * 5]!, d[k * 5 + 1]!, d[k * 5 + 2]!, d[k * 5 + 3]!, d[k * 5 + 4]!];
    const id = track.walls.owner[k]! + 1;
    stamp(solid, solidId, w, h, ax, ay, bx, by, r + SOLID_PAD, id);
    stamp(blocked, null, w, h, ax, ay, bx, by, r + car, 0);
  }
  const walls = track.def.walls.length;
  track.obstacles.forEach((o, k) => {
    stamp(solid, solidId, w, h, o.x, o.y, o.x, o.y, o.radius + SOLID_PAD, walls + k + 1);
    stamp(blocked, null, w, h, o.x, o.y, o.x, o.y, o.radius + car, 0);
  });
  // Flood the free centres from the road.
  const center = new Uint8Array(n);
  const queue = new Int32Array(n);
  let tail = 0;
  for (const b of track.branches) {
    for (let i = 0; i < b.count; i++) {
      const x = Math.floor(b.x[i]!);
      const y = Math.floor(b.y[i]!);
      const p = y * w + x;
      if (x < 0 || y < 0 || x >= w || y >= h || blocked[p] || center[p]) continue;
      center[p] = 1;
      queue[tail++] = p;
    }
  }
  for (let head = 0; head < tail; head++) {
    const p = queue[head]!;
    const x = p % w;
    if (x > 0 && !center[p - 1] && !blocked[p - 1]) {
      center[p - 1] = 1;
      queue[tail++] = p - 1;
    }
    if (x < w - 1 && !center[p + 1] && !blocked[p + 1]) {
      center[p + 1] = 1;
      queue[tail++] = p + 1;
    }
    if (p >= w && !center[p - w] && !blocked[p - w]) {
      center[p - w] = 1;
      queue[tail++] = p - w;
    }
    if (p < n - w && !center[p + w] && !blocked[p + w]) {
      center[p + w] = 1;
      queue[tail++] = p + w;
    }
  }
  const toCenter = distanceField(center, w, h, 600);
  const drive = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (toCenter[i]! <= car + 0.5 && !solid[i]) drive[i] = 1;
  const toDrive = distanceField(drive, w, h, 600);
  return { w, h, solid, solidId, center, drive, toDrive };
}
