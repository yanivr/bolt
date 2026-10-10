import type { TerrainLight, TrackDefinition, TrackRuntime } from '@bolt/shared';
import type { Canvas } from './canvas.js';
import type { CorridorField } from './field.js';

/**
 * Contract between the generic baker and a biome painter. The baker owns the corridor field,
 * chunking, overlays packaging, previews and the manifest; a biome owns the picture.
 */

export type BakeContext = {
  def: TrackDefinition;
  track: TrackRuntime;
  field: CorridorField;
  presetId: string;
  /** World-sized surface with a flag plane. The biome paints the final ground layer here. */
  world: Canvas;
  seed: number;
};

export type OverlayArt = {
  id: string;
  kind: string;
  /** Any size; the baker crops it to its opaque bounds. */
  canvas: Canvas;
  /** World position of the canvas top-left corner. */
  x: number;
  y: number;
  fadeNearPlayer: boolean;
};

export type AnimatedArt = {
  id: string;
  kind: string;
  frames: Canvas[];
  x: number;
  y: number;
  fps: number;
  above: boolean;
  blend: 'normal' | 'add';
};

export type PreviewSpot = { name: string; x: number; y: number };

/** Self-checks a painter runs on its own picture. Both numbers must be zero. */
export type BiomeChecks = {
  /** Drivable pixels hidden by raised geometry in the ground layer. */
  coveredDrivable: number;
  /** Pixels where frame 0 of a ground-level loop differs from the art baked under it. */
  animatedMismatch: number;
};

export type BiomeOutput = {
  overlays: OverlayArt[];
  animated: AnimatedArt[];
  lights: TerrainLight[];
  previewSpots: PreviewSpot[];
  checks: BiomeChecks;
};

export type BiomePainter = (ctx: BakeContext) => BiomeOutput;
