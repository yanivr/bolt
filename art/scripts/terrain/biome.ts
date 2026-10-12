import type {
  BiomeId,
  TerrainLight,
  TrackDefinition,
  TrackRuntime,
  WeatherPreset,
} from '@bolt/shared';
import type { Canvas } from './canvas.js';
import type { CorridorField } from './field.js';

/**
 * Contract between the generic baker and a biome painter (docs/TRACK_API.md, "The terrain
 * baker"). The baker owns the corridor field, chunking, overlays packaging, the minimap,
 * previews and the manifest; a biome owns the picture. A painter reads the track only through
 * the context: the format-2 definition (`def`: zones, walls, obstacles, hazards, anchors,
 * camera bounds), its runtime (`track`: sampled centerlines, checkpoints, corner signs, the
 * zone grids and `groundAt`, the very lookup the physics uses) and the corridor field, so the
 * art can only ever agree with the simulation.
 */

export type BakeContext = {
  def: TrackDefinition;
  track: TrackRuntime;
  field: CorridorField;
  presetId: string;
  /** The weather preset being baked: time of day, wetness, rain, wind, visibility. */
  preset: WeatherPreset;
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
  /**
   * Optional: pack the frames in a grid this many frames wide instead of one row, so a long
   * loop (a hazard timetable) stays inside mobile texture limits. The client slices a sheet row
   * by row, so the manifest entry is unchanged. Omitted, the frames are one horizontal strip.
   */
  columns?: number;
};

export type PreviewSpot = { name: string; x: number; y: number };

/** Self-checks a painter runs on its own picture. Both numbers must be zero. */
export type BiomeChecks = {
  /** Drivable pixels hidden by raised geometry in the ground layer. */
  coveredDrivable: number;
  /** Pixels where frame 0 of a ground-level loop differs from the art baked under it. */
  animatedMismatch: number;
};

/** A review crop with a car composited in for scale. Never shipped. */
export type PreviewCarSpot = PreviewSpot & { car?: { x: number; y: number; heading: number } };

export type BiomeOutput = {
  overlays: OverlayArt[];
  animated: AnimatedArt[];
  lights: TerrainLight[];
  previewSpots: PreviewSpot[];
  /** Spots, by name, that also get a crop without overlays. */
  previewPlain?: string[];
  /** Crops with a car drawn in for scale. */
  previewCars?: PreviewCarSpot[];
  checks: BiomeChecks;
};

export type BiomePainter = (ctx: BakeContext) => BiomeOutput;

/** A biome's plug-in: its painter and which weather presets it can paint. */
export type BiomeModule = {
  biome: BiomeId;
  paint: BiomePainter;
  /** Preset ids this module paints; others are refused rather than painted wrongly. */
  presets: readonly string[];
};
