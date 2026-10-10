import type { AnchorPoint } from '@bolt/shared';
import type { Model } from '../lib/model.js';

/** Everything the baker needs to turn one chassis into sprite sheets and anchors. */
export type ChassisArt = {
  id: string;
  model: Model;
  /** Square cell that fits the body at every heading, including the outline. */
  cell: number;
  engineAnchor: AnchorPoint;
  exhausts: AnchorPoint[];
  headlightAnchors: AnchorPoint[];
  brakeLightAnchors: AnchorPoint[];
  /**
   * Height of the bodywork under each accessory mount id, in model units, so mounted parts
   * are lifted onto the roof, hood or deck they stand on. Mounts not listed default to 10.
   */
  mountHeights?: Record<string, number>;
};

export type WheelArt = {
  id: string;
  cell: number;
  rollFrames: number;
  model: (rollPhase: number) => Model;
};

export type EngineArt = {
  id: string;
  cell: number;
  model: Model;
  exhaustStyle: 'puff' | 'flame' | 'none';
};

/**
 * A mounted weapon, defense or utility. Modelled around its own origin (the mount point) with
 * its base at height 0, front toward negative Y; the compositor lifts it to the mount height.
 */
export type PartArt = { id: string; cell: number; model: Model };
