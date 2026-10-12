import { sampleBranch } from '@bolt/shared';
import type { CornerSign, TrackAnchor, TrackRuntime } from '@bolt/shared';
import type { AnimatedArt, BakeContext, PreviewCarSpot, PreviewSpot } from '../biome.js';
import type { Masks } from './masks.js';
import type { Look } from './palette.js';
import type { Sprite } from './props.js';
import { chevronBoard } from './props.js';
import type { RoadInfo } from './road.js';
import type { TerrainSpec } from './spec.js';
import type { Stage } from './stage.js';
import { FG_SIGN } from './stage.js';

/** What a track's dresser gets, and what it hands back to the desert painter. */
export type Env = {
  ctx: BakeContext;
  track: TrackRuntime;
  masks: Masks;
  stage: Stage;
  look: Look;
  spec: TerrainSpec;
  info: RoadInfo;
};

export type Placement = {
  sp: Sprite;
  /** Ground point the sprite stands on. */
  gx: number;
  gy: number;
  kind: number;
  /** Casts a shadow on the ground. */
  shadow?: boolean;
  /** Rows of the sprite counted from its foot that cast no shadow (a board's open legs). */
  shadowFrom?: number;
  forceFg?: boolean;
};

export type Dressing = {
  placements: Placement[];
  anims: AnimatedArt[];
  /** Painters that run after the masses, in order (structures drawn pixel by pixel). */
  draws: Array<() => void>;
  previewSpots: PreviewSpot[];
  previewCars: PreviewCarSpot[];
  /** Counts of the authored props, for the report. */
  props: Record<string, number>;
};

export function anchor(ctx: BakeContext, id: string): TrackAnchor {
  const a = ctx.def.anchors.find((x) => x.id === id);
  if (!a) throw new Error(`${ctx.def.id} has no anchor ${id}`);
  return a;
}

/**
 * Chevron boards at the runtime's corner signs, a little outside the edge they are given on, so
 * a car on the shoulder does not run through the posts. The chevrons point the way the road
 * goes on screen.
 */
export function cornerBoards(track: TrackRuntime, out: Dressing): void {
  for (const s of track.cornerSigns) {
    const b = track.branches[s.branch]!;
    const p = sampleBranch(b, s.signS);
    const side = s.turn === 'left' ? 1 : -1; // outside of the bend
    const nx = -p.ty * side;
    const ny = p.tx * side;
    const off = 12;
    const gx = Math.round(s.x + nx * off);
    const gy = Math.round(s.y + ny * off);
    out.placements.push({
      sp: chevronBoard(chevronDir(track, s), s.severity >= 2 ? 3 : 2),
      gx,
      gy,
      kind: FG_SIGN,
      shadow: true,
    });
  }
}

export function chevronDir(track: TrackRuntime, s: CornerSign): number {
  const b = track.branches[s.branch]!;
  const p = sampleBranch(b, s.bendS);
  const after = sampleBranch(b, s.bendS + 90);
  const n = s.turn === 'left' ? { x: p.ty, y: -p.tx } : { x: -p.ty, y: p.tx };
  if (Math.abs(n.x) > 0.35) return Math.sign(n.x);
  return Math.sign(after.tx) || 1;
}

export function emptyDressing(): Dressing {
  return { placements: [], anims: [], draws: [], previewSpots: [], previewCars: [], props: {} };
}

export function count(d: Dressing, key: string, n = 1): void {
  d.props[key] = (d.props[key] ?? 0) + n;
}
