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
  /** World-sized surface with height and flag planes. The biome paints the final ground here. */
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

export type BiomeOutput = {
  overlays: OverlayArt[];
  animated: AnimatedArt[];
  lights: TerrainLight[];
  previewSpots: PreviewSpot[];
};

export type BiomePainter = (ctx: BakeContext) => BiomeOutput;
