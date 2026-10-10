/**
 * Machine-readable manifests written by the art pipeline and read by the web client. Keeping
 * the shapes here means the baker and the renderer cannot drift apart.
 */

export type TerrainChunk = {
  col: number;
  row: number;
  /** File name relative to the manifest. */
  file: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Foreground art drawn above cars: gantries, bridges, lantern strings, canopies. */
export type TerrainOverlay = {
  id: string;
  kind: string;
  file: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** When true the client fades the overlay while the local car is underneath it. */
  fadeNearPlayer: boolean;
};

/** Looping ambient animation stored as a horizontal strip of equally sized frames. */
export type TerrainAnimatedProp = {
  id: string;
  kind: string;
  file: string;
  x: number;
  y: number;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  fps: number;
  /** Draw above cars (true) or on the ground below them (false). */
  above: boolean;
  blend: 'normal' | 'add';
};

/** Baked lamp positions, so dynamic sprites can pick up a matching tint as they pass. */
export type TerrainLight = {
  x: number;
  y: number;
  radius: number;
  color: string;
  intensity: number;
};

export type TerrainManifest = {
  version: 1;
  trackId: string;
  presetId: string;
  worldWidth: number;
  worldHeight: number;
  chunkSize: number;
  cols: number;
  rows: number;
  ground: TerrainChunk[];
  overlays: TerrainOverlay[];
  animated: TerrainAnimatedProp[];
  lights: TerrainLight[];
  minimap: { file: string; width: number; height: number; worldScale: number };
};

// --- Vehicles ----------------------------------------------------------------------------------

export const CAR_HEADINGS = 16;
export const WHEEL_HEADINGS = 32;

export type AnchorPoint = { x: number; y: number };

export type SpriteSheetRef = {
  /** File name relative to the manifest. */
  file: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
};

export type ChassisSpriteManifest = {
  id: string;
  /** 16 heading frames in one row, heading 0 first, clockwise. */
  body: SpriteSheetRef;
  shadow: SpriteSheetRef;
  brakeLights: SpriteSheetRef;
  headlights: SpriteSheetRef;
  /** Exact RGB values (hex) of the paint ramp baked into `body`, darkest first. */
  paintKey: string[];
  /** Chassis-local positions; the compositor rotates them per heading. */
  wheelAnchors: Array<AnchorPoint & { id: string; steers: boolean }>;
  engineAnchor: AnchorPoint;
  exhausts: AnchorPoint[];
  headlightAnchors: AnchorPoint[];
  brakeLightAnchors: AnchorPoint[];
};

export type WheelSpriteManifest = {
  id: string;
  /** Columns are 32 directions, rows are roll phases. */
  sheet: SpriteSheetRef;
  rollFrames: number;
};

export type EngineSpriteManifest = {
  id: string;
  /** 16 heading frames in one row. Drawn at the chassis engine anchor. */
  sheet: SpriteSheetRef;
  exhaustStyle: 'puff' | 'flame' | 'none';
};

export type PaintDefinition = { id: string; displayName: string; ramp: string[] };

export type CarAtlasManifest = {
  version: 1;
  chassis: Record<string, ChassisSpriteManifest>;
  wheels: Record<string, WheelSpriteManifest>;
  engines: Record<string, EngineSpriteManifest>;
  paints: Record<string, PaintDefinition>;
};
