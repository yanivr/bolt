import { SURFACE_IDS } from '@bolt/shared';
import type { SurfaceId } from '@bolt/shared';
import type { BakeContext } from '../biome.js';
import { ZONE_PAVEMENT, ZONE_SHOULDER } from '../field.js';
import { distanceField } from './edt.js';
import { computeReach } from './reach.js';
import type { Reach } from './reach.js';

/**
 * Per-pixel facts an open-track painter needs, all derived from the runtime the physics uses:
 * which part of the road a pixel is (pavement, shoulder, off-road), the surface the physics
 * reads there (zones included, on their own 8 px grid), the area hazard, where a car can be,
 * and how far each pixel is from the road.
 */

export const K_OFF = 0;
export const K_PAVE = 1;
export const K_SHOULDER = 2;

export type NatureMaps = {
  w: number;
  h: number;
  /** K_OFF, K_PAVE or K_SHOULDER. */
  kind: Uint8Array;
  /** Index into SURFACE_IDS of the surface the physics reads at the pixel's centre. */
  surf: Uint8Array;
  /** Area hazard index + 1 (into `track.hazards`), 0 for none. */
  hazard: Uint8Array;
  reach: Reach;
  /** Distance to the nearest corridor pixel (pavement or shoulder), 0 inside, capped at 600. */
  roadDist: Float32Array;
  /** 1 on water a biome painted (pond, creek); set by the biome before ground painting. */
  water: Uint8Array;
};

export const surfIndex = (s: SurfaceId): number => SURFACE_IDS.indexOf(s);

export function buildMaps(ctx: BakeContext): NatureMaps {
  const { field, track, def } = ctx;
  const { w, h } = field;
  const n = w * h;
  const kind = new Uint8Array(n);
  const surf = new Uint8Array(n);
  const hazard = new Uint8Array(n);
  const corridor = new Uint8Array(n);
  const off = surfIndex(def.offroadSurface);
  const branchSurf = field.surfaces.map(surfIndex);
  const shoulderSurf = track.branches.map((b) => surfIndex(b.shoulderSurface));
  const zc = track.zoneCell;
  for (let y = 0; y < h; y++) {
    const zr = Math.floor((y + 0.5) / zc);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const z = field.zone[i]!;
      let s = off;
      if (z === ZONE_PAVEMENT) {
        kind[i] = K_PAVE;
        s = branchSurf[field.surface[i]!]!;
        corridor[i] = 1;
      } else if (z === ZONE_SHOULDER) {
        kind[i] = K_SHOULDER;
        s = shoulderSurf[field.branch[i]!]!;
        corridor[i] = 1;
      }
      const cell = zr * track.zoneCols + Math.floor((x + 0.5) / zc);
      if (track.zoneSurface) {
        const v = track.zoneSurface[cell]!;
        if (v > 0) s = v - 1;
      }
      if (track.zoneHazard) hazard[i] = track.zoneHazard[cell]!;
      surf[i] = s;
    }
  }
  return {
    w,
    h,
    kind,
    surf,
    hazard,
    reach: computeReach(track),
    roadDist: distanceField(corridor, w, h, 600),
    water: new Uint8Array(n),
  };
}
