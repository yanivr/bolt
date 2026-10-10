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
