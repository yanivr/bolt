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

/**
 * Authored headings per chassis. Sixty-four frames put 5.6 degrees between neighbours, so a
 * turning car reads as rotating rather than snapping (the specification's sixteen is a floor).
 */
export const CAR_HEADINGS = 64;
/** Heading frames are packed in a grid this many columns wide to stay inside texture limits. */
export const CAR_SHEET_COLUMNS = 8;
export const WHEEL_HEADINGS = 32;
/**
 * Camera tilt of every vehicle sprite: screen pixels a point rises per unit of height, and the
 * exaggeration applied to authored heights. The compositor uses the same numbers to lift a
 * mounted part to the height of its mount, so parts sit on the bodywork at every heading.
 */
export const CAR_TILT = 0.62;
export const CAR_Z_SCALE = 1.3;

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
  /** One frame per heading, heading 0 first, clockwise, packed row by row. */
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
  /** Height of the bodywork under each accessory mount, in authored units. Missing means 10. */
  mountHeights?: Record<string, number>;
};

export type WheelSpriteManifest = {
  id: string;
  /** Columns are 32 directions, rows are roll phases. */
  sheet: SpriteSheetRef;
  rollFrames: number;
};

export type EngineSpriteManifest = {
  id: string;
  /** One frame per heading, packed row by row. Drawn at the chassis engine anchor. */
  sheet: SpriteSheetRef;
  exhaustStyle: 'puff' | 'flame' | 'none';
};

/**
 * A mounted weapon, defense or utility. One frame per heading, packed row by row like a
 * chassis, sized to hold the part's catalog footprint at every heading. Drawn at the part's
 * position on the chassis (mount plus offset), turned by its quarter-turn rotation.
 */
export type PartSpriteManifest = {
  id: string;
  sheet: SpriteSheetRef;
};

/** Square part icons packed in one sheet per size; `index` maps a part id to its cell. */
export type IconSheetManifest = {
  file: string;
  size: number;
  columns: number;
  index: Record<string, number>;
};

export type PaintDefinition = { id: string; displayName: string; ramp: string[] };

export type CarAtlasManifest = {
  version: 1;
  chassis: Record<string, ChassisSpriteManifest>;
  wheels: Record<string, WheelSpriteManifest>;
  engines: Record<string, EngineSpriteManifest>;
  /** Mounted parts. Absent until the first accessory sprites are baked. */
  parts?: Record<string, PartSpriteManifest>;
  /** Catalog icons at 32 and 24 pixels for every part that has art. */
  icons?: IconSheetManifest[];
  paints: Record<string, PaintDefinition>;
};

// --- Effects -----------------------------------------------------------------------------------

export type VfxStripManifest = {
  id: string;
  file: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  fps: number;
};

export type VfxManifest = { version: 1; strips: Record<string, VfxStripManifest> };
