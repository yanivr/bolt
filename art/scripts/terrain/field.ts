import { TRACK_SAMPLE_SPACING, createLocation, locate } from '@bolt/shared';
import type { SurfaceId, TrackBranch, TrackRuntime } from '@bolt/shared';

/**
 * The corridor field: everything the painters need to know about the track at every world
 * pixel, sampled once at pixel centers through the same `locate()` the physics uses. Because
 * the picture is derived from these arrays, the visible solid edge is the collision edge.
 */

export const ZONE_OUTSIDE = 0;
export const ZONE_PAVEMENT = 1;
export const ZONE_SHOULDER = 2;

/** Edge distance stored for pixels too far from any corridor to matter. */
export const FAR = 999;

export type CorridorField = {
  w: number;
  h: number;
  track: TrackRuntime;
  /** Distance past the solid edge; negative inside the drivable corridor. */
  edge: Float32Array;
  /** Signed offset from the centerline, positive to the right of travel. */
  lateral: Float32Array;
  /** Arc length along the owning branch. */
  s: Float32Array;
  /** Paved half width at the nearest centerline point. */
  half: Float32Array;
  branch: Uint8Array;
  sample: Uint16Array;
  zone: Uint8Array;
  /** Index into `surfaces` for pavement pixels. */
  surface: Uint8Array;
  surfaces: SurfaceId[];
  /** Per branch: curvature smoothed over a car length, for kerbs and the racing line. */
  smoothCurvature: Float32Array[];
};

function smooth(branch: TrackBranch, radius: number): Float32Array {
  const out = new Float32Array(branch.count);
  for (let i = 0; i < branch.count; i++) {
    let sum = 0;
    let weight = 0;
    for (let k = -radius; k <= radius; k++) {
      let j = i + k;
      if (branch.closed) j = ((j % branch.count) + branch.count) % branch.count;
      else if (j < 0 || j >= branch.count) continue;
      const wgt = radius + 1 - Math.abs(k);
      sum += branch.curvature[j]! * wgt;
      weight += wgt;
    }
    out[i] = weight > 0 ? sum / weight : 0;
  }
  return out;
}

/** How far past the road edge an open track's field is sampled, in world pixels. */
export const OPEN_FIELD_REACH = 480;

function farCells(track: TrackRuntime, cell: number): Uint8Array {
  const out = new Uint8Array(track.gridCols * track.gridRows);
  const half = (cell * Math.SQRT2) / 2;
  for (let r = 0; r < track.gridRows; r++)
    for (let c = 0; c < track.gridCols; c++) {
      const cx = (c + 0.5) * cell;
      const cy = (r + 0.5) * cell;
      let nearest = Infinity;
      for (const code of track.grid[r * track.gridCols + c] ?? []) {
        const b = track.branches[code >> 20]!;
        const i = code & 0xfffff;
        const d =
          Math.hypot(b.x[i]! - cx, b.y[i]! - cy) -
          b.halfWidth[i]! -
          b.shoulder[i]! -
          TRACK_SAMPLE_SPACING;
        nearest = Math.min(nearest, d);
      }
      if (nearest - half > OPEN_FIELD_REACH) out[r * track.gridCols + c] = 1;
    }
  return out;
}

export function buildCorridorField(track: TrackRuntime): CorridorField {
  const w = track.def.worldWidth;
  const h = track.def.worldHeight;
  const n = w * h;
  const edge = new Float32Array(n).fill(FAR);
  const lateral = new Float32Array(n);
  const s = new Float32Array(n);
  const half = new Float32Array(n);
  const branch = new Uint8Array(n);
  const sample = new Uint16Array(n);
  const zone = new Uint8Array(n);
  const surface = new Uint8Array(n);
  const surfaces: SurfaceId[] = [];
  const surfaceIndex = (id: SurfaceId): number => {
    let k = surfaces.indexOf(id);
    if (k < 0) {
      surfaces.push(id);
      k = surfaces.length - 1;
    }
    return k;
  };
  const branchSurface = track.branches.map((b) => Uint8Array.from(b.surface.map(surfaceIndex)));
  const loc = createLocation();
  const cell = 96;
  // On an open track every cell lists segments (so the physics can locate a car anywhere), and
  // sampling every pixel of a large map would take minutes: cells whose nearest corridor edge
  // is surely further than `OPEN_FIELD_REACH` are left at `FAR`. Walled tracks are unchanged.
  const far = track.walled ? null : farCells(track, cell);
  for (let y = 0; y < h; y++) {
    const r = Math.floor(y / cell);
    for (let x = 0; x < w; x++) {
      const bucket = track.grid[r * track.gridCols + Math.floor(x / cell)];
      if (!bucket || bucket.length === 0) continue;
      if (far && far[r * track.gridCols + Math.floor(x / cell)]) continue;
      locate(track, x + 0.5, y + 0.5, loc);
      const i = y * w + x;
      edge[i] = loc.edge;
      lateral[i] = loc.lateral;
      s[i] = loc.s;
      half[i] = loc.halfWidth;
      branch[i] = loc.branch;
      sample[i] = loc.index;
      if (loc.edge <= 0) {
        const dist = loc.edge + loc.halfWidth + loc.shoulder;
        if (dist <= loc.halfWidth) {
          zone[i] = ZONE_PAVEMENT;
          surface[i] = branchSurface[loc.branch]![loc.index]!;
        } else {
          zone[i] = ZONE_SHOULDER;
        }
      }
    }
  }
  return {
    w,
    h,
    track,
    edge,
    lateral,
    s,
    half,
    branch,
    sample,
    zone,
    surface,
    surfaces,
    smoothCurvature: track.branches.map((b) => smooth(b, 6)),
  };
}
